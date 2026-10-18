export type WorkspaceUpdate = {
  key: string;
  value: string | null;
  revision: number;
};
export type Snapshot = { values: Record<string, string>; revision: number };
export interface Backend {
  load(): Promise<Snapshot>;
  set(key: string, value: string): Promise<WorkspaceUpdate>;
  remove(key: string): Promise<WorkspaceUpdate>;
  listen(callback: (update: WorkspaceUpdate) => void): Promise<() => void>;
}
const draftPrefix = "mail-draft:";

export class WorkspaceStore {
  private values = new Map<string, string>();
  private revisions = new Map<string, number>();
  private subscribers = new Set<() => void>();
  private dirty = new Map<string, string | null>();
  private pending = Promise.resolve();
  private early: WorkspaceUpdate[] = [];
  private ready = false;
  private snapshotRevision = -1;
  error: string | null = null;
  constructor(
    private backend?: Backend,
    private browser: Storage = localStorage,
  ) {}

  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  private notify() {
    this.subscribers.forEach((fn) => fn());
  }
  async initialize() {
    if (!this.backend) {
      window.addEventListener("storage", () => this.notify());
      this.ready = true;
      return;
    }
    await this.backend.listen((update) =>
      this.ready ? this.accept(update) : this.early.push(update),
    );
    const snapshot = await this.backend.load();
    this.values = new Map(Object.entries(snapshot.values));
    this.snapshotRevision = snapshot.revision;
    for (const key of this.values.keys())
      this.revisions.set(key, snapshot.revision);
    this.ready = true;
    for (const update of this.early) this.accept(update);
    this.early = [];
  }
  private accept(update: WorkspaceUpdate) {
    if (
      this.dirty.has(update.key) ||
      update.revision <=
        (this.revisions.get(update.key) ?? this.snapshotRevision)
    )
      return;
    this.revisions.set(update.key, update.revision);
    if (update.value === null) this.values.delete(update.key);
    else this.values.set(update.key, update.value);
    this.notify();
  }
  getItem(key: string): string | null {
    if (!this.backend)
      return this.dirty.has(key)
        ? (this.values.get(key) ?? null)
        : this.browser.getItem(key);
    if (key === "mail-drafts") {
      return JSON.stringify(
        [...this.values]
          .filter(([k]) => k.startsWith(draftPrefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, v]) => JSON.parse(v)),
      );
    }
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.getItem(key) === value) return;
    if (!this.backend) {
      try {
        this.browser.setItem(key, value);
        this.dirty.delete(key);
        this.values.delete(key);
        if (!this.dirty.size) this.error = null;
      } catch {
        this.values.set(key, value);
        this.dirty.set(key, value);
        this.error =
          "Your changes could not be saved. Keep this window open and retry.";
      }
      this.notify();
      return;
    }
    if (key === "mail-drafts") {
      const previous = JSON.parse(this.getItem(key) || "[]") as {
        id: string;
      }[];
      const next = JSON.parse(value) as { id: string }[];
      for (const draft of next) {
        const itemKey = draftPrefix + draft.id;
        const encoded = JSON.stringify(draft);
        if (this.values.get(itemKey) !== encoded) this.write(itemKey, encoded);
      }
      const ids = new Set(next.map((draft) => draft.id));
      for (const draft of previous)
        if (!ids.has(draft.id)) this.write(draftPrefix + draft.id, null);
    } else this.write(key, value);
  }
  private write(key: string, value: string | null) {
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    this.dirty.set(key, value);
    this.notify();
    this.enqueue(key, value);
  }
  private enqueue(key: string, value: string | null) {
    this.pending = this.pending.then(async () => {
      try {
        const update =
          value === null
            ? await this.backend!.remove(key)
            : await this.backend!.set(key, value);
        if (this.dirty.get(key) === value) {
          this.dirty.delete(key);
          this.accept(update);
        }
        if (!this.dirty.size) this.error = null;
      } catch {
        this.error =
          "Your changes could not be saved. Keep this window open and retry.";
      }
      this.notify();
    });
  }
  async flush() {
    if (!this.backend) {
      for (const [key, value] of this.dirty) {
        try {
          if (value !== null) this.browser.setItem(key, value);
          else this.browser.removeItem(key);
          this.dirty.delete(key);
          this.values.delete(key);
        } catch {
          throw new Error(this.error || "Your changes could not be saved.");
        }
      }
      this.error = null;
      this.notify();
      return;
    }
    await this.pending;
    if (this.dirty.size) {
      for (const [key, value] of this.dirty) this.enqueue(key, value);
      await this.pending;
    }
    if (this.error || this.dirty.size)
      throw new Error(this.error || "Changes are still being saved.");
  }
}
