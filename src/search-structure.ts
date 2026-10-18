// A small syntax tree keeps edits/removal from changing Boolean meaning.
export type SearchToken = { raw: string; start: number; end: number };
type Node = SearchToken & {
  kind: "term" | "and" | "or" | "not" | "group";
  children: Node[];
};
export function searchTokens(query: string): SearchToken[] | null {
  if (query.length > 4000) return null;
  const result: SearchToken[] = [];
  let start = -1,
    quoted = false;
  const flush = (end: number) => {
    if (start >= 0) result.push({ raw: query.slice(start, end), start, end });
    start = -1;
  };
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (!quoted && (/\s/.test(c) || c === "(" || c === ")")) {
      flush(i);
      if (c === "(" || c === ")") result.push({ raw: c, start: i, end: i + 1 });
    } else {
      if (start < 0) start = i;
      if (c === '"') quoted = !quoted;
    }
  }
  flush(query.length);
  return quoted || result.length > 100 ? null : result;
}
export function parseSearchTree(query: string): Node | null {
  const tokens = searchTokens(query);
  if (!tokens?.length) return null;
  let at = 0;
  const node = (
    kind: Node["kind"],
    children: Node[],
    start: number,
    end: number,
  ): Node => ({ kind, children, start, end, raw: query.slice(start, end) });
  const atom = (): Node => {
    const t = tokens[at++];
    if (!t || [")", "AND", "OR"].includes(t.raw))
      throw Error("Incomplete search");
    if (t.raw === "NOT") {
      const child = atom();
      return node("not", [child], t.start, child.end);
    }
    if (t.raw === "(") {
      const child = or();
      const close = tokens[at++];
      if (close?.raw !== ")") throw Error("Missing parenthesis");
      return node("group", [child], t.start, close.end);
    }
    return { ...t, kind: "term", children: [] };
  };
  const and = (): Node => {
    const children = [atom()];
    while (at < tokens.length && !["OR", ")"].includes(tokens[at].raw)) {
      if (tokens[at].raw === "AND") at++;
      children.push(atom());
    }
    return children.length === 1
      ? children[0]
      : node("and", children, children[0].start, children.at(-1)!.end);
  };
  const or = (): Node => {
    const children = [and()];
    while (tokens[at]?.raw === "OR") {
      at++;
      children.push(and());
    }
    return children.length === 1
      ? children[0]
      : node("or", children, children[0].start, children.at(-1)!.end);
  };
  try {
    const root = or();
    return at === tokens.length ? root : null;
  } catch {
    return null;
  }
}
function leaves(
  node: Node,
  negative = false,
): { token: Node; negative: boolean }[] {
  if (node.kind === "term")
    return [{ token: node, negative: negative || node.raw.startsWith("-") }];
  return node.children.flatMap((child) =>
    leaves(child, negative || node.kind === "not"),
  );
}
const labels: Record<string, string> = {
  from: "From",
  to: "To",
  cc: "Cc",
  bcc: "Bcc",
  person: "Person",
  fromaddr: "From address",
  toaddr: "To address",
  ccaddr: "Cc address",
  bccaddr: "Bcc address",
  personaddr: "Person address",
  subject: "Subject",
  body: "Body",
  filename: "File",
  filetype: "File type",
  after: "Since",
  before: "Before",
  on: "On",
  folder: "Folder",
  in: "Folder",
  is: "State",
  has: "Has",
};
export function conditionLabel(raw: string) {
  return raw.replace(
    /(-?)([a-z]+):("[^"]*"|[^\s()]+)/gi,
    (_all, excluded, field, val) =>
      `${excluded ? "Without " : ""}${labels[field.toLowerCase()] || field}: ${val.replaceAll('"', "")}`,
  );
}
export function searchConditions(query: string) {
  const root = parseSearchTree(query);
  if (!root) return [];
  const parts = root.kind === "and" ? root.children : [root];
  return parts.map((part, index) => ({
    raw: part.raw,
    label: conditionLabel(part.raw),
    query:
      parts
        .filter((_, n) => n !== index)
        .map((p) => p.raw)
        .join(" ") || "(is:read OR is:unread)",
  }));
}
export function withoutSearchDates(query: string) {
  const parts = searchConditions(query);
  return parts.length
    ? parts
        .filter((p) => !/^(after|before|on):/i.test(p.raw))
        .map((p) => p.raw)
        .join(" ")
    : query;
}
export function searchPeople(query: string) {
  const root = parseSearchTree(query);
  if (!root) return [];
  return leaves(root)
    .flatMap(({ token, negative }) => {
      const match =
        /^(-?)(from|to|cc|bcc|person):(?:"([^"]+)"|([^"\s]+))$/i.exec(
          token.raw,
        );
      if (!match) return [];
      const name = match[3] || match[4];
      if (
        name.toLowerCase() === "me" ||
        name.includes("@") ||
        name.length < 2 ||
        name.length > 80
      )
        return [];
      return [
        {
          name,
          label: `${negative ? "Exclude " : ""}${conditionLabel(token.raw.replace(/^-/, ""))}`,
          field: match[2].toLowerCase(),
          start: token.start,
          end: token.end,
          select: (address: string) =>
            query.slice(0, token.start) +
            `${match[1]}${match[2].toLowerCase()}addr:"${address.replaceAll('"', "")}"` +
            query.slice(token.end),
        },
      ];
    })
    .slice(0, 4);
}
// Curated word families, not a model. No changes to quoted/field/negated text.
const families = [
  ["hotel", "accommodation", "lodging"],
  ["booking", "reservation"],
  ["invoice", "bill", "billing"],
  ["refund", "reimbursement"],
  ["shipment", "delivery", "dispatch"],
  ["receipt", "proof of payment"],
  ["itinerary", "travel schedule"],
  ["ticket", "boarding pass"],
];
export function expandRelatedWords(query: string) {
  const root = parseSearchTree(query),
    expanded: string[] = [];
  if (!root) return { query, expanded };
  const edits: { start: number; end: number; text: string }[] = [];
  let budget = searchTokens(query)!.length;
  let characters = query.length;
  const completeFamily = (node: Node) => {
    const inner = node.kind === "group" ? node.children[0] : node;
    if (inner.kind !== "or" || !inner.children.every((c) => c.kind === "term"))
      return false;
    const words = inner.children.map((c) =>
      c.raw.replaceAll('"', "").toLowerCase().replace(/s$/, ""),
    );
    return families.some(
      (f) =>
        f.every((w) => words.includes(w)) && words.every((w) => f.includes(w)),
    );
  };
  const existingGroups = (node: Node): number =>
    node.kind === "not"
      ? 0
      : completeFamily(node)
        ? 1
        : node.children.reduce((n, c) => n + existingGroups(c), 0);
  const existing = existingGroups(root);
  const eligible = (
    node: Node,
    negative = false,
  ): ReturnType<typeof leaves> => {
    if (completeFamily(node)) return [];
    if (node.kind === "term")
      return [{ token: node, negative: negative || node.raw.startsWith("-") }];
    return node.children.flatMap((child) =>
      eligible(child, negative || node.kind === "not"),
    );
  };
  for (const { token, negative } of eligible(root)) {
    if (
      negative ||
      !/^\p{L}+$/u.test(token.raw) ||
      existing + expanded.length >= 4
    )
      continue;
    const word = token.raw.toLowerCase().replace(/s$/, "");
    const family = families.find((words) => words.includes(word));
    if (!family) continue;
    const alternatives = [
      ...new Set([
        token.raw,
        ...family.filter((w) => w !== token.raw.toLowerCase()),
      ]),
    ];
    const text = `(${alternatives.map((w) => (w.includes(" ") ? `"${w}"` : w)).join(" OR ")})`;
    if (
      budget + alternatives.length * 2 > 100 ||
      characters + text.length - token.raw.length > 4000
    )
      continue;
    edits.push({ start: token.start, end: token.end, text });
    expanded.push(`${token.raw} → ${alternatives.slice(1).join(", ")}`);
    budget += alternatives.length * 2;
    characters += text.length - token.raw.length;
  }
  for (const edit of edits.reverse())
    query = query.slice(0, edit.start) + edit.text + query.slice(edit.end);
  return { query, expanded };
}
