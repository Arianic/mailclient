import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { ThemedSelect } from "./ThemedSelect";
import { addSearchFilter, interpretSearch } from "./search-query";
import type { IndexStatus } from "./outlook";
import { outlookApi, type Contact } from "./outlook";
import {
  expandRelatedWords,
  searchConditions,
  searchPeople,
  withoutSearchDates,
} from "./search-structure";
export function SearchControls({
  query,
  onQuery,
  sort,
  onSort,
  status,
  canonical,
  related = false,
  onRelatedChange = () => {},
}: {
  query: string;
  onQuery: (query: string) => void;
  sort: string;
  onSort: (sort: string) => void;
  status: IndexStatus | null;
  canonical?: string;
  related?: boolean;
  onRelatedChange?: (related: boolean) => void;
}) {
  const [filters, setFilters] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [after, setAfter] = useState(""),
    [before, setBefore] = useState(""),
    [filename, setFilename] = useState(""),
    [folder, setFolder] = useState(""),
    [unread, setUnread] = useState(false),
    [attached, setAttached] = useState(false);
  const interpreted = interpretSearch(query);
  const active = canonical ?? interpreted.query;
  const [editingDates, setEditingDates] = useState(false);
  const editDates = () => {
    const parts = searchConditions(active);
    const dateValue = (field: string) =>
      parts
        .find((p) => p.raw.startsWith(`${field}:`))
        ?.raw.slice(field.length + 1) || "";
    const on = dateValue("on");
    let end = "";
    if (on) {
      const [y, m, d] = on.split("-").map(Number),
        next = new Date(y, m - 1, d + 1);
      end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    }
    setAfter(dateValue("after") || on);
    setBefore(dateValue("before") || end);
    setEditingDates(true);
    setFilters(true);
  };
  const [people, setPeople] = useState<{
    query: string;
    entries: {
      person: ReturnType<typeof searchPeople>[number];
      contacts: Contact[];
    }[];
  } | null>(null);
  const [cacheRevision, setCacheRevision] = useState(0);
  useEffect(() => {
    const clear = () => {
      setPeople(null);
      setCacheRevision((n) => n + 1);
    };
    window.addEventListener("outlook-cache-cleared", clear);
    return () => window.removeEventListener("outlook-cache-cleared", clear);
  }, []);
  useEffect(() => {
    let live = true;
    setPeople(null);
    const timer = setTimeout(() => {
      const names = searchPeople(active);
      void Promise.all(
        names.map(async (person) => ({
          person,
          contacts: await outlookApi.contacts(person.name),
        })),
      )
        .then((entries) => {
          if (live) setPeople({ query: active, entries });
        })
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, cacheRevision, status?.messages]);
  return (
    <div className="search-controls">
      <div className="list-toolbar">
        <button
          className="soft-button"
          aria-expanded={filters}
          onClick={() => setFilters(!filters)}
        >
          <SlidersHorizontal size={14} />
          Filters
        </button>
        <details className="search-help">
          <summary>Search tips</summary>
          <div>
            Search words or an exact <code>"quoted phrase"</code>. Use{" "}
            <code>OR</code>, parentheses and <code>-word</code> to exclude.
            <p>
              <code>from:alex invoice has:attachment after:2026-09-01</code>
            </p>
            <p>
              Fields: from, to, cc, bcc, person, subject, body, filename,
              folder, before, after, on, is:unread, is:read, is:important. Words
              match prefixes; quotes match phrases. Quote words to search them
              literally instead of interpreting them as filters.
            </p>
            <p>
              Try <code>unread emails from Alex Morgan last month</code>,{" "}
              <code>emails from Alex or Sam without attachments</code>, or{" "}
              <code>emails between September 1 and September 30</code>. You can
              also use “last Friday”, “past two weeks”, “not from”, “in folder”,
              “subject contains”, and “file named”. The interpreted filters
              appear below.
            </p>
            <p>
              “Could you dig up PDFs Alex sent last September?” also works. Use
              the condition pills to remove filters, Edit dates to correct a
              range, and the person suggestions to choose an exact address.
              Related words uses an optional local dictionary, with no AI. Empty
              searches offer measured changes and spelling suggestions.
            </p>
            <p>
              Search stays on this computer. Attachment names are indexed; text
              inside attached files is not.
            </p>
          </div>
        </details>
        <button
          className="soft-button"
          aria-pressed={related}
          title="Expand unquoted keywords using a local word dictionary. No AI."
          onClick={() => onRelatedChange(!related)}
        >
          Related words
        </button>
        <span className="grow" />
        <ThemedSelect
          aria-label="Search sorting"
          value={sort}
          onValueChange={onSort}
        >
          <option value="relevance">Best match</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </ThemedSelect>
        <button
          className="icon-button"
          aria-label="Clear search"
          onClick={() => onQuery("")}
        >
          <X size={14} />
        </button>
      </div>
      {(interpreted.interpreted || active !== query.trim()) && (
        <p className="search-interpretation">
          Searching: <code>{active}</code>
        </p>
      )}
      {!!active && (
        <div className="search-conditions" aria-label="Search conditions">
          {searchConditions(active).map((part, index) => (
            <button
              key={`${index}:${part.raw}`}
              className="search-condition"
              aria-label={`Remove ${part.label}`}
              onClick={() => onQuery(part.query)}
              title="Remove this condition"
            >
              <span>{part.label}</span>
              <X size={11} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {!!interpreted.assumptions.length && (
        <p className="search-assumptions">
          {interpreted.assumptions.join(" ")} Inspect the conditions above or
          refine them with Filters.
        </p>
      )}
      {searchConditions(active).some((p) =>
        /^(after|before|on):/.test(p.raw),
      ) && (
        <button className="text-button search-edit-dates" onClick={editDates}>
          Edit dates
        </button>
      )}
      {related && (
        <p className="search-assumptions">
          Local dictionary enabled.{" "}
          {expandRelatedWords(interpreted.query).expanded.join(" · ") ||
            "No related word groups for these keywords."}
        </p>
      )}
      {people?.query === active &&
        people.entries
          .filter((entry) => entry.contacts.length)
          .map(({ person, contacts }) => (
            <details
              className="search-people"
              key={`${person.start}:${person.name}`}
            >
              <summary>
                Choose exact person · {person.label} · {contacts.length}{" "}
                suggestions
              </summary>
              <p>
                From saved mail. Choose an address to narrow this condition; no
                person is selected automatically.
              </p>
              <div>
                {contacts
                  .filter((c) => c.address)
                  .map((contact) => (
                    <button
                      className="search-person"
                      key={contact.address}
                      onClick={() => onQuery(person.select(contact.address!))}
                    >
                      <strong>{contact.name || contact.address}</strong>
                      <span>{contact.address}</span>
                    </button>
                  ))}
              </div>
            </details>
          ))}
      {filters && (
        <form
          className="advanced-search"
          onSubmit={(event) => {
            event.preventDefault();
            let next =
              editingDates || after || before
                ? withoutSearchDates(active)
                : active;
            for (const [key, value] of [
              ["from", from],
              ["to", to],
              ["after", after],
              ["before", before],
              ["filename", filename],
              ["folder", folder],
            ])
              next = addSearchFilter(next, key, value);
            if (unread) next = addSearchFilter(next, "is", "unread");
            if (attached) next = addSearchFilter(next, "has", "attachment");
            onQuery(next || "(is:read OR is:unread)");
            setEditingDates(false);
            setFilters(false);
            setFrom("");
            setTo("");
            setAfter("");
            setBefore("");
            setFilename("");
            setFolder("");
            setUnread(false);
            setAttached(false);
          }}
        >
          <label>
            From
            <input
              aria-label="Search from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            To
            <input
              aria-label="Search to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            From date
            <input
              aria-label="Search after"
              type="date"
              value={after}
              onChange={(event) => setAfter(event.target.value)}
            />
          </label>
          <label>
            Before date
            <input
              aria-label="Search before"
              type="date"
              value={before}
              onChange={(event) => setBefore(event.target.value)}
            />
          </label>
          <label>
            Attachment name
            <input
              aria-label="Search filename"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="invoice.pdf"
            />
          </label>
          <label>
            Folder
            <input
              aria-label="Search folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Any folder"
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={unread}
              onChange={(event) => setUnread(event.target.checked)}
            />
            Unread only
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={attached}
              onChange={(event) => setAttached(event.target.checked)}
            />
            Has attachments
          </label>
          <button className="primary-button" type="submit">
            Apply filters
          </button>
        </form>
      )}
      {status && (
        <p className="search-coverage" role="status">
          {status.paused
            ? "Indexing paused"
            : !status.folders
              ? "Preparing mailbox index"
              : status.coverageGaps && !status.pending
                ? `Coverage incomplete · ${status.messages.toLocaleString()} messages searchable · Outlook reports additional folder items`
                : status.pending
                  ? `Indexing older mail · ${status.messages.toLocaleString()} messages searchable · ${status.pending} folders pending`
                  : `${status.messages.toLocaleString()} messages searchable across ${status.folders} folders`}
          {status.missingFiles
            ? ` · ${status.missingFiles} attachment-name lists pending`
            : ""}
          {status.error ? ` · Sync paused: ${status.error}` : ""}
        </p>
      )}
    </div>
  );
}
