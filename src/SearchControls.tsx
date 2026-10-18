import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { ThemedSelect } from "./ThemedSelect";
import { addSearchFilter, interpretSearch } from "./search-query";
import type { IndexStatus } from "./outlook";
export function SearchControls({
  query,
  onQuery,
  sort,
  onSort,
  status,
}: {
  query: string;
  onQuery: (query: string) => void;
  sort: string;
  onSort: (sort: string) => void;
  status: IndexStatus | null;
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
              match prefixes; quotes match phrases. Common date phrases such as
              last month also work.
            </p>
            <p>
              Search stays on this computer. Attachment names are indexed; text
              inside attached files is not.
            </p>
          </div>
        </details>
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
      {interpreted.interpreted && (
        <p className="search-interpretation">
          Searching: <code>{interpreted.query}</code>
        </p>
      )}
      {filters && (
        <form
          className="advanced-search"
          onSubmit={(event) => {
            event.preventDefault();
            let next = interpreted.query;
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
            onQuery(next);
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
