import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Paperclip, RefreshCw } from "lucide-react";
import { SafeMessage } from "./SafeMessage";
import { sanitizeMailHtml } from "./mail-renderer";
import {
  outlookApi,
  type OutlookAccount,
  type OutlookInbox as Inbox,
  type OutlookMessage,
  type OutlookSummary,
} from "./outlook";

function date(value: string, full = false) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(
        undefined,
        full
          ? { dateStyle: "medium", timeStyle: "short" }
          : { month: "short", day: "numeric" },
      );
}
function sender(message: OutlookSummary) {
  return (
    message.from?.emailAddress.name ||
    message.from?.emailAddress.address ||
    "Unknown sender"
  );
}

export function OutlookInbox({
  account,
  dark,
  query,
  sampleInbox,
}: {
  account: OutlookAccount;
  dark: boolean;
  query: string;
  sampleInbox: () => void;
}) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selected, setSelected] = useState<OutlookSummary | null>(null);
  const [body, setBody] = useState<OutlookMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const request = useRef(0);
  const load = async () => {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    try {
      const next = await outlookApi.inbox();
      if (generation === request.current) setInbox(next);
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (!selected && list.current) list.current.scrollTop = savedScroll.current;
  }, [selected]);
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) {
        request.current++;
        setSelected(null);
        setBody(null);
        setError("");
        setBusy(false);
      }
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [selected]);
  const open = async (message: OutlookSummary) => {
    savedScroll.current = list.current?.scrollTop || 0;
    const generation = ++request.current;
    setSelected(message);
    setBody(null);
    setBusy(true);
    setError("");
    try {
      const next = await outlookApi.message(message.id);
      if (generation === request.current) setBody(next);
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  const back = () => {
    request.current++;
    setSelected(null);
    setBody(null);
    setBusy(false);
    setError("");
  };
  const visible =
    inbox?.messages.filter((message) =>
      `${sender(message)} ${message.subject || ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ) || [];
  return (
    <div className="outlook-reader" aria-label="Personal Outlook reader">
      {selected ? (
        <>
          <div className="outlook-reader-toolbar">
            <button className="soft-button" onClick={back}>
              <ArrowLeft size={15} />
              Inbox
            </button>
            <span className="subtle">
              Read-only · no changes made to your mailbox
            </span>
          </div>
          <section className="outlook-reading-surface">
            <h1>{selected.subject || "(No subject)"}</h1>
            <header className="outlook-message-header">
              <div>
                <strong>{sender(selected)}</strong>
                <span>{selected.from?.emailAddress.address}</span>
              </div>
              <time dateTime={selected.receivedDateTime}>
                {date(selected.receivedDateTime, true)}
              </time>
            </header>
            {busy && (
              <p role="status" className="settings-note">
                Opening message…
              </p>
            )}
            {error && (
              <div className="outlook-error" role="alert">
                <p>{error}</p>
                <button
                  className="soft-button"
                  disabled={busy}
                  onClick={() => void open(selected)}
                >
                  Try again
                </button>
              </div>
            )}
            {body && (
              <SafeMessage
                key={body.id}
                html={
                  body.body.contentType.toLowerCase() === "html"
                    ? body.body.content
                    : undefined
                }
                text={
                  body.body.contentType.toLowerCase() === "text"
                    ? body.body.content
                    : htmlText(body.body.content)
                }
                dark={dark}
              />
            )}
            {selected.hasAttachments && (
              <p className="settings-note">
                <Paperclip size={12} />
                This message has attachments. Attachment downloads are coming in
                a later step.
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>Outlook inbox</h1>
              <p>{account.email}</p>
            </div>
            <button className="text-button" onClick={sampleInbox}>
              Sample inbox
            </button>
          </div>
          <section className="mail-panel">
            <div className="list-toolbar">
              <span className="subtle">Recent inbox · read-only</span>
              <span className="grow" />
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw size={13} />
                {busy ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {error && (
              <div className="outlook-error" role="alert">
                <p>{error}</p>
              </div>
            )}
            <div className="message-list" ref={list} aria-busy={busy}>
              {!inbox && busy && (
                <div className="empty-state" role="status">
                  Loading your inbox…
                </div>
              )}
              {inbox && visible.length === 0 && (
                <div className="empty-state">
                  {query
                    ? "No matches in these recent messages."
                    : "Your inbox is empty."}
                </div>
              )}
              {visible.map((message) => (
                <div
                  key={message.id}
                  className={`mail-row ${message.isRead ? "" : "unread"}`}
                >
                  <button
                    className="row-main"
                    onClick={() => void open(message)}
                    disabled={busy}
                  >
                    <span
                      className={`unread-dot ${message.isRead ? "" : "visible"}`}
                      aria-label={message.isRead ? "Read" : "Unread"}
                    />
                    <span className="sender">{sender(message)}</span>
                    <span className="subject">
                      {message.subject || "(No subject)"}
                    </span>
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
                  ? `${inbox.messages.length} recent messages${inbox.hasMore ? " · more available in Outlook" : ""}`
                  : ""}
              </span>
              <span>Messages are cleared when you quit</span>
            </div>
          </section>
          <p className="settings-note">
            Opening a message leaves its read status unchanged. Search covers
            the sender and subject of the messages loaded here.
          </p>
        </>
      )}
    </div>
  );
}

// Parse in an inert document; never insert sender HTML into the app DOM.
export function htmlText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeMailHtml(html);
  template.content
    .querySelectorAll("p,div,br,li,h1,h2,h3,blockquote")
    .forEach((element) => element.append("\n"));
  return template.content.textContent || "";
}
