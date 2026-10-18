// DEV-only synthetic search evaluator for visual checks, not the native FTS engine.
import { parseSearchTree } from "./search-structure";
import type { OutlookSummary } from "./outlook";
const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tokens = (s: string) => normalize(s).match(/[\p{L}\p{N}]+/gu) || [];
export function fixtureSearch(query: string, messages: OutlookSummary[]) {
  if (!query.trim()) return messages;
  const root = parseSearchTree(query);
  if (!root) return [];
  type Node = NonNullable<ReturnType<typeof parseSearchTree>>;
  return messages.filter((message) => {
    const address = (p: NonNullable<OutlookSummary["from"]>) =>
      `${p.emailAddress.name || ""} ${p.emailAddress.address || ""}`;
    const sender = message.from ? address(message.from) : "";
    const list = (field: "toRecipients" | "ccRecipients" | "bccRecipients") =>
      (message[field] || []).map(address).join(" ");
    const phrase = (haystack: string, needle: string, exact: boolean) => {
      const words = tokens(haystack),
        terms = tokens(needle.replace(/\*$/, ""));
      return (
        !!terms.length &&
        words.some((_, start) =>
          terms.every((t, i) =>
            exact || i < terms.length - 1
              ? words[start + i] === t
              : words[start + i]?.startsWith(t),
          ),
        )
      );
    };
    const evaluate = (n: Node): boolean => {
      if (n.kind === "and") return n.children.every(evaluate);
      if (n.kind === "or") return n.children.some(evaluate);
      if (n.kind === "not") return !evaluate(n.children[0]);
      if (n.kind === "group") return evaluate(n.children[0]);
      const excluded = n.raw.startsWith("-"),
        raw = excluded ? n.raw.slice(1) : n.raw;
      const colon = raw.indexOf(":"),
        field = colon >= 0 ? raw.slice(0, colon).toLowerCase() : "";
      let value = (colon >= 0 ? raw.slice(colon + 1) : raw).replaceAll('"', "");
      if (value === "me") value = "you@outlook.example";
      const exact = raw.includes('"') && !raw.endsWith("*");
      let result = false;
      const received = message.receivedDateTime.slice(0, 10);
      const body = message.subject?.includes("Invoice")
        ? "Your September invoice includes the booking reference and payment details."
        : "A personal update with travel and accommodation details.";
      const fields: Record<string, string> = {
        "": `${message.subject} ${sender} ${list("toRecipients")} ${body}`,
        from: sender,
        to: list("toRecipients"),
        cc: list("ccRecipients"),
        bcc: list("bccRecipients"),
        person: `${sender} ${list("toRecipients")} ${list("ccRecipients")} ${list("bccRecipients")}`,
        subject: message.subject || "",
        body,
        filename: message.hasAttachments ? "receipt.pdf" : "",
      };
      if (field in fields) result = phrase(fields[field], value, exact);
      else if (field.endsWith("addr")) {
        const addresses =
          field === "fromaddr"
            ? [message.from]
            : field === "toaddr"
              ? message.toRecipients || []
              : field === "ccaddr"
                ? message.ccRecipients || []
                : field === "bccaddr"
                  ? message.bccRecipients || []
                  : [
                      message.from,
                      ...(message.toRecipients || []),
                      ...(message.ccRecipients || []),
                      ...(message.bccRecipients || []),
                    ];
        result = addresses.some(
          (p) => p?.emailAddress.address?.toLowerCase() === value.toLowerCase(),
        );
      } else if (field === "has")
        result = value === "attachment" && message.hasAttachments;
      else if (field === "is")
        result =
          value === "unread"
            ? !message.isRead
            : value === "read"
              ? message.isRead
              : value === "important"
                ? message.inferenceClassification === "focused"
                : message.inferenceClassification !== "focused";
      else if (field === "after") result = received >= value;
      else if (field === "before") result = received < value;
      else if (field === "on") result = received === value;
      else if (field === "folder" || field === "in")
        result = (message.parentFolderId === "inbox" ? "Inbox" : "Sent Items")
          .toLowerCase()
          .includes(value.toLowerCase());
      return excluded ? !result : result;
    };
    return evaluate(root);
  });
}
