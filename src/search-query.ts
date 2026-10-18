type Match = { query: string; end: number };
type Period = { start: Date; end: Date; endAt: number };
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const monthNames =
  /^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)$/;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (d: Date, n = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const range = (p: Period) => `after:${iso(p.start)} before:${iso(p.end)}`;
const value = (s: string) =>
  s.startsWith('"') ? s : /[\s:()]/.test(s) ? `"${s}"` : s;

// Keep quoted values (including their whitespace) and explicit filters intact.
// Leave malformed quotation marks to the native query parser's error handling.
function lex(input: string): string[] | null {
  const out: string[] = [];
  let token = "",
    quoted = false;
  for (const c of input) {
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === "(" || c === ")" || /\s/.test(c))) {
      if (token) out.push(token);
      token = "";
      if (c === "(" || c === ")") out.push(c);
    } else token += c;
  }
  if (quoted) return null;
  if (token) out.push(token);
  return out;
}

function shifted(today: Date, amount: number, unit: string) {
  if (unit.startsWith("day")) return day(today, -amount);
  if (unit.startsWith("week")) return day(today, -7 * amount);
  // Clamp month/year arithmetic instead of letting February 31 roll into March.
  const target = new Date(
    today.getFullYear() - (unit.startsWith("year") ? amount : 0),
    today.getMonth() - (unit.startsWith("month") ? amount : 0),
    1,
  );
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(
      today.getDate(),
      new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(),
    ),
  );
}

function datePeriod(words: string[], at: number, today: Date): Period | null {
  const w = words[at],
    next = words[at + 1];
  const single = (start: Date, endAt: number): Period => ({
    start,
    end: day(start, 1),
    endAt,
  });
  if (w === "today" || w === "yesterday")
    return single(day(today, w === "today" ? 0 : -1), at + 1);
  if (w === "this" || w === "last") {
    const previous = w === "last" ? 1 : 0;
    if (next === "week") {
      const start = day(today, -((today.getDay() + 6) % 7) - previous * 7);
      return { start, end: day(start, 7), endAt: at + 2 };
    }
    if (next === "month") {
      const start = new Date(
        today.getFullYear(),
        today.getMonth() - previous,
        1,
      );
      return {
        start,
        end: new Date(start.getFullYear(), start.getMonth() + 1, 1),
        endAt: at + 2,
      };
    }
    if (next === "year") {
      const year = today.getFullYear() - previous;
      return {
        start: new Date(year, 0, 1),
        end: new Date(year + 1, 0, 1),
        endAt: at + 2,
      };
    }
    const weekday = weekdays.indexOf(next);
    if (weekday >= 0) {
      const delta =
        w === "this"
          ? -((today.getDay() + 6) % 7) + ((weekday + 6) % 7)
          : -((today.getDay() - weekday + 7) % 7 || 7);
      return single(day(today, delta), at + 2);
    }
  }
  if (["last", "past", "previous"].includes(w)) {
    const number =
      /^(?:[1-9]\d{0,2}|one|two|three|four|five|six|seven|eight|nine|ten)$/.test(
        next || "",
      )
        ? Number(next) ||
          [
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
          ].indexOf(next) + 1
        : 0;
    const unit = words[at + (number ? 2 : 1)];
    if (
      /^(days?|weeks?|months?|years?)$/.test(unit || "") &&
      (number || w === "past")
    ) {
      const n = number || 1;
      const start = /^(days?|weeks?)$/.test(unit)
        ? day(today, 1 - n * (unit.startsWith("week") ? 7 : 1))
        : shifted(today, n, unit);
      return { start, end: day(today, 1), endAt: at + (number ? 3 : 2) };
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w || "")) {
    const [y, m, d] = w.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    if (y >= 1900 && y <= 9998 && iso(start) === w)
      return single(start, at + 1);
    return null;
  }
  // Written month names are unambiguous across locales; slash dates stay literal.
  const monthFirst = monthNames.test(w || ""),
    dayFirst =
      /^\d{1,2}(?:st|nd|rd|th)?$/.test(w || "") && monthNames.test(next || "");
  if (monthFirst || dayFirst) {
    const month = months.indexOf((monthFirst ? w : next).slice(0, 3));
    const dayWord = (monthFirst ? next : w)?.replace(/,$/, "");
    const hasDay = /^\d{1,2}(?:st|nd|rd|th)?$/.test(dayWord || "");
    const yearAt = at + (hasDay ? 2 : 1);
    const hasYear = /^\d{4}$/.test(words[yearAt] || "");
    const year = hasYear ? Number(words[yearAt]) : today.getFullYear();
    if (year < 1900 || year > 9998) return null;
    if (hasDay) {
      const date = parseInt(dayWord),
        start = new Date(year, month, date);
      if (start.getMonth() !== month || start.getDate() !== date) return null;
      return single(start, yearAt + (hasYear ? 1 : 0));
    }
    if (monthFirst)
      return {
        start: new Date(year, month, 1),
        end: new Date(year, month + 1, 1),
        endAt: yearAt + (hasYear ? 1 : 0),
      };
  }
  if (/^(?:19|[2-9]\d)\d{2}$/.test(w || "") && Number(w) <= 9998) {
    const y = Number(w);
    return {
      start: new Date(y, 0, 1),
      end: new Date(y + 1, 0, 1),
      endAt: at + 1,
    };
  }
  return null;
}

function dateClause(words: string[], at: number, today: Date): Match | null {
  const w = words[at];
  if (w === "between") {
    const first = datePeriod(words, at + 1, today);
    const second =
      first && words[first.endAt] === "and"
        ? datePeriod(words, first.endAt + 1, today)
        : null;
    if (first && second && first.start <= second.start)
      return {
        query: `after:${iso(first.start)} before:${iso(second.end)}`,
        end: second.endAt,
      };
    return null;
  }
  if ((w === "older" || w === "newer") && words[at + 1] === "than") {
    const n = Number(words[at + 2]),
      unit = words[at + 3];
    if (
      Number.isInteger(n) &&
      n > 0 &&
      n <= 999 &&
      /^(days?|weeks?|months?|years?)$/.test(unit || "")
    )
      return {
        query: `${w === "older" ? "before" : "after"}:${iso(shifted(today, n, unit))}`,
        end: at + 4,
      };
  }
  const introduced = [
    "on",
    "in",
    "during",
    "since",
    "after",
    "before",
    "until",
    "through",
  ].includes(w);
  const period = datePeriod(words, at + (introduced ? 1 : 0), today);
  // Bare dates/month names/numbers remain keywords: "May report" is not a date filter.
  if (
    !period ||
    (!introduced &&
      !["today", "yesterday", "this", "last", "past", "previous"].includes(w))
  )
    return null;
  const query =
    w === "since" || w === "after"
      ? `after:${iso(period.start)}`
      : w === "before"
        ? `before:${iso(period.start)}`
        : w === "until" || w === "through"
          ? `before:${iso(period.end)}`
          : period.end.getTime() === day(period.start, 1).getTime()
            ? `on:${iso(period.start)}`
            : range(period);
  return { query, end: period.endAt };
}

const people: [string[], string][] = [
  [["received", "from"], "from"],
  [["sent", "by"], "from"],
  [["sent", "to"], "to"],
  [["from"], "from"],
  [["to"], "to"],
  [["cc"], "cc"],
  [["bcc"], "bcc"],
  [["involving"], "person"],
  [["with", "person"], "person"],
  [["with", "contact"], "person"],
];
const fields: [string[], string][] = [
  [["in", "the", "folder"], "folder"],
  [["in", "folder"], "folder"],
  [["in", "the", "subject"], "subject"],
  [["subject", "contains"], "subject"],
  [["subject", "containing"], "subject"],
  [["subject", "is"], "subject"],
  [["body", "contains"], "body"],
  [["body", "containing"], "body"],
  [["attachment", "named"], "filename"],
  [["attachments", "named"], "filename"],
  [["file", "named"], "filename"],
  [["filename", "contains"], "filename"],
];
const fixed: [string[], string][] = [
  [["i", "sent"], "from:me"],
  [["sent", "by", "me"], "from:me"],
  [["without", "attachments"], "-has:attachment"],
  [["without", "an", "attachment"], "-has:attachment"],
  [["without", "attachment"], "-has:attachment"],
  [["with", "no", "attachments"], "-has:attachment"],
  [["with", "attachments"], "has:attachment"],
  [["with", "an", "attachment"], "has:attachment"],
  [["with", "attachment"], "has:attachment"],
  [["that", "have", "attachments"], "has:attachment"],
  [["that", "are", "unread"], "is:unread"],
  [["that", "are", "read"], "is:read"],
  [["marked", "as", "unread"], "is:unread"],
  [["marked", "as", "read"], "is:read"],
  [["in", "sent", "items"], 'folder:"Sent Items"'],
  [["in", "deleted", "items"], 'folder:"Deleted Items"'],
  [["in", "inbox"], "folder:Inbox"],
  [["in", "archive"], "folder:Archive"],
  [["in", "junk"], "folder:Junk"],
  [["in", "drafts"], "folder:Drafts"],
  [["unread"], "is:unread"],
  [["important"], "is:important"],
];

export function interpretSearch(original: string, now = new Date()) {
  const unchanged = {
    query: original.trim(),
    interpreted: false,
    notes: [] as string[],
  };
  if (original.length > 4000) return unchanged;
  const tokens = lex(original);
  if (!tokens) return unchanged;
  const words = tokens.map((t) => t.toLowerCase());
  const today = day(now),
    notes: string[] = [],
    output: string[] = [];
  const starts = (at: number, phrase: string[]) =>
    phrase.every((w, n) => words[at + n] === w);
  const explicit = (at: number) =>
    /[:"()]/.test(tokens[at] || "") || /^(AND|OR|NOT)$/.test(tokens[at] || "");
  const heading =
    /^(?:(?:find|show|search(?: for)?|look for)\s+)?(?:(?:me|all|my|the)\s+)*((?:(?:unread|read|important|other)\s+)*)(?:emails?|messages?|mail)(?=\s|$)\s*/i.exec(
      original.trim(),
    );
  const command = /^(?:find|show|search for|look for)\s+(?:me\s+)?/i.exec(
    original.trim(),
  );
  let at = 0;
  if (heading) {
    const headingTokens = lex(heading[0].trim()) || [];
    at = headingTokens.length;
    if (heading[1])
      output.push(
        ...heading[1]
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map((state) => `is:${state}`),
      );
  } else if (command) {
    at = (lex(command[0].trim()) || []).length;
  }
  const boundary = (i: number): boolean => {
    if (i >= tokens.length || explicit(i)) return true;
    if (
      [
        "and",
        "or",
        "not",
        "except",
        "excluding",
        "about",
        "containing",
      ].includes(words[i])
    )
      return true;
    if (dateClause(words, i, today)) return true;
    return [...people, ...fields, ...fixed].some(([p]) => starts(i, p));
  };
  const match = (i: number): Match | null => {
    if (explicit(i)) return null;
    const date = dateClause(words, i, today);
    if (date) return date;
    for (const [phrase, query] of fixed)
      if (starts(i, phrase)) return { query, end: i + phrase.length };
    for (const [phrase, field] of [...people, ...fields]) {
      if (!starts(i, phrase)) continue;
      const readValue = (begin: number): Match | null => {
        let end = begin;
        if (tokens[begin]?.startsWith('"')) end++;
        else while (end < tokens.length && !boundary(end)) end++;
        if (end === begin) return null;
        const parts = tokens.slice(begin, end);
        const query =
          field === "body" || field === "subject"
            ? parts.map((t) => `${field}:${value(t)}`).join(" ")
            : `${field}:${value(parts.join(" "))}`;
        return { query, end };
      };
      const first = readValue(i + phrase.length);
      if (!first) return null;
      let end = first.end;
      const alternatives = [first.query];
      // Group natural-language people alternatives before applying later filters.
      // Uppercase OR retains the expert query grammar and its usual precedence.
      if (people.some(([, f]) => f === field)) {
        while (words[end] === "or" && tokens[end] !== "OR") {
          const begin = end + 1 + (starts(end + 1, phrase) ? phrase.length : 0);
          const next = readValue(begin);
          if (!next) break;
          alternatives.push(next.query);
          end = next.end;
        }
      }
      return {
        query:
          alternatives.length > 1
            ? `(${alternatives.join(" OR ")})`
            : first.query,
        end,
      };
    }
    return null;
  };
  while (at < tokens.length) {
    let found: Match | null = null;
    if (["not", "except", "excluding"].includes(words[at])) {
      const inner = match(at + 1);
      if (inner) found = { query: `NOT (${inner.query})`, end: inner.end };
    }
    found ||= match(at);
    if (found) {
      output.push(found.query);
      notes.push(found.query);
      at = found.end;
    } else if (
      ["and", "or"].includes(words[at]) &&
      output.length &&
      (match(at + 1) ||
        (/^(?:not|except|excluding)$/.test(words[at + 1] || "") &&
          match(at + 2)))
    ) {
      output.push(words[at].toUpperCase());
      at++;
    } else if (
      (heading || command || notes.length || at === 0) &&
      ["about", "containing"].includes(words[at])
    )
      at++;
    else {
      output.push(tokens[at]);
      at++;
    }
  }
  const query = output.join(" ");
  // An ordinary keyword like "mail" must not accidentally become "all mail".
  if (!query || (!notes.length && !heading && !command)) return unchanged;
  return { query, interpreted: query !== original.trim(), notes };
}

export function addSearchFilter(query: string, key: string, value: string) {
  if (!value.trim()) return query;
  const literal = value.trim().replaceAll('"', "");
  return `${query} ${key}:${/\s/.test(literal) ? `"${literal}"` : literal}`.trim();
}
