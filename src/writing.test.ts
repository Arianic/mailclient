// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  cleanWritingHtml,
  plainWritingHtml,
  validWritingLink,
} from "./writing";
it("retains basic formatting while removing trackers, active content and application attributes", () => {
  const html = cleanWritingHtml(
    '<p onclick="attack()" data-tauri-drag-region="true" style="background:url(https://tracker.test)">Hello <strong>friend</strong><img src="https://tracker.test"><script>attack()</script><a href="javascript:alert(1)">bad</a><a href="https://example.test">safe</a></p>',
  );
  expect(html).toContain("<strong>friend</strong>");
  expect(html).toContain('href="https://example.test"');
  for (const blocked of [
    "onclick",
    "data-tauri",
    "style=",
    "tracker",
    "<script",
    "javascript:",
  ])
    expect(html).not.toContain(blocked);
  expect(validWritingLink("file:///etc/passwd")).toBe(false);
  expect(validWritingLink("data:text/html,test")).toBe(false);
  expect(validWritingLink("mailto:friend@example.test")).toBe(true);
});
it("converts legacy plain text to literal text rather than executable markup", () => {
  const html = plainWritingHtml("Hello <img src=x> & goodbye\nNext line");
  expect(html).toBe(
    "<p>Hello &lt;img src=x&gt; &amp; goodbye<br>Next line</p>",
  );
});
