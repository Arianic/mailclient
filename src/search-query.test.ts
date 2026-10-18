import { describe, it, expect } from "vitest";
import { interpretSearch, addSearchFilter } from "./search-query";
describe("mail search interpretation", () => {
  const now = new Date(2026, 9, 18, 12);
  it("translates common requests into explicit people, date and attachment filters", () => {
    expect(
      interpretSearch(
        "emails from alex about invoices last month with attachments",
        now,
      ).query,
    ).toBe(
      "from:alex invoices after:2026-09-01 before:2026-10-01 has:attachment",
    );
  });
  it("preserves quoted text and explicit field values", () => {
    expect(interpretSearch('subject:"last month" from:today', now).query).toBe(
      'subject:"last month" from:today',
    );
    expect(interpretSearch('"emails from alex"', now).query).toBe(
      '"emails from alex"',
    );
  });
  it("uses calendar boundaries across year changes", () => {
    expect(interpretSearch("last month", new Date(2026, 0, 3)).query).toBe(
      "after:2025-12-01 before:2026-01-01",
    );
    expect(interpretSearch("last week", now).query).toBe(
      "after:2026-10-05 before:2026-10-12",
    );
  });
  it("adds filter values without injecting extra operators", () => {
    expect(addSearchFilter("invoice", "from", "Alex Morgan")).toBe(
      'invoice from:"Alex Morgan"',
    );
    expect(addSearchFilter("invoice", "from", 'Alex" OR "Morgan')).toBe(
      'invoice from:"Alex OR Morgan"',
    );
  });
  it.each([
    ["find invoices from Alex Morgan", 'invoices from:"Alex Morgan"'],
    [
      "show me unread important emails from Alex",
      "is:unread is:important from:Alex",
    ],
    [
      "messages from Alex Or Sam with attachments",
      "(from:Alex OR from:Sam) has:attachment",
    ],
    [
      "show me unread emails from Alex Morgan about invoices with attachments",
      'is:unread from:"Alex Morgan" invoices has:attachment',
    ],
    ['messages received from "Alex Morgan" to me', 'from:"Alex Morgan" to:me'],
    ["emails sent by me to alex@example.test", "from:me to:alex@example.test"],
    [
      "messages involving Alex Morgan without attachments",
      'person:"Alex Morgan" -has:attachment',
    ],
    [
      "emails not from Alex Morgan about invoices",
      'NOT (from:"Alex Morgan") invoices',
    ],
    [
      "emails from Alex or from Sam with attachments",
      "(from:Alex OR from:Sam) has:attachment",
    ],
    [
      "emails from Alex Morgan or Sam Jones with attachments",
      '(from:"Alex Morgan" OR from:"Sam Jones") has:attachment',
    ],
    [
      "emails I sent to Alex in Sent Items",
      'from:me to:Alex folder:"Sent Items"',
    ],
    ["emails in archive without attachments", "folder:Archive -has:attachment"],
    ["emails from Alex and to me", "from:Alex AND to:me"],
    [
      'messages in folder "Sent Items" subject contains "booking reference"',
      'folder:"Sent Items" subject:"booking reference"',
    ],
    [
      "emails subject contains quarterly report last month",
      "subject:quarterly subject:report after:2026-09-01 before:2026-10-01",
    ],
    [
      "emails body contains reservation number from Alex",
      "body:reservation body:number from:Alex",
    ],
    [
      "messages with an attachment file named invoice.pdf",
      "has:attachment filename:invoice.pdf",
    ],
    ["emails excluding from Sam that are unread", "NOT (from:Sam) is:unread"],
    ["read messages from Sam", "is:read from:Sam"],
    ["other emails from Sam", "is:other from:Sam"],
    ["messages marked as read", "is:read"],
    ["emails from Zoë Müller", 'from:"Zoë Müller"'],
  ])("interprets %s", (input, expected) => {
    expect(interpretSearch(input, now).query).toBe(expected);
  });
  it.each([
    ["this week", "after:2026-10-12 before:2026-10-19"],
    ["this month", "after:2026-10-01 before:2026-11-01"],
    ["last year", "after:2025-01-01 before:2026-01-01"],
    ["past week", "after:2026-10-12 before:2026-10-19"],
    ["last 14 days", "after:2026-10-05 before:2026-10-19"],
    ["past two weeks", "after:2026-10-05 before:2026-10-19"],
    ["last 3 months", "after:2026-07-18 before:2026-10-19"],
    ["last Friday", "on:2026-10-16"],
    ["last Sunday", "on:2026-10-11"],
    ["this Sunday", "on:2026-10-18"],
    ["on October 12, 2026", "on:2026-10-12"],
    ["on 12th October 2026", "on:2026-10-12"],
    ["on 2026-10-12", "on:2026-10-12"],
    ["in September 2025", "after:2025-09-01 before:2025-10-01"],
    ["during 2025", "after:2025-01-01 before:2026-01-01"],
    ["since September 1", "after:2026-09-01"],
    ["after yesterday", "after:2026-10-17"],
    ["before October 12", "before:2026-10-12"],
    ["until October 12", "before:2026-10-13"],
    ["through September 2026", "before:2026-10-01"],
    [
      "between September 1 and September 30",
      "after:2026-09-01 before:2026-10-01",
    ],
    ["between 2025-12-30 and 2026-01-02", "after:2025-12-30 before:2026-01-03"],
    ["older than 30 days", "before:2026-09-18"],
    ["newer than 2 weeks", "after:2026-10-04"],
  ])("interprets calendar request %s", (input, expected) => {
    expect(interpretSearch(input, now).query).toBe(expected);
  });
  it("clamps rolling months/years and keeps dates local through DST", () => {
    expect(interpretSearch("past month", new Date(2024, 2, 31)).query).toBe(
      "after:2024-02-29 before:2024-04-01",
    );
    expect(
      interpretSearch("older than 1 year", new Date(2024, 1, 29)).query,
    ).toBe("before:2023-02-28");
    expect(interpretSearch("last 2 days", new Date(2026, 2, 30)).query).toBe(
      "after:2026-03-29 before:2026-03-31",
    );
    expect(interpretSearch("on February 29 2024", now).query).toBe(
      "on:2024-02-29",
    );
  });
  it.each([
    'subject:"emails from Alex last month" filename:"today report.pdf"',
    'from:"Alex  Morgan" (invoice OR receipt) -folder:junk',
    'body:"https://example.com/today" after:2026-01-01',
    '"from Alex" "last month" "important"',
    "subject:today from:last filename:important",
    "mail:today",
    "May report",
    "invoice 2025",
    "on 02/03/2026",
    "on February 30 2026",
    "on 2026-02-30",
    "last 0 days",
    "mail",
    'from "Alex',
    '"unclosed last month',
  ])("preserves literals or unsupported/invalid input: %s", (input) => {
    expect(interpretSearch(input, now).query).toBe(input);
  });
  it("keeps generated filters stable on reinterpretation", () => {
    const first = interpretSearch(
      "show me unread emails from Alex Morgan between September 1 and September 30 with attachments",
      now,
    );
    expect(first.query).toBe(
      'is:unread from:"Alex Morgan" after:2026-09-01 before:2026-10-01 has:attachment',
    );
    expect(first.interpreted).toBe(true);
    expect(interpretSearch(first.query, now)).toMatchObject({
      query: first.query,
      interpreted: false,
    });
  });
  it("does not process oversized input before native validation", () => {
    const input = "last month ".repeat(1000);
    expect(interpretSearch(input, now)).toMatchObject({
      query: input.trim(),
      interpreted: false,
    });
  });
});
