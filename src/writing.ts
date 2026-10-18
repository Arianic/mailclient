import DOMPurify from "dompurify";
export const writingTags = [
  "p",
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
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
];
export const validWritingLink = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !/[\u0000-\u001f\u007f]/.test(value)
    );
  } catch {
    return false;
  }
};
export function cleanWritingHtml(source: string) {
  const clean = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: writingTags,
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: [
      "style",
      "script",
      "svg",
      "math",
      "iframe",
      "form",
      "template",
    ],
  });
  const doc = document.createElement("template");
  doc.innerHTML = clean;
  doc.content.querySelectorAll("a[href]").forEach((a) => {
    if (!validWritingLink(a.getAttribute("href") || ""))
      a.removeAttribute("href");
  });
  return doc.innerHTML;
}
export const plainWritingHtml = (text: string) =>
  `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", "<br>")}</p>`;
