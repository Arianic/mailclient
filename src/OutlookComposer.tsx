import { useEffect, useRef, useState, type ReactNode } from "react";
import { Send, X, Paperclip, Trash2, Check, BookOpen } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  outlookApi,
  type OutlookDraft,
  type WritingItem,
  type WritingLibrary,
} from "./outlook";
import { RichTextEditor, type RichEditorHandle } from "./RichTextEditor";
import { WritingLibraryDialog } from "./WritingLibrary";
import { ThemedSelect } from "./ThemedSelect";
import { cleanWritingHtml, plainWritingHtml } from "./writing";
import { dragNativeWindow, nativeDesktop } from "./desktop";
import { listen } from "@tauri-apps/api/event";
import { RecipientField, validEmail } from "./RecipientField";
import type { DraftAttachment } from "./outlook";
export function OutlookComposer({ controls }: { controls: ReactNode }) {
  const libraryOpenRef = useRef(false);
  const richEditor = useRef<RichEditorHandle>(null);
  const plainEditor = useRef<HTMLTextAreaElement>(null);
  const [library, setLibrary] = useState<WritingLibrary>({
    revision: 0,
    entries: [],
    defaultSignature: null,
  });
  const [libraryOpen, setLibraryOpen] = useState(false);
  libraryOpenRef.current = libraryOpen;
  const [pendingTemplate, setPendingTemplate] = useState<WritingItem | null>(
    null,
  );
  const [plainConfirm, setPlainConfirm] = useState(false);
  const id = new URLSearchParams(location.search).get("outlookCompose") || "";
  const [draft, setDraft] = useState<OutlookDraft | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [status, setStatus] = useState("Opening draft…");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "countdown" | "sending">("idle");
  const [seconds, setSeconds] = useState(5);
  const [review, setReview] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const filesBusyRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const ccInput = useRef<HTMLInputElement>(null);
  const bccInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showCc) ccInput.current?.focus();
  }, [showCc]);
  useEffect(() => {
    if (showBcc) bccInput.current?.focus();
  }, [showBcc]);
  const latest = useRef(draft);
  latest.current = draft;
  const currentPhase = useRef(phase);
  currentPhase.current = phase;
  const version = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const save = () => {
    if (closing.current) return pending.current;
    const snapshot = latest.current;
    if (!snapshot || snapshot.state !== "draft") return pending.current;
    const revision = version.current;
    const write = pending.current
      .catch(() => {})
      .then(() => outlookApi.saveDraft(snapshot));
    pending.current = write;
    void write
      .then(() => {
        if (revision === version.current && currentPhase.current === "idle")
          setStatus("Saved on this device");
      })
      .catch((error) => {
        setError(String(error));
        setStatus("Not saved — keep this window open");
      });
    return write;
  };
  useEffect(() => {
    let active = true;
    void Promise.all([
      outlookApi.loadDraft(id),
      outlookApi.status(),
      outlookApi.writingLibrary(id).catch(() => null),
    ])
      .then(([loadedDraft, status, writing]) => {
        if (active) {
          const draft = { ...loadedDraft };
          if (writing) setLibrary(writing);
          if (draft.state === "draft" && !draft.writingInitialized && writing) {
            if (!draft.body.trim() && !draft.signature)
              draft.signature =
                writing.entries.find(
                  (e) =>
                    e.id === writing.defaultSignature && e.kind === "signature",
                ) || null;
            draft.writingInitialized = true;
          }
          setDraft(draft);
          latest.current = draft;
          setCanSend(status.canSend);
          setCanManage(!!status.canManage);
          setStatus(
            draft.state === "accepted"
              ? "Submitted to Outlook"
              : draft.state === "uncertain" || draft.state === "sending"
                ? "Check Outlook Sent Items before sending another copy"
                : "Draft restored",
          );
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!draft || draft.state !== "draft") return;
    const timeout = setTimeout(() => void save().catch(() => {}), 450);
    autoSaveTimer.current = timeout;
    return () => clearTimeout(timeout);
  }, [draft]);
  const dismiss = async () => {
    if (libraryOpenRef.current) {
      window.dispatchEvent(new Event("outlook-close-writing-library"));
      return;
    }
    if (filesBusyRef.current) {
      setStatus("Finish choosing attachments before closing");
      return;
    }
    if (currentPhase.current === "sending") {
      setStatus("Wait for Outlook’s send result before closing");
      return;
    }
    stopTimer();
    currentPhase.current = "idle";
    setPhase("idle");
    try {
      await save();
      if (nativeDesktop) await getCurrentWindow().destroy();
    } catch {
      setStatus("Not saved — keep this window open");
    }
  };
  useEffect(() => {
    if (!nativeDesktop) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void dismiss();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      });
    return () => {
      disposed = true;
      stop?.();
      stopTimer();
    };
  }, []);
  const patchDraft = (patch: Partial<OutlookDraft>) => {
    const previous = latest.current;
    if (
      !previous ||
      currentPhase.current !== "idle" ||
      previous.state !== "draft"
    )
      return;
    version.current++;
    setReview(false);
    setError("");
    setStatus("Saving…");
    const next = { ...previous, ...patch };
    latest.current = next;
    setDraft(next);
  };
  const useItem = (item: WritingItem) => {
    setLibraryOpen(false);
    if (item.kind === "signature") {
      patchDraft({ signature: { ...item }, writingInitialized: true });
      return;
    }
    if (item.kind === "template") {
      if (latest.current?.body.trim()) {
        setPendingTemplate(item);
        return;
      }
      patchDraft({
        body: item.body,
        bodyHtml:
          latest.current?.bodyHtml != null
            ? (item.bodyHtml ?? plainWritingHtml(item.body))
            : null,
        subject: item.subject || "",
      });
      return;
    }
    if (latest.current?.bodyHtml != null)
      richEditor.current?.insertHtml(
        item.bodyHtml ?? plainWritingHtml(item.body),
      );
    else if (latest.current) {
      const body = latest.current.body;
      const start = plainEditor.current?.selectionStart ?? body.length;
      const end = plainEditor.current?.selectionEnd ?? start;
      patchDraft({ body: body.slice(0, start) + item.body + body.slice(end) });
      requestAnimationFrame(() => {
        plainEditor.current?.focus();
        plainEditor.current?.setSelectionRange(
          start + item.body.length,
          start + item.body.length,
        );
      });
    }
  };
  const update = (
    key: "to" | "cc" | "bcc" | "subject" | "body",
    value: string,
  ) => patchDraft({ [key]: value });
  const send = async () => {
    if (currentPhase.current !== "countdown") return;
    stopTimer();
    currentPhase.current = "sending";
    setPhase("sending");
    setError("");
    setStatus("Submitting to Outlook…");
    try {
      await save();
      const result = await outlookApi.sendDraft(id);
      setDraft((draft) => (draft ? { ...draft, state: "accepted" } : draft));
      setStatus(result);
    } catch (error) {
      setError(String(error));
      try {
        const saved = await outlookApi.loadDraft(id);
        setDraft(saved);
        latest.current = saved;
      } catch {
        /* Preserve the open draft and send uncertainty. */
      }
      setStatus("Not submitted successfully — review the result above");
    } finally {
      currentPhase.current = "idle";
      setPhase("idle");
    }
  };
  const start = () => {
    if (filesBusyRef.current) return;
    if (currentPhase.current !== "idle" || !draft || draft.state !== "draft")
      return;
    setReview(false);
    setError("");
    setSeconds(5);
    currentPhase.current = "countdown";
    setPhase("countdown");
    setStatus("Sending in 5 seconds…");
    let remaining = 5;
    timer.current = setInterval(() => {
      remaining--;
      setSeconds(remaining);
      if (remaining <= 0) void send();
    }, 1000);
  };
  const undo = () => {
    stopTimer();
    currentPhase.current = "idle";
    setPhase("idle");
    setStatus("Send canceled. Your draft is saved.");
  };
  const changeFiles = async (attachmentId?: string) => {
    if (
      filesBusyRef.current ||
      currentPhase.current !== "idle" ||
      latest.current?.state !== "draft"
    )
      return;
    filesBusyRef.current = true;
    setFilesBusy(true);
    setError("");
    try {
      await save();
      const attachments = attachmentId
        ? await outlookApi.removeDraftFile(id, attachmentId)
        : await outlookApi.addDraftFiles(id);
      setDraft((draft) => (draft ? { ...draft, attachments } : draft));
      setStatus("Attachments saved on this device");
    } catch (error) {
      setError(String(error));
    } finally {
      filesBusyRef.current = false;
      setFilesBusy(false);
    }
  };
  useEffect(() => {
    if (!nativeDesktop) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<{
      attachments?: DraftAttachment[];
      error?: string;
      busy?: boolean;
    }>("outlook-draft-files", (event) => {
      if (event.payload.busy !== undefined) {
        filesBusyRef.current = event.payload.busy;
        setFilesBusy(event.payload.busy);
      }
      if (event.payload.error) setError(event.payload.error);
      if (event.payload.attachments) {
        setDraft((draft) =>
          draft ? { ...draft, attachments: event.payload.attachments } : draft,
        );
        setStatus("Attachments saved on this device");
      }
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const discard = async () => {
    if (
      currentPhase.current !== "idle" ||
      filesBusyRef.current ||
      latest.current?.state !== "draft"
    )
      return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    closing.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    try {
      await pending.current.catch(() => {});
      await outlookApi.discardDraft(id);
      setDraft(null);
      setStatus("Draft discarded");
      if (nativeDesktop) await getCurrentWindow().destroy();
    } catch (error) {
      closing.current = false;
      setError(String(error));
    }
  };
  useEffect(() => {
    if (!nativeDesktop) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<{ sent: number; total: number }>(
      "outlook-upload-progress",
      (event) => {
        if (currentPhase.current === "sending")
          setStatus(
            event.payload.sent === event.payload.total
              ? "Attachments uploaded · submitting to Outlook…"
              : `Uploading attachments · ${Math.round((event.payload.sent / Math.max(1, event.payload.total)) * 100)}%`,
          );
      },
    )
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const locked =
    !draft || phase !== "idle" || draft.state !== "draft" || filesBusy;
  return (
    <div className="compose-page">
      <form
        className="composer window real-composer"
        aria-label="Compose Outlook message"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked || !canSend || pendingTemplate || plainConfirm) return;
          if (
            (draft.attachments || []).reduce(
              (sum, file) => sum + file.size,
              0,
            ) > 2_000_000 &&
            !canManage
          ) {
            setError(
              "Enable mail actions in Settings → Personal Outlook to upload files over 2 MB. Your draft is saved.",
            );
            return;
          }
          const addresses = [draft.to, draft.cc, draft.bcc].flatMap((value) =>
            value
              .split(/[,;]/)
              .map((v) => v.trim())
              .filter(Boolean),
          );
          if (
            !draft.to.trim() ||
            addresses.some((value) => !validEmail(value))
          ) {
            setError("Check the recipient addresses before sending.");
            return;
          }
          if (
            !draft.subject.trim() ||
            (!draft.attachments?.length &&
              /\b(attach|attached|attachment|enclosed)\b/i.test(draft.body))
          )
            setReview(true);
          else start();
        }}
      >
        <header className="window-bar" onMouseDown={dragNativeWindow}>
          {controls}
          <span className="window-title">
            {draft?.replyId ? "Reply" : "New message"}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Close compose"
            onClick={() => void dismiss()}
          >
            <X size={16} />
          </button>
        </header>
        {error && (
          <div className="outlook-error" role="alert">
            {error}
            {status.startsWith("Not saved") && (
              <button
                type="button"
                className="text-button"
                onClick={() => void save().catch(() => {})}
              >
                Retry saving
              </button>
            )}
          </div>
        )}
        {draft && (
          <>
            {draft.notice && (
              <p className="compose-permission" role="status">
                {draft.notice}
              </p>
            )}
            <div className="compose-fields">
              <label>
                <span>From</span>
                <strong className="real-from">{draft.account}</strong>
              </label>
              {(["to", "cc", "bcc"] as const)
                .filter(
                  (field) =>
                    field === "to" ||
                    (field === "cc" && (showCc || draft.cc)) ||
                    (field === "bcc" && (showBcc || draft.bcc)),
                )
                .map((field) => (
                  <label key={field}>
                    <span>
                      {field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc"}
                    </span>
                    <RecipientField
                      label={
                        field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc"
                      }
                      inputRef={
                        field === "cc"
                          ? ccInput
                          : field === "bcc"
                            ? bccInput
                            : undefined
                      }
                      value={draft[field]}
                      required={field === "to"}
                      disabled={locked}
                      onChange={(value) => update(field, value)}
                    />
                    {field === "to" && (
                      <div className="recipient-options">
                        {!showCc && !draft.cc && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={locked}
                            onClick={() => setShowCc(true)}
                          >
                            Cc
                          </button>
                        )}
                        {!showBcc && !draft.bcc && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={locked}
                            onClick={() => setShowBcc(true)}
                          >
                            Bcc
                          </button>
                        )}
                      </div>
                    )}
                  </label>
                ))}
              <label>
                <span>Subject</span>
                <input
                  aria-label="Subject"
                  value={draft.subject}
                  disabled={locked}
                  onChange={(event) => update("subject", event.target.value)}
                />
              </label>
            </div>
            <div className="compose-writing-tools">
              <ThemedSelect
                aria-label="Message format"
                disabled={locked}
                value={draft.bodyHtml != null ? "html" : "text"}
                onValueChange={(format) => {
                  if (format === "html")
                    patchDraft({ bodyHtml: plainWritingHtml(draft.body) });
                  else if (draft.body.trim()) setPlainConfirm(true);
                  else patchDraft({ bodyHtml: null });
                }}
              >
                <option value="html">Rich text</option>
                <option value="text">Plain text</option>
              </ThemedSelect>
              <ThemedSelect
                aria-label="Message signature"
                disabled={locked}
                value={draft.signature?.id || ""}
                onValueChange={(id) =>
                  patchDraft({
                    signature:
                      library.entries.find(
                        (e) => e.id === id && e.kind === "signature",
                      ) || null,
                    writingInitialized: true,
                  })
                }
              >
                <option value="">No signature</option>
                {draft.signature &&
                  !library.entries.some(
                    (e) => e.id === draft.signature?.id,
                  ) && (
                    <option value={draft.signature.id}>
                      {draft.signature.name} · saved copy
                    </option>
                  )}
                {library.entries
                  .filter((e) => e.kind === "signature")
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </ThemedSelect>
              <span className="grow" />
              <button
                type="button"
                className="soft-button"
                disabled={locked}
                onClick={async () => {
                  try {
                    setLibrary(await outlookApi.writingLibrary(id));
                    setLibraryOpen(true);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <BookOpen size={14} />
                Writing library
              </button>
            </div>
            {plainConfirm && (
              <div className="outlook-error" role="alert">
                Switching to plain text removes message formatting.
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    patchDraft({ bodyHtml: null });
                    setPlainConfirm(false);
                  }}
                >
                  Switch to plain text
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPlainConfirm(false)}
                >
                  Keep rich text
                </button>
              </div>
            )}
            {pendingTemplate && (
              <div className="outlook-error" role="alert">
                Replace your message text and subject with “
                {pendingTemplate.name}”? Recipients and attachments stay in
                place.
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() => {
                    patchDraft({
                      body: pendingTemplate.body,
                      bodyHtml:
                        draft.bodyHtml != null
                          ? (pendingTemplate.bodyHtml ??
                            plainWritingHtml(pendingTemplate.body))
                          : null,
                      subject: pendingTemplate.subject || "",
                    });
                    setPendingTemplate(null);
                  }}
                >
                  Replace message
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPendingTemplate(null)}
                >
                  Keep current message
                </button>
              </div>
            )}
            <div className="compose-writing">
              {draft.bodyHtml != null ? (
                <RichTextEditor
                  ref={richEditor}
                  value={draft.bodyHtml}
                  disabled={locked}
                  onChange={(bodyHtml, body) => patchDraft({ bodyHtml, body })}
                />
              ) : (
                <textarea
                  ref={plainEditor}
                  className="compose-body"
                  autoFocus={!!draft.replyId}
                  aria-label="Message body"
                  value={draft.body}
                  disabled={locked}
                  placeholder="Write your message…"
                  onChange={(event) => update("body", event.target.value)}
                />
              )}
              {draft.signature && (
                <div className="message-signature">
                  <span className="signature-caption">
                    {draft.signature.name}
                    <button
                      type="button"
                      className="text-button"
                      disabled={locked}
                      onClick={() =>
                        patchDraft({
                          signature: null,
                          writingInitialized: true,
                        })
                      }
                    >
                      Remove
                    </button>
                  </span>
                  {draft.bodyHtml != null ? (
                    <div
                      onClick={(e) => {
                        if ((e.target as Element).closest("a"))
                          e.preventDefault();
                      }}
                      dangerouslySetInnerHTML={{
                        __html: cleanWritingHtml(
                          draft.signature.bodyHtml ??
                            plainWritingHtml(draft.signature.body),
                        ),
                      }}
                    />
                  ) : (
                    <div className="plain-signature">
                      {draft.signature.body}
                    </div>
                  )}
                </div>
              )}
              {draft.quote && (
                <details className="compose-quote">
                  <summary>Quoted message</summary>
                  <pre>{draft.quote}</pre>
                </details>
              )}
            </div>
            {!!draft.attachments?.length && (
              <div
                className="compose-files real-compose-files"
                aria-label="Attachments"
              >
                {draft.attachments.map((file) => (
                  <div className="attachment" key={file.id}>
                    <Paperclip size={13} />
                    <span>
                      {file.name}
                      <small>
                        {Math.max(1, Math.ceil(file.size / 1000))} KB
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${file.name}`}
                      disabled={locked}
                      onClick={() => void changeFiles(file.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {review && (
              <div className="outlook-error" role="alert">
                <p>
                  {!draft.subject.trim() ? "This message has no subject. " : ""}
                  {!draft.attachments?.length &&
                  /\b(attach|attached|attachment|enclosed)\b/i.test(draft.body)
                    ? "Your message mentions an attachment, but no files are attached. "
                    : ""}
                  Send anyway?
                </p>
                <button type="button" className="soft-button" onClick={start}>
                  Send anyway
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setReview(false)}
                >
                  Keep editing
                </button>
              </div>
            )}
            {!canSend && (
              <p className="compose-permission">
                Enable sending in Mail’s Settings → Personal Outlook, then
                reopen this draft. Your writing is saved here.
              </p>
            )}
            <footer className="compose-footer">
              <button
                type="button"
                className="soft-button"
                disabled={locked}
                onClick={() => void changeFiles()}
                title="Attach local files · up to 20 MB total"
              >
                <Paperclip size={15} />
                {filesBusy ? "Attaching…" : "Attach"}
              </button>
              {draft.state === "draft" && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Discard draft"
                  disabled={locked}
                  onClick={() => void discard()}
                >
                  <Trash2 size={15} />
                </button>
              )}
              {confirmDiscard && (
                <div className="discard-confirm">
                  <span>Discard this draft and its attachments?</span>
                  <button
                    className="text-button"
                    type="button"
                    disabled={locked}
                    onClick={() => void discard()}
                  >
                    Discard permanently
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    Keep draft
                  </button>
                </div>
              )}
              {draft.state === "accepted" ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void dismiss()}
                >
                  <Check size={15} />
                  Done
                </button>
              ) : phase === "countdown" ? (
                <button type="button" className="primary-button" onClick={undo}>
                  Undo Send · {seconds}s
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    locked || !canSend || !!pendingTemplate || plainConfirm
                  }
                >
                  <Send size={15} />
                  {phase === "sending" ? "Submitting…" : "Send"}
                </button>
              )}
              <span className="compose-status" role="status">
                {status}
              </span>
            </footer>
            <p className="compose-permission">
              {draft.bodyHtml != null ? "Rich text" : "Plain text"} · saved on
              this device · attachments up to 20 MB total
            </p>
          </>
        )}
      </form>
      {libraryOpen && draft && (
        <WritingLibraryDialog
          draftId={id}
          currentMessage={draft}
          library={library}
          onLibrary={setLibrary}
          onUse={useItem}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}
