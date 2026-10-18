import { useState, useRef, useEffect } from "react";
import {
  Archive,
  Trash2,
  MoreHorizontal,
  FolderInput,
  Mail,
  MailOpen,
} from "lucide-react";
import { outlookApi, type ActionResult, type OutlookFolder } from "./outlook";
import { ThemedSelect } from "./ThemedSelect";
export function MailActions({
  ids,
  canManage,
  onResult,
  onError,
}: {
  ids: string[];
  canManage: boolean;
  onResult: (result: ActionResult, action: string) => void;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [folders, setFolders] = useState<OutlookFolder[]>([]),
    [destination, setDestination] = useState("");
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (more.current?.open && !more.current.contains(event.target as Node))
        more.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const run = async (action: string) => {
    if (!ids.length || busy) return;
    setBusy(true);
    if (more.current) more.current.open = false;
    try {
      onResult(
        await outlookApi.action(
          ids,
          action,
          action === "move" ? destination : null,
        ),
        action,
      );
      window.dispatchEvent(new Event("outlook-changed"));
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const disabled = !ids.length || !canManage || busy;
  return (
    <div
      className="mail-actions"
      aria-label="Message actions"
      title={
        !canManage
          ? "Enable mail actions in Settings → Personal Outlook"
          : undefined
      }
    >
      <button
        className="icon-button"
        aria-label="Archive"
        disabled={disabled}
        onClick={() => void run("archive")}
      >
        <Archive size={16} />
      </button>
      <button
        className="icon-button"
        aria-label="Move to Deleted Items"
        disabled={disabled}
        onClick={() => void run("delete")}
      >
        <Trash2 size={16} />
      </button>
      <details
        ref={more}
        onKeyDown={(event) => {
          if (event.key === "Escape" && more.current) {
            more.current.open = false;
            more.current.querySelector("summary")?.focus();
          }
        }}
        className="mail-more"
        onToggle={(event) => {
          if (event.currentTarget.open)
            void outlookApi
              .cachedFolders()
              .then(setFolders)
              .catch(() => {});
        }}
      >
        <summary aria-label="More message actions">
          <MoreHorizontal size={17} />
        </summary>
        <div className="mail-menu">
          <button disabled={disabled} onClick={() => void run("read")}>
            <MailOpen size={14} />
            Mark as read
          </button>
          <button disabled={disabled} onClick={() => void run("unread")}>
            <Mail size={14} />
            Mark as unread
          </button>
          <button disabled={disabled} onClick={() => void run("junk")}>
            Move to Junk
          </button>
          <button disabled={disabled} onClick={() => void run("notJunk")}>
            Move out of Junk
          </button>
          <div className="menu-divider" />
          <ThemedSelect
            aria-label="Move destination"
            value={destination}
            onValueChange={setDestination}
          >
            <option value="">Choose folder…</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.displayName}
              </option>
            ))}
          </ThemedSelect>
          <button
            disabled={disabled || !destination}
            onClick={() => void run("move")}
          >
            <FolderInput size={14} />
            Move here
          </button>
        </div>
      </details>
      {busy && (
        <span className="subtle" role="status">
          Applying…
        </span>
      )}
    </div>
  );
}
