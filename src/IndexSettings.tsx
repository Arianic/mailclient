import { useEffect, useState } from "react";
import { outlookApi, type IndexStatus } from "./outlook";
export function IndexSettings() {
  const [status, setStatus] = useState<IndexStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () =>
      void outlookApi
        .indexStatus()
        .then((next) => {
          if (live) setStatus(next);
        })
        .catch((error) => {
          if (live) setError(String(error));
        });
    check();
    const timer = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const action = async (action: "pause" | "resume" | "clear" | "rebuild") => {
    setBusy(true);
    setError("");
    try {
      setStatus(await outlookApi.indexControl(action));
      setConfirm(false);
      if (action === "clear")
        window.dispatchEvent(new Event("outlook-cache-cleared"));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="index-settings">
      <h3>Mailbox search & offline copies</h3>
      <p className="settings-note">
        Message text and attachment names are indexed on this device. No AI
        service receives your mail. This local cache is not encrypted;
        credentials remain in GNOME Keyring.
      </p>
      {status && (
        <p className="settings-note">
          {status.messages.toLocaleString()} messages ·{" "}
          {status.paused
            ? "Indexing paused"
            : status.error
              ? "Indexing interrupted — retry available"
              : !status.folders
                ? "Preparing mailbox scan"
                : status.pending
                  ? `${status.pending} folders indexing`
                  : status.coverageGaps
                    ? "Coverage incomplete — Outlook reports more items in some folders"
                    : status.missingFiles
                      ? "Mail scan complete; indexing attachment names"
                      : "Mailbox scan complete"}
          {status.reportedItems != null
            ? ` · Outlook reports ${status.reportedItems.toLocaleString()} folder items`
            : ""}
          {status.missingFiles
            ? ` · ${status.missingFiles} filename lists pending`
            : ""}
        </p>
      )}
      <div className="outlook-actions">
        <button
          className="soft-button"
          disabled={busy}
          onClick={() => void action(status?.paused ? "resume" : "pause")}
        >
          {status?.paused ? "Resume indexing" : "Pause indexing"}
        </button>
        <button
          className="soft-button"
          disabled={busy}
          onClick={() => void action("rebuild")}
        >
          Rescan entire mailbox
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setConfirm(true)}
        >
          Clear cached mail
        </button>
      </div>
      {confirm && (
        <div className="outlook-error">
          <p>
            Remove this account’s local mail index and pause indexing? Your
            Outlook mailbox and local drafts remain available.
          </p>
          <button
            className="soft-button"
            disabled={busy}
            onClick={() => void action("clear")}
          >
            Clear local cache
          </button>
          <button className="text-button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {status?.error && (
        <p className="settings-note" role="alert">
          {status.error}
        </p>
      )}
      {!!status?.coverageGaps && (
        <p className="settings-note">
          Some folders contain fewer cached messages than Outlook’s item count.
          Rescan entire mailbox retries all pages and keeps saved mail
          available. Folder item counts can include non-email items.
        </p>
      )}
    </div>
  );
}
