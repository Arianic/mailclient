// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemedSelect } from "./ThemedSelect";

let root: Root;
let host: HTMLDivElement;
let changed: (value: string) => void;
const trigger = () => host.querySelector<HTMLButtonElement>("[role=combobox]")!;
const popup = () => document.querySelector("[role=listbox]");
const key = (value: string) =>
  act(() =>
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
const click = (element: Element) =>
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));

function Example() {
  const [value, setValue] = useState("system");
  return (
    <ThemedSelect
      aria-label="Theme"
      value={value}
      onValueChange={(next) => {
        changed(next);
        setValue(next);
      }}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </ThemedSelect>
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 40,
    right: 160,
    bottom: 70,
    width: 120,
    height: 30,
    x: 40,
    y: 40,
    toJSON: () => ({}),
  });
  Element.prototype.scrollIntoView = vi.fn();
  changed = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Example />));
  trigger().focus();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("themed dropdown interaction", () => {
  it("uses an app-owned popup and commits pointer selections", () => {
    click(trigger());
    expect(popup()?.parentElement).toBe(document.body);
    expect(popup()?.querySelector('[aria-selected="true"]')?.textContent).toBe(
      "System",
    );
    click(popup()!.querySelectorAll("[role=option]")[1]);
    expect(changed).toHaveBeenCalledWith("light");
    expect(trigger().textContent).toBe("Light");
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
  it("announces keyboard focus and commits only after confirmation", () => {
    key("ArrowDown");
    key("End");
    expect(
      document.getElementById(trigger().getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Dark");
    expect(changed).not.toHaveBeenCalled();
    key("Enter");
    expect(changed).toHaveBeenCalledWith("dark");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
  it("cancels Escape without dismissing the parent view", () => {
    const parentEscape = vi.fn();
    window.addEventListener("keydown", parentEscape);
    key(" ");
    parentEscape.mockClear();
    key("Escape");
    expect(popup()).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(parentEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", parentEscape);
  });
  it("supports typing to find a choice and Tab to leave without changing it", () => {
    key("d");
    expect(
      document.getElementById(trigger().getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toBe("Dark");
    key("Tab");
    expect(popup()).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
  it("dismisses on outside interaction and keeps the popup in the viewport", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 1000,
      top: 740,
      right: 1100,
      bottom: 770,
      width: 100,
      height: 30,
      x: 1000,
      y: 740,
      toJSON: () => ({}),
    });
    click(trigger());
    const style = (popup() as HTMLElement).style;
    expect(style.bottom).not.toBe("");
    expect(
      Number.parseFloat(style.left) + Number.parseFloat(style.width),
    ).toBeLessThanOrEqual(window.innerWidth - 12);
    act(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(popup()).toBeNull();
  });
});
