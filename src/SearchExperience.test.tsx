// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchControls } from "./SearchControls";
import { SearchRecovery } from "./SearchRecovery";
import { outlookApi, type SearchDiagnostics, type Contact } from "./outlook";
vi.mock("./outlook", () => ({
  outlookApi: { contacts: vi.fn(), searchDiagnostics: vi.fn() },
}));
let host: HTMLDivElement, root: Root;
const change = vi.fn();
const status = {
  messages: 140,
  folders: 7,
  pending: 0,
  missingFiles: 0,
  lastSync: 1,
  error: null,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 18, 12));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(outlookApi.contacts).mockResolvedValue([]);
  vi.mocked(outlookApi.searchDiagnostics).mockResolvedValue({
    alternatives: [],
    corrections: [],
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const tick = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
const controls = async (query: string) =>
  act(async () =>
    root.render(
      <SearchControls
        query={query}
        onQuery={change}
        sort="relevance"
        onSort={() => {}}
        status={status}
      />,
    ),
  );
const recovery = async (query: string) =>
  act(async () =>
    root.render(
      <SearchRecovery query={query} onQuery={change} status={status} />,
    ),
  );
describe("local search guidance", () => {
  it("edits an interpreted date range instead of adding conflicting dates", async () => {
    await controls("emails early September from Alex");
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "Edit dates")!
        .click();
    });
    const after = host.querySelector<HTMLInputElement>(
      '[aria-label="Search after"]',
    )!;
    const before = host.querySelector<HTMLInputElement>(
      '[aria-label="Search before"]',
    )!;
    expect(after.value).toBe("2026-09-01");
    expect(before.value).toBe("2026-09-11");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(before, "2026-10-01");
      before.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(change).toHaveBeenCalledWith(
      "from:Alex after:2026-09-01 before:2026-10-01",
    );
  });
  it("offers ambiguous contacts without choosing one or dropping other conditions", async () => {
    vi.mocked(outlookApi.contacts).mockResolvedValue([
      { name: "Alex Morgan", address: "alex@example.test" },
      { name: "Alex Rivera", address: "rivera@example.test" },
    ]);
    await controls("unread emails from Alex last month");
    await tick();
    expect(change).not.toHaveBeenCalled();
    expect(host.textContent).toContain("2 suggestions");
    expect(host.textContent).toContain("no person is selected automatically");
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("rivera@example.test"))!
        .click();
    });
    expect(change).toHaveBeenCalledWith(
      'is:unread fromaddr:"rivera@example.test" after:2026-09-01 before:2026-10-01',
    );
  });
  it("removes an entire people alternative while preserving the other constraints", async () => {
    await controls("(from:Alex OR from:Sam) has:attachment");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".search-condition")!.click();
    });
    expect(change).toHaveBeenCalledWith("has:attachment");
  });
  it("does not display late contacts after another query or cache clearing", async () => {
    let finish!: (contacts: Contact[]) => void;
    vi.mocked(outlookApi.contacts).mockImplementation((query) =>
      query === "Alex"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve([]),
    );
    await controls("from Alex");
    await tick();
    await controls("from Sam");
    await tick();
    await act(async () =>
      finish([{ name: "Alex Secret", address: "old@example.test" }]),
    );
    expect(host.textContent).not.toContain("Alex Secret");
    vi.mocked(outlookApi.contacts).mockResolvedValue([
      { name: "Sam", address: "sam@example.test" },
    ]);
    await controls("from Sam Smith");
    await tick();
    expect(host.textContent).toContain("sam@example.test");
    vi.mocked(outlookApi.contacts).mockResolvedValue([]);
    await act(async () => {
      window.dispatchEvent(new Event("outlook-cache-cleared"));
    });
    await tick();
    expect(host.textContent).not.toContain("sam@example.test");
  });
  it("shows date assumptions and keeps the actual range removable", async () => {
    await controls("emails early September");
    expect(host.textContent).toContain("Early month means days 1–10");
    expect(host.querySelector(".search-interpretation")?.textContent).toContain(
      "before:2026-09-11",
    );
    expect(host.querySelectorAll(".search-condition")).toHaveLength(2);
  });
  it("offers measured relaxations/corrections without changing the search automatically", async () => {
    const query = "from:Alex invoce has:attachment";
    vi.mocked(outlookApi.searchDiagnostics).mockResolvedValue({
      alternatives: [{ query: "from:Alex invoce", count: 12 }],
      corrections: [{ query: "from:Alex invoice has:attachment", count: 3 }],
    });
    await recovery(query);
    await tick();
    expect(outlookApi.searchDiagnostics).toHaveBeenCalledWith(query, [
      "invoce has:attachment",
      "from:Alex has:attachment",
      "from:Alex invoce",
    ]);
    expect(change).not.toHaveBeenCalled();
    expect(host.textContent).toContain("12 matches");
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("3 matches"))!
        .click();
    });
    expect(change).toHaveBeenCalledWith("from:Alex invoice has:attachment");
  });
  it("discards obsolete recovery results and leaves failures non-destructive", async () => {
    let finish!: (data: SearchDiagnostics) => void;
    vi.mocked(outlookApi.searchDiagnostics).mockImplementation((query) =>
      query === "first"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.reject(Error("offline")),
    );
    await recovery("first");
    await tick();
    await recovery("second");
    await tick();
    await act(async () =>
      finish({
        alternatives: [{ query: "private-old-result", count: 9 }],
        corrections: [],
      }),
    );
    expect(host.textContent).not.toContain("private-old-result");
    expect(host.textContent).toContain("Your original search is unchanged");
    expect(change).not.toHaveBeenCalled();
  });
});
