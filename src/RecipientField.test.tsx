// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecipientField } from "./RecipientField";
import { outlookApi } from "./outlook";
vi.mock("./outlook", () => ({ outlookApi: { contacts: vi.fn() } }));
let host: HTMLDivElement, root: Root;
const change = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(outlookApi.contacts).mockResolvedValue([
    { name: "Alex Morgan", address: "alex@example.test" },
  ]);
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
function Harness() {
  const [value, setValue] = useState("");
  return (
    <RecipientField
      label="To"
      value={value}
      disabled={false}
      onChange={(next) => {
        setValue(next);
        change(next);
      }}
    />
  );
}
async function type(value: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("commits editable recipient chips and rejects invalid addresses", async () => {
  await act(async () => root.render(<Harness />));
  await type("invalid");
  await act(async () =>
    host
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await type("friend@example.test");
  await act(async () =>
    host
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  expect(host.querySelector('[role="listitem"]')?.textContent).toContain(
    "friend@example.test",
  );
  expect(change).toHaveBeenLastCalledWith("friend@example.test");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove recipient friend@example.test"]',
      )!
      .click(),
  );
  expect(change).toHaveBeenLastCalledWith("");
});
it("offers cached people and inserts a chosen address without cloud requests", async () => {
  await act(async () => root.render(<Harness />));
  await type("alex");
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(outlookApi.contacts).toHaveBeenCalledWith("alex");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[role="option"]')!.click(),
  );
  expect(change).toHaveBeenLastCalledWith("alex@example.test");
  expect(host.querySelector('[role="listitem"]')?.textContent).toContain(
    "alex@example.test",
  );
});
