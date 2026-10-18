// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RichTextEditor, type RichEditorHandle } from "./RichTextEditor";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("inserts formatted snippets at the editor selection and preserves undo", async () => {
  const ref = createRef<RichEditorHandle>();
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <RichTextEditor
        ref={ref}
        value="<p>Existing writing</p>"
        onChange={changed}
      />,
    ),
  );
  await act(async () => {
    ref.current!.insertHtml(
      '<p><strong>Reusable text</strong><img src="https://tracker.test"></p>',
    );
    await vi.advanceTimersByTimeAsync(50);
  });
  const html = changed.mock.calls.at(-1)![0];
  expect(html).toContain("<strong>Reusable text</strong>");
  expect(html).toContain("Existing writing");
  expect(html).not.toContain("img");
  const undo = host.querySelector<HTMLButtonElement>(
    '[aria-label="Undo typing"]',
  )!;
  await act(async () => {
    undo.click();
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(changed.mock.calls.at(-1)![1]).toContain("Existing writing");
  expect(changed.mock.calls.at(-1)![1]).not.toContain("Reusable text");
});
it("freezes formatting and editor contents when a send is locked", async () => {
  const ref = createRef<RichEditorHandle>();
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <RichTextEditor
        ref={ref}
        disabled
        value="<p>Frozen text</p>"
        onChange={changed}
      />,
    ),
  );
  await act(async () => ref.current!.insertHtml("<p>Unexpected change</p>"));
  expect(
    host.querySelector('[role="textbox"]')?.getAttribute("contenteditable"),
  ).toBe("false");
  expect(changed).not.toHaveBeenCalled();
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Bold"]')?.disabled,
  ).toBe(true);
});
