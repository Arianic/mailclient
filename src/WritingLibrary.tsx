import { useEffect, useRef, useState } from "react";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { outlookApi, type WritingItem, type WritingLibrary } from "./outlook";
import { ThemedSelect } from "./ThemedSelect";
import { RichTextEditor } from "./RichTextEditor";
import { plainWritingHtml } from "./writing";
export function WritingLibraryDialog({
  draftId,
  library,
  onLibrary,
  onUse,
  onClose,
  currentMessage,
}: {
  draftId: string;
  currentMessage?: { body: string; bodyHtml?: string | null; subject: string };
  library: WritingLibrary;
  onLibrary: (library: WritingLibrary) => void;
  onUse: (item: WritingItem) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<WritingItem["kind"]>("signature"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<WritingItem | null>(null),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(busy);
  saving.current = busy;
  const panel = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    unsaved = useRef(false);
  close.current = onClose;
  unsaved.current = dirty;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (saving.current) return;
        if (unsaved.current) setDiscard(true);
        else close.current();
      }
      if (event.key === "Tab") {
        const fields = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex="0"]',
          ) || [],
        );
        const index = fields.indexOf(document.activeElement as HTMLElement);
        if (!fields.length) return;
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          fields.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          (index === fields.length - 1 || index === -1)
        ) {
          event.preventDefault();
          fields[0]?.focus();
        }
      }
    };
    const requestClose = () => {
      if (saving.current) return;
      if (unsaved.current) setDiscard(true);
      else close.current();
    };
    window.addEventListener("outlook-close-writing-library", requestClose);
    document.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("outlook-close-writing-library", requestClose);
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, []);
  const persist = async (next: WritingLibrary) => {
    setBusy(true);
    setError("");
    try {
      const saved = await outlookApi.saveWritingLibrary(draftId, next);
      onLibrary(saved);
      return true;
    } catch (error) {
      setError(String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<WritingItem>) => {
    setEditing((entry) => (entry ? { ...entry, ...patch } : entry));
    setDirty(true);
  };
  const dismiss = () => {
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <div className="writing-backdrop">
      <div
        ref={panel}
        className="writing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="writing-library-title"
      >
        <header className="writing-dialog-heading">
          <h2 id="writing-library-title">Writing library</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close writing library"
            disabled={busy}
            onClick={dismiss}
          >
            <X size={17} />
          </button>
        </header>
        <p className="settings-note">
          Saved on this device for this account. Templates replace message text
          and subject; snippets insert at your cursor.
        </p>
        {error && (
          <div className="outlook-error" role="alert">
            {error}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={async () => {
                try {
                  onLibrary(await outlookApi.writingLibrary(draftId));
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Reload library
            </button>
          </div>
        )}
        {discard && (
          <div className="outlook-error" role="alert">
            Discard unsaved library changes?
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEditing(null);
                setDirty(false);
                setDiscard(false);
              }}
            >
              Discard changes
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setDiscard(false)}
            >
              Keep editing
            </button>
          </div>
        )}
        {editing ? (
          <div className="writing-entry-editor">
            <label>
              Name
              <input
                aria-label="Writing entry name"
                maxLength={160}
                disabled={busy}
                value={editing.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={
                  kind === "signature"
                    ? "Personal signature"
                    : kind === "template"
                      ? "Meeting follow-up"
                      : "Thank you"
                }
              />
            </label>
            {editing.kind === "template" && (
              <label>
                Subject
                <input
                  aria-label="Template subject"
                  maxLength={998}
                  value={editing.subject || ""}
                  disabled={busy}
                  onChange={(e) => update({ subject: e.target.value })}
                />
              </label>
            )}
            <RichTextEditor
              key={editing.id}
              label="Reusable text"
              compact
              disabled={busy}
              value={editing.bodyHtml ?? plainWritingHtml(editing.body)}
              onChange={(bodyHtml, body) => update({ bodyHtml, body })}
            />
            <div className="writing-entry-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || !editing.name.trim()}
                onClick={async () => {
                  if (
                    await persist({
                      ...library,
                      entries: [
                        ...library.entries.filter((e) => e.id !== editing.id),
                        editing,
                      ],
                    })
                  ) {
                    setEditing(null);
                    setDirty(false);
                  }
                }}
              >
                Save entry
              </button>
              <button
                type="button"
                className="soft-button"
                disabled={busy}
                onClick={() => {
                  if (dirty) setDiscard(true);
                  else setEditing(null);
                }}
              >
                Back to library
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="writing-library-toolbar">
              <div className="segmented" aria-label="Reusable text type">
                {(["signature", "template", "snippet"] as const).map(
                  (value) => (
                    <button
                      type="button"
                      key={value}
                      className={kind === value ? "selected" : ""}
                      aria-pressed={kind === value}
                      onClick={() => {
                        setKind(value);
                        setDeleting(null);
                      }}
                    >
                      {value === "signature"
                        ? "Signatures"
                        : value === "template"
                          ? "Templates"
                          : "Snippets"}
                    </button>
                  ),
                )}
              </div>
              <span className="grow" />
              <button
                type="button"
                className="soft-button"
                disabled={busy || library.entries.length >= 100}
                onClick={() => {
                  setEditing({
                    id: crypto.randomUUID(),
                    kind,
                    name: "",
                    body: "",
                    bodyHtml: "<p></p>",
                    subject: kind === "template" ? "" : null,
                  });
                  setDirty(false);
                }}
              >
                <Plus size={14} />
                New {kind}
              </button>
            </div>
            {kind === "template" && currentMessage?.body.trim() && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setEditing({
                    id: crypto.randomUUID(),
                    kind: "template",
                    name: currentMessage.subject || "New template",
                    body: currentMessage.body,
                    bodyHtml:
                      currentMessage.bodyHtml ??
                      plainWritingHtml(currentMessage.body),
                    subject: currentMessage.subject,
                  });
                  setDirty(true);
                }}
              >
                Create template from this message
              </button>
            )}
            <input
              className="writing-library-search"
              aria-label="Find reusable text"
              placeholder="Find by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="writing-entry-list">
              {library.entries
                .filter(
                  (e) =>
                    e.kind === kind &&
                    e.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((entry) => (
                  <article className="writing-entry" key={entry.id}>
                    <div>
                      <strong>{entry.name}</strong>
                      <p>
                        {entry.body.slice(0, 180) ||
                          entry.subject ||
                          "Empty text"}
                      </p>
                    </div>
                    <button
                      className="soft-button"
                      type="button"
                      disabled={busy}
                      onClick={() => onUse(entry)}
                    >
                      {kind === "signature"
                        ? "Use signature"
                        : kind === "template"
                          ? "Use template"
                          : "Insert snippet"}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${entry.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing({ ...entry });
                        setDirty(false);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${entry.name}`}
                      disabled={busy}
                      onClick={() => setDeleting(entry.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                    {deleting === entry.id && (
                      <div className="writing-delete-confirm">
                        <span>
                          Delete “{entry.name}” from this account’s library?
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await persist({
                                ...library,
                                defaultSignature:
                                  library.defaultSignature === entry.id
                                    ? null
                                    : library.defaultSignature,
                                entries: library.entries.filter(
                                  (e) => e.id !== entry.id,
                                ),
                              })
                            )
                              setDeleting(null);
                          }}
                        >
                          Delete entry
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setDeleting(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              {!library.entries.some(
                (e) =>
                  e.kind === kind &&
                  e.name.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className="settings-note">
                  {query
                    ? "No matching entries."
                    : `No ${kind}s yet. Create one to reuse your writing.`}
                </p>
              )}
            </div>
            {kind === "signature" && (
              <label className="default-signature">
                Default for new drafts
                <ThemedSelect
                  aria-label="Default signature"
                  disabled={busy}
                  value={library.defaultSignature || ""}
                  onValueChange={(value) =>
                    void persist({
                      ...library,
                      defaultSignature: value || null,
                    })
                  }
                >
                  <option value="">No default signature</option>
                  {library.entries
                    .filter((e) => e.kind === "signature")
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                </ThemedSelect>
              </label>
            )}
          </>
        )}
      </div>
    </div>
  );
}
