// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlookComposer } from "./OutlookComposer";
import { outlookApi, type OutlookDraft } from "./outlook";
const native = vi.hoisted(() => ({
  destroy: vi.fn().mockResolvedValue(undefined),
  onCloseRequested: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("./desktop", () => ({ dragNativeWindow: vi.fn() }));
vi.mock("./outlook", () => ({
  outlookApi: {
    status: vi.fn(),
    loadDraft: vi.fn(),
    saveDraft: vi.fn(),
    sendDraft: vi.fn(),
  },
}));
let root: Root;
let host: HTMLDivElement;
const draft: OutlookDraft = {
  id: "test-1",
  account: "you@example.test",
  to: "friend@example.test",
  cc: "",
  bcc: "",
  subject: "Hello",
  body: "A message",
  replyId: null,
  state: "draft",
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  history.replaceState({}, "", "/?outlookCompose=test-1");
  vi.mocked(outlookApi.status).mockResolvedValue({
    account: { email: draft.account, displayName: "Example" },
    clientId: "id",
    canSend: true,
  });
  vi.mocked(outlookApi.loadDraft).mockResolvedValue({ ...draft });
  vi.mocked(outlookApi.saveDraft).mockResolvedValue();
  vi.mocked(outlookApi.sendDraft).mockResolvedValue("Submitted to Outlook");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function render() {
  await act(async () => root.render(<OutlookComposer controls={null} />));
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (button) =>
      button.textContent?.includes(text) ||
      button.getAttribute("aria-label") === text,
  )!;
  await act(async () => button.click());
}

describe("real Outlook composer", () => {
  it("allows undo during the delay without submitting mail", async () => {
    await render();
    await submit();
    expect(outlookApi.sendDraft).not.toHaveBeenCalled();
    await click("Undo Send");
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(outlookApi.sendDraft).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Undo Send");
  });
  it("saves before submitting and does not replay an accepted send", async () => {
    await render();
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(outlookApi.saveDraft).toHaveBeenCalled();
    expect(outlookApi.sendDraft).toHaveBeenCalledExactlyOnceWith("test-1");
    expect(
      vi.mocked(outlookApi.saveDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(outlookApi.sendDraft).mock.invocationCallOrder[0]);
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(outlookApi.sendDraft).toHaveBeenCalledTimes(1);
  });
  it("keeps an uncertain result from being resent", async () => {
    vi.mocked(outlookApi.sendDraft).mockRejectedValue(
      "Send result is uncertain",
    );
    vi.mocked(outlookApi.loadDraft)
      .mockResolvedValueOnce({ ...draft })
      .mockResolvedValue({ ...draft, state: "uncertain" });
    await render();
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(host.textContent).toContain("Send result is uncertain");
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(outlookApi.sendDraft).toHaveBeenCalledTimes(1);
  });
  it("keeps the window open when closing cannot save the draft", async () => {
    vi.mocked(outlookApi.saveDraft).mockRejectedValue("Disk unavailable");
    await render();
    await click("Close compose");
    expect(native.destroy).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Not saved");
  });
});
