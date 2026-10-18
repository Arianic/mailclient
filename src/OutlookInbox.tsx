import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  RefreshCw,
  Reply,
  ReplyAll,
  Forward,
} from "lucide-react";
import {
  outlookApi,
  type OutlookAccount,
  type OutlookInbox as Inbox,
  type OutlookSummary,
  type OutlookMessage,
  type OutlookFolder,
  type SearchPage,
  type IndexStatus,
  type ActionResult,
} from "./outlook";
import { defaultOutlookFolder } from "./OutlookFolders";
import { MessageContent, htmlText } from "./MessageContent";
import { MailActions } from "./MailActions";
import { SearchControls } from "./SearchControls";
import { interpretSearch } from "./search-query";
export { htmlText };
type ThreadMessage = OutlookSummary & OutlookMessage;
type Snapshot = {
  view: "important" | "other";
  inbox: Inbox | null;
  selected: OutlookSummary | null;
  body: OutlookMessage | null;
  thread: ThreadMessage[];
  query: string;
  sort: string;
  scroll: number;
  snippets: Record<string, string>;
  total: number;
};
const places = new Map<string, Snapshot>();
export function clearOutlookPlaces() {
  places.clear();
}
window.addEventListener("outlook-cache-cleared", clearOutlookPlaces);
const sender = (m: OutlookSummary) =>
  m.from?.emailAddress.name || m.from?.emailAddress.address || "Unknown sender";
function date(value: string, full = false) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(
        undefined,
        full
          ? { dateStyle: "medium", timeStyle: "short" }
          : { month: "short", day: "numeric" },
      );
}
function Highlight({ text, query }: { text: string; query: string }) {
  const terms =
    query
      .match(/"[^"]+"|[^\s():]+/g)
      ?.map((term) => term.replaceAll('"', ""))
      .filter(
        (term) =>
          term.length > 2 &&
          ![
            "from",
            "subject",
            "body",
            "filename",
            "after",
            "before",
            "has",
            "attachment",
            "folder",
            "person",
            "AND",
            "NOT",
            "OR",
          ].includes(term),
      ) || [];
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!escaped) return <>{text}</>;
  return (
    <>
      {text
        .split(new RegExp(`(${escaped})`, "gi"))
        .map((part, index) =>
          terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
            <mark key={index}>{part}</mark>
          ) : (
            part
          ),
        )}
    </>
  );
}
export function OutlookInbox({
  account,
  dark,
  query,
  compose,
  folder = defaultOutlookFolder,
  canManage = false,
  onQueryChange = () => {},
  forceSearch = false,
}: {
  account: OutlookAccount;
  dark: boolean;
  query: string;
  compose: (id?: string, mode?: "reply" | "replyAll" | "forward") => void;
  folder?: OutlookFolder;
  canManage?: boolean;
  onQueryChange?: (query: string) => void;
  forceSearch?: boolean;
}) {
  const cacheKey = `${account.email}:${forceSearch || query.trim() ? "search" : folder.id}`;
  const cached = places.get(cacheKey);
  const restored = cached?.query === query ? cached : undefined;
  const [view, setView] = useState<"important" | "other">(
      restored?.view || "important",
    ),
    [inbox, setInbox] = useState<Inbox | null>(restored?.inbox || null),
    [selected, setSelected] = useState<OutlookSummary | null>(
      restored?.selected || null,
    ),
    [body, setBody] = useState<OutlookMessage | null>(restored?.body || null),
    [thread, setThread] = useState<ThreadMessage[]>(restored?.thread || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState<IndexStatus | null>(null),
    [snippets, setSnippets] = useState<Record<string, string>>(
      restored?.snippets || {},
    ),
    [total, setTotal] = useState(restored?.total || 0),
    [suggestions, setSuggestions] = useState<string[]>([]),
    [sort, setSort] = useState(restored?.sort || "relevance"),
    [checked, setChecked] = useState<Set<string>>(new Set()),
    [notice, setNotice] = useState(""),
    [undo, setUndo] = useState<string | null>(null),
    [lastSync, setLastSync] = useState<Date | null>(null),
    [threadComplete, setThreadComplete] = useState(true),
    [folderNames, setFolderNames] = useState<Record<string, string>>({}),
    [indexRevision, setIndexRevision] = useState(0);
  const list = useRef<HTMLDivElement>(null),
    scroll = useRef(restored?.scroll || 0),
    request = useRef(0),
    focused = useRef<string | null>(null),
    first = useRef(true),
    indexSignature = useRef(""),
    state = useRef({
      view,
      inbox,
      selected,
      body,
      thread,
      query,
      sort,
      snippets,
      total,
      busy,
    });
  state.current = {
    view,
    inbox,
    selected,
    body,
    thread,
    query,
    sort,
    snippets,
    total,
    busy,
  };
  const searching = forceSearch || !!query.trim();
  const canonical = interpretSearch(query).query;
  const load = async (older = false, refresh = false) => {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    try {
      let next = searching
        ? await outlookApi.search(
            canonical,
            older ? state.current.inbox?.messages.length || 0 : 0,
            sort,
          )
        : await outlookApi.inbox(
            folder.isInbox ? view : "all",
            older,
            folder.id,
            older ? state.current.inbox?.messages.length || 0 : 0,
          );
      if (refresh && !older) {
        const target = state.current.inbox?.messages.length || 0;
        while (next.hasMore && next.messages.length < target) {
          const offset = next.messages.length;
          const page = searching
            ? await outlookApi.search(canonical, offset, sort)
            : await outlookApi.inbox(
                folder.isInbox ? view : "all",
                true,
                folder.id,
                offset,
              );
          if (!page.messages.length) break;
          const messages = Array.from(
            new Map(
              [...next.messages, ...page.messages].map((m) => [m.id, m]),
            ).values(),
          );
          if (messages.length === next.messages.length) break;
          next = {
            ...next,
            ...page,
            messages,
            ...(searching
              ? {
                  snippets: {
                    ...(next as SearchPage).snippets,
                    ...(page as SearchPage).snippets,
                  },
                }
              : {}),
          };
        }
      }
      if (generation !== request.current) return;
      if (searching) {
        const result = next as SearchPage;
        setSnippets((current) =>
          older ? { ...current, ...result.snippets } : result.snippets,
        );
        setTotal(result.total);
        setStatus(result.status);
        setSuggestions(result.suggestions);
      }
      setInbox((current) =>
        older && current
          ? {
              ...next,
              messages: Array.from(
                new Map(
                  [...current.messages, ...next.messages].map((m) => [m.id, m]),
                ).values(),
              ),
            }
          : next,
      );
      setLastSync(new Date());
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    const skip =
      first.current && !!restored && (!!restored.inbox || !!restored.body);
    first.current = false;
    if (skip) return;
    setSelected(null);
    setBody(null);
    setThread([]);
    setChecked(new Set());
    setInbox(null);
    setSnippets({});
    setTotal(0);
    setSuggestions([]);
    setError("");
    if (searching) {
      setBusy(true);
      const timer = setTimeout(() => void load(), 300);
      return () => {
        clearTimeout(timer);
        request.current++;
      };
    }
    void load();
    return () => {
      request.current++;
    };
  }, [view, query, sort, forceSearch]);
  useEffect(
    () => () => {
      request.current++;
      places.set(cacheKey, { ...state.current, scroll: scroll.current });
      if (places.size > 40) places.delete(places.keys().next().value!);
    },
    [cacheKey],
  );
  useEffect(() => {
    if (!selected && list.current) {
      list.current.scrollTop = scroll.current;
      if (focused.current) {
        Array.from(
          list.current.querySelectorAll<HTMLButtonElement>(".row-main"),
        )
          .find((button) => button.dataset.messageId === focused.current)
          ?.focus({ preventScroll: true });
      }
    }
  }, [selected]);
  useEffect(() => {
    let live = true;
    const update = async () => {
      try {
        const next = await outlookApi.indexStatus();
        if (live) {
          setStatus(next);
          const signature = `${next.messages}:${next.lastSync}:${next.missingFiles}`;
          if (indexSignature.current && signature !== indexSignature.current)
            setIndexRevision((value) => value + 1);
          indexSignature.current = signature;
        }
      } catch {
        /* Keep the last good status when offline. */
      }
    };
    void update();
    void outlookApi
      .cachedFolders()
      .then((folders) => {
        if (live)
          setFolderNames(
            Object.fromEntries(
              folders.map((folder) => [folder.id, folder.displayName]),
            ),
          );
      })
      .catch(() => {});
    const poll = setInterval(() => void update(), 5000);
    return () => {
      live = false;
      clearInterval(poll);
    };
  }, [account.email]);
  useEffect(() => {
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        !state.current.selected &&
        !state.current.busy
      )
        void load(false, true);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [query, view, sort]);
  useEffect(() => {
    if (searching && !selected && !busy && inbox) void load(false, true);
  }, [indexRevision]);
  const back = () => {
    request.current++;
    focused.current = selected?.id || null;
    setSelected(null);
    setBody(null);
    setThread([]);
    setBusy(false);
    setError("");
    if (searching) void load(false, true);
  };
  const open = async (message: OutlookSummary) => {
    if (!selected) scroll.current = list.current?.scrollTop || 0;
    const generation = ++request.current;
    setSelected(message);
    setBody(null);
    setThread([]);
    setBusy(true);
    setError("");
    try {
      const next = await outlookApi.message(message.id);
      if (generation !== request.current) return;
      setBody(next);
      void outlookApi
        .conversation(message.id)
        .then((result) => {
          if (generation === request.current) {
            setThread(result.messages.filter((m) => m.id !== message.id));
            setThreadComplete(result.complete);
          }
        })
        .catch(() => {});
      if (!message.isRead && canManage && !next.offline) {
        try {
          await outlookApi.markRead(message.id);
          setInbox((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((row) =>
                    row.id === message.id ? { ...row, isRead: true } : row,
                  ),
                }
              : current,
          );
          if (generation === request.current)
            setSelected({ ...message, isRead: true });
          window.dispatchEvent(new Event("outlook-changed"));
        } catch (error) {
          if (generation === request.current) setNotice(String(error));
        }
      }
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  const result = (result: ActionResult, action: string) => {
    const done = new Set(result.ids);
    setUndo(result.undo);
    setNotice(
      `${done.size} message${done.size === 1 ? "" : "s"} ${action === "read" ? "marked read" : action === "unread" ? "marked unread" : "moved"}${result.failures.length ? ` · ${result.failures.length} failed: ${result.failures[0].error}` : ""}`,
    );
    setChecked(new Set(result.failures.map((failure) => failure.id)));
    if (action === "read" || action === "unread") {
      setInbox((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((m) =>
                done.has(m.id) ? { ...m, isRead: action === "read" } : m,
              ),
            }
          : current,
      );
    } else {
      setInbox((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter((m) => !done.has(m.id)),
            }
          : current,
      );
      if (selected && done.has(selected.id)) back();
    }
  };
  const visible = inbox?.messages || [];
  const position = selected
    ? visible.findIndex((m) => m.id === selected.id)
    : -1;
  const nextMessage = (direction: number) => {
    const message = visible[position + direction];
    if (message) void open(message);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.closest('input,textarea,[contenteditable="true"]')) return;
      if (event.key === "Escape" && selected) {
        event.preventDefault();
        back();
      }
      if (selected && event.key === "ArrowRight") {
        event.preventDefault();
        nextMessage(1);
      }
      if (selected && event.key === "ArrowLeft") {
        event.preventDefault();
        nextMessage(-1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, visible]);
  const allMessages =
    selected && body
      ? [...thread, { ...selected, ...body }].sort((a, b) =>
          a.receivedDateTime.localeCompare(b.receivedDateTime),
        )
      : [];
  return (
    <div
      className={`outlook-reader ${selected ? "is-reading" : ""}`}
      aria-label="Personal Outlook inbox"
    >
      {notice && (
        <div className="mail-notice" role="status">
          <span>{notice}</span>
          {undo && (
            <button
              className="text-button"
              onClick={() => {
                const key = undo;
                setUndo(null);
                void outlookApi
                  .undo(key)
                  .then((result) => {
                    setNotice(
                      result.failures.length
                        ? result.failures[0].error
                        : "Action undone",
                    );
                    back();
                    void load();
                    window.dispatchEvent(new Event("outlook-changed"));
                  })
                  .catch((error) => setNotice(String(error)));
              }}
            >
              Undo
            </button>
          )}
          <button
            className="text-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {selected ? (
        <>
          <div className="outlook-reader-toolbar">
            <button className="soft-button" onClick={back}>
              <ArrowLeft size={15} />
              {searching ? "Results" : folder.displayName}
            </button>
            <button
              className="soft-button"
              onClick={() => compose(selected.id, "reply")}
            >
              <Reply size={15} />
              Reply
            </button>
            <details className="mail-more">
              <summary>Reply options</summary>
              <div className="mail-menu">
                <button onClick={() => compose(selected.id, "replyAll")}>
                  <ReplyAll size={15} />
                  Reply all
                </button>
                <button onClick={() => compose(selected.id, "forward")}>
                  <Forward size={15} />
                  Forward
                </button>
              </div>
            </details>
            <MailActions
              ids={[selected.id]}
              canManage={canManage}
              onResult={result}
              onError={setError}
            />
            <span className="grow" />
            <button
              className="icon-button"
              aria-label="Previous message"
              disabled={position <= 0}
              onClick={() => nextMessage(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Next message"
              disabled={position < 0 || position >= visible.length - 1}
              onClick={() => nextMessage(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <section className="outlook-reading-surface">
            <h1>{selected.subject || "(No subject)"}</h1>
            {busy && !body && <p role="status">Opening message…</p>}
            {error && (
              <div className="outlook-error" role="alert">
                {error}
                <button
                  className="text-button"
                  onClick={() => void open(selected)}
                >
                  Try again
                </button>
              </div>
            )}
            {body?.offline && (
              <p className="settings-note">
                Showing a saved copy · live changes need a connection
              </p>
            )}
            {(!threadComplete || !!status?.pending) && (
              <p className="settings-note">
                Older replies may still be indexing.
              </p>
            )}
            <div
              className={`conversation-stack ${allMessages.length <= 1 ? "single" : ""}`}
            >
              {allMessages.map((message) => (
                <article className="conversation-message" key={message.id}>
                  <header className="outlook-message-header">
                    <div>
                      <strong>{sender(message)}</strong>
                      <details className="recipient-details">
                        <summary>
                          {message.from?.emailAddress.address ||
                            "Message details"}
                        </summary>
                        <p>
                          To:{" "}
                          {message.toRecipients
                            ?.map(
                              (recipient) => recipient?.emailAddress.address,
                            )
                            .join(", ") || account.email}
                        </p>
                        {!!message.ccRecipients?.length && (
                          <p>
                            Cc:{" "}
                            {message.ccRecipients
                              .map(
                                (recipient) => recipient?.emailAddress.address,
                              )
                              .join(", ")}
                          </p>
                        )}
                      </details>
                    </div>
                    <time dateTime={message.receivedDateTime}>
                      {date(message.receivedDateTime, true)}
                    </time>
                  </header>
                  <MessageContent
                    message={message}
                    dark={dark}
                    hasAttachments={message.hasAttachments}
                  />
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{searching ? "Search all mail" : folder.displayName}</h1>
              <p>
                {account.email}
                {lastSync && !searching
                  ? ` · Updated ${lastSync.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </p>
            </div>
            {searching && (
              <span className="account-label">
                Sender · recipients · subject · body · filenames
              </span>
            )}
          </div>
          <section className="mail-panel">
            {searching ? (
              <SearchControls
                query={query}
                onQuery={onQueryChange}
                sort={sort}
                onSort={setSort}
                status={status}
              />
            ) : (
              <div className="list-toolbar">
                {folder.isInbox && (
                  <div className="segmented" aria-label="Relevance view">
                    {(["important", "other"] as const).map((tab) => (
                      <button
                        key={tab}
                        className={view === tab ? "selected" : ""}
                        aria-pressed={view === tab}
                        onClick={() => setView(tab)}
                      >
                        {tab === "important" ? "Important" : "Other"}
                      </button>
                    ))}
                  </div>
                )}
                <span className="grow" />
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw size={13} />
                  {busy ? "Loading…" : "Refresh"}
                </button>
              </div>
            )}
            <div className="bulk-toolbar">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select loaded messages"
                  checked={
                    visible.length > 0 &&
                    visible
                      .slice(0, 100)
                      .every((message) => checked.has(message.id))
                  }
                  onChange={(event) =>
                    setChecked(
                      event.target.checked
                        ? new Set(visible.slice(0, 100).map((m) => m.id))
                        : new Set(),
                    )
                  }
                />
                <span>
                  {checked.size ? `${checked.size} selected` : "Select"}
                </span>
              </label>
              <MailActions
                ids={[...checked]}
                canManage={canManage}
                onResult={result}
                onError={setError}
              />
              {checked.size === 100 && (
                <span className="subtle">100 per action</span>
              )}
            </div>
            {error && (
              <div className="outlook-error" role="alert">
                {error}
              </div>
            )}
            <div
              className="message-list"
              ref={list}
              onScroll={() => {
                scroll.current = list.current?.scrollTop || 0;
              }}
              aria-busy={busy}
            >
              {!inbox && busy && (
                <div className="empty-state" role="status">
                  {searching ? "Searching your mailbox…" : "Loading mail…"}
                </div>
              )}
              {inbox && visible.length === 0 && (
                <div className="empty-state">
                  {searching
                    ? status?.paused
                      ? "No matches in the saved mail. Resume indexing in Settings to search more history."
                      : status?.pending || !status?.folders
                        ? "No matches yet. Older mail is still indexing."
                        : "No messages match this search."
                    : `No ${folder.isInbox ? (view === "important" ? "Important " : "Other ") : ""}messages in this loaded range.`}
                  {inbox.hasMore && (
                    <span>Load older messages to look further back.</span>
                  )}
                  {!!suggestions.length && (
                    <div>
                      Did you mean{" "}
                      {suggestions.map((word) => (
                        <button
                          className="text-button"
                          key={word}
                          onClick={() => onQueryChange(word)}
                        >
                          {word}
                        </button>
                      ))}
                      ?
                    </div>
                  )}
                  {searching && (
                    <button
                      className="text-button"
                      onClick={() => onQueryChange("")}
                    >
                      Clear search
                    </button>
                  )}
                </div>
              )}
              {visible.map((message) => (
                <div
                  key={message.id}
                  className={`mail-row ${message.isRead ? "" : "unread"} ${searching ? "search-row" : ""}`}
                >
                  <input
                    className="row-check"
                    type="checkbox"
                    aria-label={`Select ${message.subject || "message"}`}
                    checked={checked.has(message.id)}
                    disabled={!checked.has(message.id) && checked.size >= 100}
                    onChange={(event) =>
                      setChecked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(message.id);
                        else next.delete(message.id);
                        return next;
                      })
                    }
                  />
                  <button
                    className="row-main"
                    data-message-id={message.id}
                    onClick={() => void open(message)}
                  >
                    <span
                      className={`unread-dot ${message.isRead ? "" : "visible"}`}
                      aria-label={message.isRead ? "Read" : "Unread"}
                    />
                    <span className="sender">
                      {sender(message).toLowerCase() ===
                        account.email.toLowerCase() ||
                      message.from?.emailAddress.address?.toLowerCase() ===
                        account.email.toLowerCase()
                        ? `To: ${message.toRecipients?.map((r) => r.emailAddress.name || r.emailAddress.address).join(", ") || "Recipients"}`
                        : sender(message)}
                    </span>
                    <span className="subject">
                      <Highlight
                        text={message.subject || "(No subject)"}
                        query={searching ? canonical : ""}
                      />
                      {searching && snippets[message.id] && (
                        <span className="search-snippet">
                          <Highlight
                            text={snippets[message.id]}
                            query={canonical}
                          />
                        </span>
                      )}
                    </span>
                    {searching && message.parentFolderId && (
                      <span
                        className="search-folder"
                        title={folderNames[message.parentFolderId]}
                      >
                        {folderNames[message.parentFolderId] || "Mail"}
                      </span>
                    )}
                    {message.hasAttachments && (
                      <Paperclip size={12} aria-label="Has attachments" />
                    )}
                    <span
                      className="account-dot outlook-dot"
                      aria-label="Outlook account"
                    />
                    <time dateTime={message.receivedDateTime}>
                      {date(message.receivedDateTime)}
                    </time>
                  </button>
                </div>
              ))}
            </div>
            <div className="list-footer">
              <span>
                {inbox
                  ? searching
                    ? `${visible.length} of ${total.toLocaleString()} matches${status?.pending ? " · indexing continues" : ""}`
                    : `${visible.length} messages loaded in ${folder.isInbox ? (view === "important" ? "Important" : "Other") : folder.displayName}`
                  : ""}
              </span>
              {inbox?.hasMore && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void load(true)}
                >
                  {searching ? "Load more results" : "Load older messages"}
                </button>
              )}
            </div>
          </section>
          {inbox?.offline && (
            <p className="inbox-note">
              Showing saved mail · Outlook is currently unavailable
            </p>
          )}
          {!searching && status?.error && (
            <p className="inbox-note">Sync paused · {status.error}</p>
          )}
        </>
      )}
    </div>
  );
}
