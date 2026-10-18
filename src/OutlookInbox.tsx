import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Image,
  Paperclip,
  RefreshCw,
  Reply,
} from "lucide-react";
import { SafeMessage } from "./SafeMessage";
import { sanitizeMailHtml } from "./mail-renderer";
import { defaultOutlookFolder } from "./OutlookFolders";
import {
  outlookApi,
  type OutlookAccount,
  type OutlookInbox as Inbox,
  type OutlookMessage,
  type OutlookSummary,
  type OutlookAttachment,
  type OutlookImages,
  type OutlookFolder,
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
  compose,
  folder = defaultOutlookFolder,
  canManage = false,
}: {
  account: OutlookAccount;
  dark: boolean;
  query: string;
  compose: (replyId?: string) => void;
  folder?: OutlookFolder;
  canManage?: boolean;
}) {
  const [view, setView] = useState<"important" | "other">("important");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selected, setSelected] = useState<OutlookSummary | null>(null);
  const [body, setBody] = useState<OutlookMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readStatus, setReadStatus] = useState("");
  const [files, setFiles] = useState<OutlookAttachment[] | null>(null);
  const [images, setImages] = useState<OutlookImages | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const request = useRef(0);
  const selectedId = useRef<string | null>(null);
  selectedId.current = selected?.id || null;
  const load = async (older = false) => {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    try {
      const next = await outlookApi.inbox(
        folder.isInbox ? view : "all",
        older,
        folder.id,
      );
      if (generation === request.current)
        setInbox((current) =>
          older && current
            ? {
                ...next,
                messages: Array.from(
                  new Map(
                    [...current.messages, ...next.messages].map((message) => [
                      message.id,
                      message,
                    ]),
                  ).values(),
                ),
              }
            : next,
        );
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    setInbox(null);
    savedScroll.current = 0;
    void load();
    return () => {
      request.current++;
    };
  }, [view]);
  useEffect(() => {
    if (!selected && list.current) list.current.scrollTop = savedScroll.current;
  }, [selected]);
  const back = () => {
    request.current++;
    setSelected(null);
    setBody(null);
    setBusy(false);
    setError("");
    setFiles(null);
    setImages(null);
    setMediaStatus("");
    setMediaBusy(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected]);
  const open = async (message: OutlookSummary) => {
    if (!selected) savedScroll.current = list.current?.scrollTop || 0;
    const generation = ++request.current;
    setSelected(message);
    setBody(null);
    setBusy(true);
    setError("");
    setImages(null);
    setFiles(null);
    setMediaStatus("");
    setMediaBusy(false);
    setReadStatus("");
    try {
      const next = await outlookApi.message(message.id);
      if (generation === request.current) {
        setBody(next);
        if (!message.isRead) {
          if (canManage) {
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
              if (generation === request.current) {
                setSelected({ ...message, isRead: true });
                setReadStatus("Marked as read");
              }
            } catch (error) {
              if (generation === request.current) setReadStatus(String(error));
            }
          } else
            setReadStatus(
              "Enable read-status sync in Settings → Personal Outlook to mark messages as read.",
            );
        }
      }
    } catch (error) {
      if (generation === request.current) setError(String(error));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  const media = async (action: () => Promise<string>) => {
    const id = selectedId.current;
    setMediaBusy(true);
    setMediaStatus("");
    try {
      const status = await action();
      if (selectedId.current === id) setMediaStatus(status);
    } catch (error) {
      if (selectedId.current === id) setMediaStatus(String(error));
    } finally {
      if (selectedId.current === id) setMediaBusy(false);
    }
  };
  const approved = Object.fromEntries(
    images?.images.map((image) => [image.source, image.dataUrl]) || [],
  );
  const visible =
    inbox?.messages.filter((message) =>
      `${sender(message)} ${message.subject || ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ) || [];
  return (
    <div
      className={`outlook-reader ${selected ? "is-reading" : ""}`}
      aria-label="Personal Outlook inbox"
    >
      {selected ? (
        <>
          <div className="outlook-reader-toolbar">
            <button className="soft-button" onClick={back}>
              <ArrowLeft size={15} />
              {folder.displayName}
            </button>
            <button
              className="soft-button"
              onClick={() => compose(selected.id)}
            >
              <Reply size={15} />
              Reply
            </button>
            <span className="subtle" role="status">
              {readStatus}
            </span>
          </div>
          <section className="outlook-reading-surface">
            <h1>{selected.subject || "(No subject)"}</h1>
            {body && (
              <div className="message-recipients">
                {!!body.toRecipients?.length && (
                  <p>
                    <span>To</span>{" "}
                    {body.toRecipients
                      .map((recipient) => recipient?.emailAddress.address)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {!!body.ccRecipients?.length && (
                  <p>
                    <span>Cc</span>{" "}
                    {body.ccRecipients
                      .map((recipient) => recipient?.emailAddress.address)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
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
              <>
                <div className="message-media-controls">
                  <button
                    className="text-button"
                    disabled={mediaBusy || !!images}
                    onClick={() =>
                      void media(async () => {
                        const next = await outlookApi.images(selected.id);
                        if (selectedId.current === selected.id) setImages(next);
                        return `${next.images.length} image${next.images.length === 1 ? "" : "s"} loaded${next.blocked ? ` · ${next.blocked} unavailable or blocked` : ""}`;
                      })
                    }
                  >
                    <Image size={14} />
                    {mediaBusy
                      ? "Loading…"
                      : images
                        ? "Images loaded"
                        : "Load images"}
                  </button>
                  <span className="subtle">
                    Remote images can reveal that you opened this email.
                  </span>
                  <button
                    className="text-button"
                    disabled={mediaBusy}
                    onClick={() =>
                      files
                        ? setFiles(null)
                        : void media(async () => {
                            const next = await outlookApi.attachments(
                              selected.id,
                            );
                            const attachments = next.filter(
                              (file) => !file.isInline,
                            );
                            if (selectedId.current === selected.id)
                              setFiles(attachments);
                            return attachments.length
                              ? "Choose a file to download."
                              : "No file attachments.";
                          })
                    }
                  >
                    <Paperclip size={14} />
                    {files ? "Hide attachments" : "Attachments"}
                  </button>
                </div>
                {mediaStatus && (
                  <p className="media-status" role="status">
                    {mediaStatus}
                  </p>
                )}
                {files && files.length > 0 && (
                  <div className="attachment-downloads">
                    {files.map((file) => (
                      <button
                        key={file.id}
                        className="soft-button"
                        disabled={mediaBusy}
                        onClick={() =>
                          void media(async () =>
                            (await outlookApi.downloadAttachment(
                              selected.id,
                              file.id,
                            ))
                              ? "File saved."
                              : "Download canceled.",
                          )
                        }
                      >
                        <Download size={13} />
                        {file.name}
                        <span className="subtle">
                          {Math.max(1, Math.round(file.size / 1024))} KB
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
                  images={approved}
                />
              </>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{folder.displayName}</h1>
              <p>{account.email}</p>
            </div>
            <span className="account-label">
              <span className="account-dot outlook-dot" />
              {account.email}
            </span>
          </div>
          <section className="mail-panel">
            <div className="list-toolbar">
              {folder.isInbox && (
                <div className="segmented" aria-label="Relevance view">
                  {(["important", "other"] as const).map((tab) => (
                    <button
                      key={tab}
                      className={view === tab ? "selected" : ""}
                      aria-pressed={view === tab}
                      disabled={busy}
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
                    ? "No matches in the loaded messages."
                    : `No ${folder.isInbox ? (view === "important" ? "Important " : "Other ") : ""}messages in this loaded range.`}
                  {inbox.hasMore && (
                    <span>Load older messages to look further back.</span>
                  )}
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
                    {folder.isInbox && !message.inferenceClassification && (
                      <span className="needs-review">Needs review</span>
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
                  ? `${inbox.messages.length} messages loaded in ${folder.isInbox ? (view === "important" ? "Important" : "Other") : folder.displayName}`
                  : ""}
              </span>
              {inbox?.hasMore && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void load(true)}
                >
                  Load older messages
                </button>
              )}
            </div>
          </section>
          <p className="inbox-note">
            {folder.isInbox
              ? "Important follows Outlook’s Focused Inbox. "
              : ""}
            Search covers loaded sender and subject lines.
          </p>
        </>
      )}
    </div>
  );
}
export function htmlText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeMailHtml(html);
  template.content
    .querySelectorAll("p,div,br,li,h1,h2,h3,blockquote")
    .forEach((element) => element.append("\n"));
  return template.content.textContent || "";
}
