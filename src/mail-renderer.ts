import DOMPurify from "dompurify";

const allowedTags = [
  "p",
  "div",
  "span",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "img",
  "a",
];
const allowedStyles = new Set([
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-align",
  "text-decoration",
  "line-height",
  "letter-spacing",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-collapse",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
]);

// This is defense in depth. The output still belongs only inside a sandboxed
// opaque-origin iframe with no script permission or privileged application bridge.
export function sanitizeMailHtml(source: string, original = false): string {
  const clean = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: [
      "style",
      "alt",
      "title",
      "src",
      "width",
      "height",
      "colspan",
      "rowspan",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const element of template.content.querySelectorAll<HTMLElement>("*")) {
    // Drop URLs from CSS, including obfuscated values. Retain only a small set
    // of parsed presentation properties, never positioning, loading or behavior.
    const input = element.getAttribute("style");
    element.removeAttribute("style");
    if (input) {
      const parsed = document.createElement("span").style;
      parsed.cssText = input;
      const safe = document.createElement("span").style;
      for (let i = 0; i < parsed.length; i++) {
        const property = parsed.item(i);
        const value = parsed.getPropertyValue(property);
        if (!allowedStyles.has(property)) continue;
        if (
          !original &&
          (property === "color" || property === "background-color")
        )
          continue;
        if (
          /[\\@]|url\s*\(|image\s*\(|image-set\s*\(|expression\s*\(|var\s*\(/i.test(
            value,
          )
        )
          continue;
        safe.setProperty(property, value);
      }
      if (safe.cssText) element.setAttribute("style", safe.cssText);
    }
    if (element.tagName === "IMG") {
      const src = element.getAttribute("src") || "";
      // No remote requests or SVG. Real CID attachments and trusted-sender
      // image permissions will be added through a backend resource broker.
      if (
        !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src) ||
        src.length > 2_000_000
      ) {
        const placeholder = document.createElement("span");
        placeholder.className = "blocked-image";
        placeholder.textContent = element.getAttribute("alt")
          ? `[Image blocked: ${element.getAttribute("alt")}]`
          : "[Remote image blocked]";
        element.replaceWith(placeholder);
      }
    }
  }
  return template.innerHTML;
}

export function mailDocument(
  source: string,
  dark: boolean,
  original = false,
): string {
  const background = original ? "#ffffff" : dark ? "#252a32" : "#fcfcfb";
  const foreground = original ? "#222831" : dark ? "#e1e5ec" : "#292e35";
  const muted = original ? "#68717b" : dark ? "#929aa8" : "#737c87";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>html{color-scheme:${original ? "light" : dark ? "dark" : "light"}}body{margin:0;padding:4px 2px 16px;overflow-wrap:anywhere;background:${background};color:${foreground};font:13px/1.85 system-ui,sans-serif}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{overflow-wrap:anywhere}pre{white-space:pre-wrap}a{color:inherit;text-decoration:underline}.blocked-image{display:block;color:${muted};font-size:11px;padding:8px 0}h1,h2,h3,h4{line-height:1.4}h1{font-size:23px}h2{font-size:19px}p:first-child{margin-top:0}p:last-child{margin-bottom:0}</style></head><body>${sanitizeMailHtml(source, original)}</body></html>`;
}
