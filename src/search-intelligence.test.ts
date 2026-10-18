import { describe, expect, it } from "vitest";
import { interpretSearch } from "./search-query";
import {
  expandRelatedWords,
  searchConditions,
  searchPeople,
} from "./search-structure";
const now = new Date(2026, 9, 18, 12);
describe("forgiving local mail grammar", () => {
  it.each([
    [
      "Could you please find me emails Alex Morgan sent me last September?",
      'from:"Alex Morgan" to:me after:2026-09-01 before:2026-10-01',
    ],
    [
      "Could you dig up PDFs Alex sent me last September, excluding anything about refunds?",
      'has:attachment filename:"pdf" from:Alex to:me after:2026-09-01 before:2026-10-01 NOT (refunds)',
    ],
    [
      "Find hotel booking Alex sent me last December",
      "hotel booking from:Alex to:me after:2025-12-01 before:2026-01-01",
    ],
    [
      "emails that Alex sent me with attachments",
      "from:Alex to:me has:attachment",
    ],
    [
      "show me anything Alex emailed to Sam last month",
      "from:Alex to:Sam after:2026-09-01 before:2026-10-01",
    ],
    ["emails from Alex but not Sam", "from:Alex NOT (from:Sam)"],
    [
      "emails from Alex or Sam but only with attachments",
      "(from:Alex OR from:Sam) has:attachment",
    ],
    [
      "emails from Alex or Sam but not Taylor",
      "(from:Alex OR from:Sam) NOT (from:Taylor)",
    ],
    ["emails from Alex with PDFs", 'from:Alex has:attachment filename:"pdf"'],
    [
      "messages recieved from Alex with attachements",
      "from:Alex has:attachment",
    ],
    ["unraed emails from Alex", "is:unread from:Alex"],
    ["emials from Alex", "from:Alex"],
    [
      "the week before last from Alex",
      "after:2026-09-28 before:2026-10-05 from:Alex",
    ],
    ["emails in the last fortnight", "after:2026-10-05 before:2026-10-19"],
    ["emails a couple of weeks ago", "on:2026-10-04"],
    [
      "messages from Alex recently",
      "from:Alex after:2026-09-19 before:2026-10-19",
    ],
    [
      "emails from Alex in early September",
      "from:Alex after:2026-09-01 before:2026-09-11",
    ],
    ["emails mid September", "after:2026-09-11 before:2026-09-21"],
    ["emails late February 2024", "after:2024-02-21 before:2024-03-01"],
    [
      "messages around Christmas last year",
      "after:2025-12-22 before:2025-12-29",
    ],
    ["messages on Christmas 2025", "on:2025-12-25"],
  ])("understands %s", (input, expected) =>
    expect(interpretSearch(input, now).query).toBe(expected),
  );
  it("explains uncertain dates and small grammar corrections", () => {
    expect(
      interpretSearch("emails early September", now).assumptions,
    ).toContain("Early month means days 1–10.");
    expect(
      interpretSearch("emails around Christmas last year", now).assumptions,
    ).toContain("Around Christmas means December 22–28.");
    expect(
      interpretSearch("emails with attachements", now).assumptions.join(" "),
    ).toContain("attachments");
  });
  it.each([
    'subject:"Could you find emails Alex sent me?"',
    '"early September"',
    'from:"Attachements"',
    '"Alex sent me"',
    'body:"last September"',
  ])("protects literal wording in %s", (input) =>
    expect(interpretSearch(input, now).query).toBe(input),
  );
});
describe("structured search editing", () => {
  it("removes whole alternatives/negations and retains all other requirements", () => {
    const parts = searchConditions(
      "is:unread (from:Alex OR from:Sam) NOT (refund OR complaint) has:attachment",
    );
    expect(parts).toHaveLength(4);
    expect(parts[1].query).toBe(
      "is:unread NOT (refund OR complaint) has:attachment",
    );
    expect(parts[2].query).toBe(
      "is:unread (from:Alex OR from:Sam) has:attachment",
    );
    expect(searchConditions("invoice OR receipt")).toHaveLength(1);
    expect(searchConditions("invoice OR receipt")[0].query).toBe(
      "(is:read OR is:unread)",
    );
  });
  it("does not offer editing for incomplete Boolean expressions", () => {
    for (const q of ["invoice OR", "(invoice", '"invoice', "invoice AND"])
      expect(searchConditions(q)).toEqual([]);
  });
  it("replaces exactly the selected person with an exact address", () => {
    const q =
      'is:unread (from:"Alex Morgan" OR from:Sam) NOT (to:Alex) subject:"Alex"';
    const people = searchPeople(q);
    expect(people.map((p) => p.name)).toEqual(["Alex Morgan", "Sam", "Alex"]);
    expect(people[0].select("alex@example.test")).toBe(
      'is:unread (fromaddr:"alex@example.test" OR from:Sam) NOT (to:Alex) subject:"Alex"',
    );
    expect(people[2].select("alex@example.test")).toContain(
      'NOT (toaddr:"alex@example.test")',
    );
    expect(searchPeople("from:me person:alex@example.test")).toEqual([]);
  });
  it("expands dictionary words while preserving phrases, fields and exclusions", () => {
    const r = expandRelatedWords(
      'hotel booking from:Alex "hotel booking" -refund NOT (invoice OR bill)',
    );
    expect(r.query).toBe(
      '(hotel OR accommodation OR lodging) (booking OR reservation) from:Alex "hotel booking" -refund NOT (invoice OR bill)',
    );
    expect(r.expanded).toHaveLength(2);
    expect(expandRelatedWords(r.query).query).toBe(r.query);
    const plural = expandRelatedWords("invoices");
    expect(plural.query).toBe("(invoices OR invoice OR bill OR billing)");
    expect(expandRelatedWords(plural.query).query).toBe(plural.query);
    const many = expandRelatedWords("hotel booking invoice refund shipment");
    expect(expandRelatedWords(many.query).query).toBe(many.query);
    expect(expandRelatedWords("hotel OR receipt").query).toBe(
      '(hotel OR accommodation OR lodging) OR (receipt OR "proof of payment")',
    );
  });
});
