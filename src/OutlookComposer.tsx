import { useEffect, useRef, useState, type ReactNode } from "react";
import { Send, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { outlookApi, type OutlookDraft } from "./outlook";
import { dragNativeWindow } from "./desktop";

export function OutlookComposer({ controls }: { controls: ReactNode }) {
  const id = new URLSearchParams(location.search).get("outlookCompose") || "";
  const [draft, setDraft] = useState<OutlookDraft | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [status, setStatus] = useState("Opening draft…");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "countdown" | "sending">("idle");
  const [seconds, setSeconds] = useState(5);
  const [review, setReview] = useState(false);
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
    void Promise.all([outlookApi.loadDraft(id), outlookApi.status()])
      .then(([draft, status]) => {
        if (active) {
          setDraft(draft);
          latest.current = draft;
          setCanSend(status.canSend);
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
    return () => clearTimeout(timeout);
  }, [draft]);
  const dismiss = async () => {
    if (currentPhase.current === "sending") {
      setStatus("Wait for Outlook’s send result before closing");
      return;
    }
    stopTimer();
    currentPhase.current = "idle";
    setPhase("idle");
    try {
      await save();
      await getCurrentWindow().destroy();
    } catch {
      setStatus("Not saved — keep this window open");
    }
  };
  useEffect(() => {
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
  const update = (
    key: "to" | "cc" | "bcc" | "subject" | "body",
    value: string,
  ) => {
    version.current++;
    setReview(false);
    setError("");
    setStatus("Saving…");
    setDraft((draft) => (draft ? { ...draft, [key]: value } : draft));
  };
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
  const locked = !draft || phase !== "idle" || draft.state !== "draft";
  return (
    <div className="compose-page">
      <form
        className="composer window real-composer"
        aria-label="Compose Outlook message"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft) return;
          if (
            !draft.subject.trim() ||
            /\b(attach|attached|attachment|enclosed)\b/i.test(draft.body)
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
            <button
              type="button"
              className="text-button"
              onClick={() => void save().catch(() => {})}
            >
              Retry saving
            </button>
          </div>
        )}
        {draft && (
          <>
            <div className="compose-fields">
              <label>
                <span>From</span>
                <strong className="real-from">{draft.account}</strong>
              </label>
              {(["to", "cc", "bcc"] as const).map((field) => (
                <label key={field}>
                  <span>
                    {field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc"}
                  </span>
                  <input
                    aria-label={
                      field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc"
                    }
                    required={field === "to"}
                    value={draft[field]}
                    disabled={locked}
                    placeholder={
                      field === "to"
                        ? "Email addresses, separated by commas"
                        : ""
                    }
                    onChange={(event) => update(field, event.target.value)}
                  />
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
            <textarea
              className="compose-body"
              aria-label="Message body"
              value={draft.body}
              disabled={locked}
              placeholder="Write your message…"
              onChange={(event) => update("body", event.target.value)}
            />
            {review && (
              <div className="outlook-error" role="alert">
                <p>
                  {!draft.subject.trim() ? "This message has no subject. " : ""}
                  {/\b(attach|attached|attachment|enclosed)\b/i.test(draft.body)
                    ? "Your message mentions an attachment. Sending attachments is not available yet. "
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
              {phase === "countdown" ? (
                <button type="button" className="primary-button" onClick={undo}>
                  Undo Send · {seconds}s
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={locked || !canSend}
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
              Plain text · local draft · no attachments or scheduled sending yet
            </p>
          </>
        )}
      </form>
    </div>
  );
}
