export function interpretSearch(original: string, now = new Date()) {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - ((today.getDay() + 6) % 7),
  );
  const notes: string[] = [];
  const pieces = original.match(/"[^"]*"|[^"]+/g) || [];
  const query = pieces
    .map((piece) => {
      if (piece.startsWith('"')) return piece;
      let text = piece.replace(
        /^\s*(?:(?:find|show)\s+)?(?:me\s+)?(?:(unread)\s+)?(?:emails?|messages?)\s+(?=from\b|to\b|about\b|containing\b|with\b|last\b|this\b|today\b|yesterday\b)/i,
        (_, unread) => (unread ? "is:unread " : ""),
      );
      text = text.replace(
        /\b(from|to)\s+([\w@.+-]+)/gi,
        (_, field, value) => `${field.toLowerCase()}:${value}`,
      );
      if (/\b(?:emails?|messages?)\b/i.test(original))
        text = text.replace(/\b(?:about|containing)\s+/gi, "");
      const replace = (pattern: RegExp, value: string) => {
        text = text.replace(pattern, () => {
          notes.push(value);
          return value;
        });
      };
      replace(
        /(?<![\w:])last month\b/gi,
        `after:${iso(new Date(today.getFullYear(), today.getMonth() - 1, 1))} before:${iso(new Date(today.getFullYear(), today.getMonth(), 1))}`,
      );
      replace(
        /(?<![\w:])this month\b/gi,
        `after:${iso(new Date(today.getFullYear(), today.getMonth(), 1))}`,
      );
      replace(
        /(?<![\w:])last week\b/gi,
        `after:${iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7))} before:${iso(monday)}`,
      );
      replace(
        /(?<![\w:])last year\b/gi,
        `after:${today.getFullYear() - 1}-01-01 before:${today.getFullYear()}-01-01`,
      );
      replace(/(?<![\w:])this year\b/gi, `after:${today.getFullYear()}-01-01`);
      text = text.replace(
        /(?<![\w:])last (\d{1,3}) days\b/gi,
        (_, days) =>
          `after:${iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(days)))}`,
      );
      replace(/(?<![\w:])today\b(?!')/gi, `on:${iso(today)}`);
      replace(
        /(?<![\w:])yesterday\b(?!')/gi,
        `on:${iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))}`,
      );
      replace(/\bwith attachments?\b/gi, "has:attachment");
      replace(/\bunread (?:emails?|messages?)\b/gi, "is:unread");
      return text;
    })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  return { query, interpreted: query !== original.trim(), notes };
}
export function addSearchFilter(query: string, key: string, value: string) {
  if (!value.trim()) return query;
  const literal = value.trim().replaceAll('"', "");
  return `${query} ${key}:${/\s/.test(literal) ? `"${literal}"` : literal}`.trim();
}
