// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutlookFolders } from "./OutlookFolders";
import { outlookApi } from "./outlook";
vi.mock("./outlook", () => ({ outlookApi: { folders: vi.fn() } }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.resetAllMocks();
});
it("loads real folders and fetches nested folders only when expanded", async () => {
  vi.mocked(outlookApi.folders)
    .mockResolvedValueOnce([
      {
        id: "parent",
        displayName: "Personal",
        unreadItemCount: 0,
        childFolderCount: 1,
        isInbox: false,
      },
    ])
    .mockResolvedValueOnce([
      {
        id: "child",
        displayName: "Travel",
        unreadItemCount: 2,
        childFolderCount: 0,
        isInbox: false,
      },
    ]);
  const select = vi.fn();
  await act(async () =>
    root.render(<OutlookFolders selected="" onSelect={select} />),
  );
  expect(outlookApi.folders).toHaveBeenCalledTimes(1);
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Expand Personal"]')!
      .click(),
  );
  expect(outlookApi.folders).toHaveBeenLastCalledWith("parent");
  expect(host.textContent).toContain("Travel");
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".nav-item"))
      .find((button) => button.textContent?.includes("Travel"))!
      .click(),
  );
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "child" }));
});
it("keeps Inbox available when the folder list cannot load", async () => {
  vi.mocked(outlookApi.folders).mockRejectedValue("Connection unavailable");
  const select = vi.fn();
  await act(async () =>
    root.render(<OutlookFolders selected="inbox" onSelect={select} />),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Connection unavailable",
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".nav-item")!.click(),
  );
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "inbox" }));
});
