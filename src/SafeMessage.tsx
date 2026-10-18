import { useMemo, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { mailDocument } from "./mail-renderer";

export function SafeMessage({
  html,
  text,
  dark,
  images = {},
  quiet = false,
}: {
  html?: string;
  text: string;
  dark: boolean;
  images?: Readonly<Record<string, string>>;
  quiet?: boolean;
}) {
  const [original, setOriginal] = useState(false);
  const [plain, setPlain] = useState(false);
  const doc = useMemo(
    () => (html ? mailDocument(html, dark, original, images) : ""),
    [html, dark, original, images],
  );
  if (!html) return <div className="message-text">{text}</div>;
  return (
    <div className="safe-message">
      <details
        className={`message-appearance ${quiet ? "quiet" : ""}`}
        open={!quiet}
      >
        {quiet && <summary>Appearance</summary>}
        <div className="message-view-controls">
          {!quiet && (
            <span>
              <ShieldCheck size={12} />
              Protected message view
            </span>
          )}
          <button onClick={() => setPlain(!plain)}>
            {plain ? "Formatted view" : "Plain text"}
          </button>
          {!plain && (
            <button
              aria-pressed={original}
              onClick={() => setOriginal(!original)}
            >
              {original ? "Adapt to theme" : "Original appearance"}
            </button>
          )}
        </div>
      </details>
      {plain ? (
        <div className="message-text">{text}</div>
      ) : (
        <iframe
          title="Formatted email content"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={doc}
          className="email-frame"
        />
      )}
      {!quiet && (
        <span className="message-safety-note">
          <FileText size={11} />
          {Object.keys(images).length
            ? "Images loaded for this message. Links remain inactive."
            : "External images and links are inactive."}
        </span>
      )}
    </div>
  );
}
