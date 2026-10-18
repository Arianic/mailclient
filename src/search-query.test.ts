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
});
