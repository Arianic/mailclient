import { useMemo, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { mailDocument } from "./mail-renderer";

export function SafeMessage({
  html,
  text,
  dark,
}: {
  html?: string;
  text: string;
  dark: boolean;
}) {
  const [original, setOriginal] = useState(false);
  const [plain, setPlain] = useState(false);
  const doc = useMemo(
    () => (html ? mailDocument(html, dark, original) : ""),
    [html, dark, original],
  );
  if (!html) return <div className="message-text">{text}</div>;
  return (
    <div className="safe-message">
      <div className="message-view-controls">
        <span>
          <ShieldCheck size={12} />
          Protected message view
        </span>
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
      <span className="message-safety-note">
        <FileText size={11} />
        External images and links are inactive.
      </span>
    </div>
  );
}
