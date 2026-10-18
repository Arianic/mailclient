// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlText, OutlookInbox } from "./OutlookInbox";
import { outlookApi, type OutlookMessage } from "./outlook";

vi.mock("./outlook", () => ({
  outlookApi: { inbox: vi.fn(), message: vi.fn() },
}));
let host: HTMLDivElement;
let root: Root;
const account = { displayName: "Example", email: "you@outlook.example" };
const summary = {
  id: "message-1",
  subject: "A personal message",
  from: { emailAddress: { name: "Sender", address: "sender@example.test" } },
  receivedDateTime: "2026-10-18T10:00:00Z",
  isRead: false,
  hasAttachments: false,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(outlookApi.inbox).mockResolvedValue({
    messages: [summary],
    hasMore: true,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
async function render() {
  await act(async () => {
    root.render(
      <OutlookInbox
        account={account}
        dark={false}
        query=""
        compose={() => {}}
      />,
    );
  });
}
const click = async (button: HTMLButtonElement) => {
  await act(async () => {
    button.click();
  });
};

describe("personal Outlook reader", () => {
  it("fetches a body only on opening and keeps it in the sandbox", async () => {
    vi.mocked(outlookApi.message).mockResolvedValue({
      id: summary.id,
      body: {
        contentType: "html",
        content:
          '<p>Hello</p><script>danger()</script><img src="https://tracker.example/pixel">',
      },
    });
    await render();
    expect(outlookApi.message).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Load older messages");
    await click(host.querySelector<HTMLButtonElement>(".row-main")!);
    expect(outlookApi.message).toHaveBeenCalledWith(summary.id);
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.srcdoc).not.toContain("tracker.example");
    expect(frame.srcdoc).not.toContain("danger()");
    expect(localStorage.getItem("mail-messages-v1")).toBeNull();
    expect(host.textContent).toContain("Load images");
  });
  it("ignores a late body response after returning to the inbox", async () => {
    let finish!: (message: OutlookMessage) => void;
    vi.mocked(outlookApi.message).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await click(host.querySelector<HTMLButtonElement>(".row-main")!);
    await click(
      host.querySelector<HTMLButtonElement>(".outlook-reader-toolbar button")!,
    );
    await act(async () =>
      finish({
        id: summary.id,
        body: { contentType: "text", content: "late private body" },
      }),
    );
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).not.toContain("late private body");
    expect(host.textContent).toContain("Inbox");
  });
  it("shows fetch failures and offers a retry without clearing existing metadata", async () => {
    await render();
    vi.mocked(outlookApi.inbox).mockRejectedValueOnce("Connection unavailable");
    const refresh = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Refresh"),
    )!;
    await click(refresh);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Connection unavailable",
    );
    expect(host.textContent).toContain(summary.subject);
  });
  it("loads older pages without duplicates and preserves the selected category", async () => {
    await render();
    vi.mocked(outlookApi.inbox).mockResolvedValueOnce({
      messages: [
        summary,
        { ...summary, id: "older", subject: "Older message" },
      ],
      hasMore: false,
    });
    const older = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Load older messages"),
    )!;
    await click(older);
    expect(outlookApi.inbox).toHaveBeenLastCalledWith("important", true);
    expect(host.querySelectorAll(".mail-row")).toHaveLength(2);
    expect(host.textContent).toContain("Older message");
    vi.mocked(outlookApi.inbox).mockResolvedValueOnce({
      messages: [],
      hasMore: true,
    });
    await click(
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Other",
      )!,
    );
    expect(outlookApi.inbox).toHaveBeenLastCalledWith("other", false);
    expect(host.textContent).not.toContain("Older message");
    expect(host.textContent).toContain("Load older messages");
  });
  it("extracts readable text without retaining active or tracking markup", () => {
    const text = htmlText(
      '<p>Hello &amp; welcome</p><p>Second line</p><script>danger()</script><iframe src="https://evil.example"></iframe><img src="https://tracker.example/a">',
    );
    expect(text).toContain("Hello & welcome\nSecond line");
    expect(text).not.toContain("danger()");
    expect(text).not.toContain("https:");
  });
});
