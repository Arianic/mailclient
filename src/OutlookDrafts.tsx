import { useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { outlookApi, type OutlookDraft } from "./outlook";
export function OutlookDrafts() {
  const [drafts, setDrafts] = useState<OutlookDraft[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    setError("");
    try {
      setDrafts(await outlookApi.drafts());
    } catch (error) {
      setError(String(error));
    }
  };
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  return (
    <div className="outlook-reader">
      <div className="page-heading">
        <h1>Drafts</h1>
        <button className="text-button" onClick={() => void load()}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="outlook-error" role="alert">
          {error}
        </div>
      )}
      <section className="mail-panel">
        <div className="message-list">
          {drafts.length === 0 && (
            <div className="empty-state">
              <FileText size={24} />
              <p>No drafts on this device.</p>
            </div>
          )}
          {drafts.map((draft) => (
            <div className="mail-row" key={draft.id}>
              <button
                className="row-main"
                onClick={() =>
                  void outlookApi
                    .openCompose(draft.id)
                    .catch((error) => setError(String(error)))
                }
              >
                <span className="sender">{draft.to || "No recipient"}</span>
                <span className="subject">
                  {draft.subject || "New message"}
                </span>
                <span className="subtle">
                  {draft.state === "uncertain" || draft.state === "sending"
                    ? "Check send result"
                    : "Saved draft"}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="list-footer">Drafts are stored on this device</div>
      </section>
    </div>
  );
}
