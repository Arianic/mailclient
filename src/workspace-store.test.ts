// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  WorkspaceStore,
  type Backend,
  type WorkspaceUpdate,
} from "./workspace-store";

function backend(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Set<(update: WorkspaceUpdate) => void>();
  let revision = 0;
  let failing = false;
  const publish = (update: WorkspaceUpdate) =>
    listeners.forEach((fn) => fn(update));
  const service: Backend = {
    load: async () => ({ values: Object.fromEntries(values), revision }),
    listen: async (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set: async (key, value) => {
      if (failing) throw Error("Disk full");
      values.set(key, value);
      const update = { key, value, revision: ++revision };
      publish(update);
      return update;
    },
    remove: async (key) => {
      values.delete(key);
      const update = { key, value: null, revision: ++revision };
      publish(update);
      return update;
    },
  };
  return {
    service,
    values,
    publish,
    setFailure: (next: boolean) => {
      failing = next;
    },
  };
}
describe("durable workspace synchronization", () => {
  it("preserves independent drafts from two windows", async () => {
    const b = backend();
    const a = new WorkspaceStore(b.service),
      c = new WorkspaceStore(b.service);
    await a.initialize();
    await c.initialize();
    a.setItem("mail-drafts", JSON.stringify([{ id: "first", body: "A" }]));
    c.setItem("mail-drafts", JSON.stringify([{ id: "second", body: "B" }]));
    await a.flush();
    await c.flush();
    expect([...b.values.keys()].sort()).toEqual([
      "mail-draft:first",
      "mail-draft:second",
    ]);
    expect(JSON.parse(a.getItem("mail-drafts")!)).toHaveLength(2);
    expect(JSON.parse(c.getItem("mail-drafts")!)).toHaveLength(2);
  });
  it("keeps unsaved changes visible and retries after a disk error", async () => {
    const b = backend();
    const s = new WorkspaceStore(b.service);
    await s.initialize();
    b.setFailure(true);
    s.setItem("mail-theme", '"dark"');
    await expect(s.flush()).rejects.toThrow();
    expect(s.getItem("mail-theme")).toBe('"dark"');
    expect(s.error).not.toBeNull();
    b.setFailure(false);
    await s.flush();
    expect(b.values.get("mail-theme")).toBe('"dark"');
    expect(s.error).toBeNull();
  });
  it("ignores delayed older updates instead of overwriting newer values", async () => {
    const b = backend();
    const s = new WorkspaceStore(b.service);
    await s.initialize();
    b.publish({ key: "mail-theme", value: '"dark"', revision: 5 });
    b.publish({ key: "mail-theme", value: '"light"', revision: 3 });
    expect(s.getItem("mail-theme")).toBe('"dark"');
  });
  it("does not resurrect a deleted record from an event older than startup", async () => {
    const b = backend();
    const service: Backend = {
      ...b.service,
      load: async () => ({ values: {}, revision: 10 }),
    };
    const s = new WorkspaceStore(service);
    await s.initialize();
    b.publish({ key: "mail-draft:old", value: '{"id":"old"}', revision: 8 });
    expect(JSON.parse(s.getItem("mail-drafts")!)).toEqual([]);
  });
  it("removes only the selected draft and synchronizes the other window", async () => {
    const b = backend({
      "mail-draft:a": '{"id":"a"}',
      "mail-draft:b": '{"id":"b"}',
    });
    const a = new WorkspaceStore(b.service),
      c = new WorkspaceStore(b.service);
    await a.initialize();
    await c.initialize();
    a.setItem("mail-drafts", '[{"id":"b"}]');
    await a.flush();
    expect(JSON.parse(c.getItem("mail-drafts")!)).toEqual([{ id: "b" }]);
  });
  it("retains browser edits in memory when local storage is full", async () => {
    let failing = true;
    const values = new Map<string, string>();
    const browser = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failing) throw Error("Quota");
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    } as Storage;
    const s = new WorkspaceStore(undefined, browser);
    await s.initialize();
    s.setItem("mail-theme", '"dark"');
    expect(s.getItem("mail-theme")).toBe('"dark"');
    expect(s.error).not.toBeNull();
    failing = false;
    await s.flush();
    expect(values.get("mail-theme")).toBe('"dark"');
    expect(s.error).toBeNull();
  });
});
