// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexSettings } from "./IndexSettings";
import { outlookApi, type IndexStatus } from "./outlook";
vi.mock("./outlook", () => ({
  outlookApi: { indexStatus: vi.fn(), indexControl: vi.fn() },
}));
let host: HTMLDivElement, root: Root;
const status: IndexStatus = {
  messages: 300,
  folders: 12,
  pending: 0,
  missingFiles: 0,
  lastSync: 1,
  error: null,
  reportedItems: 5000,
  coverageGaps: 1,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(outlookApi.indexStatus).mockResolvedValue(status);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
async function render() {
  await act(async () => {
    root.render(<IndexSettings />);
  });
}
it("does not claim completion for 300 cached messages when Outlook reports thousands and offers a non-destructive rescan", async () => {
  vi.mocked(outlookApi.indexControl).mockResolvedValue({
    ...status,
    pending: 12,
    coverageGaps: 0,
  });
  const cleared = vi.fn();
  window.addEventListener("outlook-cache-cleared", cleared);
  try {
    await render();
    expect(host.textContent).toContain("Coverage incomplete");
    expect(host.textContent).not.toContain("Mailbox scan complete");
    const button = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Rescan entire mailbox",
    )!;
    await act(async () => button.click());
    expect(outlookApi.indexControl).toHaveBeenCalledWith("rebuild");
    expect(host.textContent).toContain("12 folders indexing");
    expect(cleared).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("outlook-cache-cleared", cleared);
  }
});
it("shows interrupted indexing rather than a successful completion even without pending folders", async () => {
  vi.mocked(outlookApi.indexStatus).mockResolvedValue({
    ...status,
    coverageGaps: 0,
    error: "Outlook response was interrupted",
  });
  await render();
  expect(host.textContent).toContain("Indexing interrupted");
  expect(host.textContent).not.toContain("Mailbox scan complete");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Outlook response was interrupted",
  );
});
it("shows preparation instead of completion before folder discovery starts", async () => {
  vi.mocked(outlookApi.indexStatus).mockResolvedValue({
    ...status,
    messages: 0,
    folders: 0,
    coverageGaps: 0,
    reportedItems: null,
  });
  await render();
  expect(host.textContent).toContain("Preparing mailbox scan");
  expect(host.textContent).not.toContain("Mailbox scan complete");
});
