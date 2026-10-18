import { useEffect, useState } from "react";
import { ChevronRight, Folder, Inbox, RefreshCw } from "lucide-react";
import { outlookApi, type OutlookFolder } from "./outlook";

export const defaultOutlookFolder: OutlookFolder = {
  id: "inbox",
  displayName: "Inbox",
  unreadItemCount: 0,
  childFolderCount: 0,
  isInbox: true,
};
const branches = new Map<
  string,
  { open: boolean; children: OutlookFolder[] | null }
>();

function FolderBranch({
  folder,
  selected,
  onSelect,
  depth = 0,
}: {
  folder: OutlookFolder;
  selected: string;
  onSelect: (folder: OutlookFolder) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(branches.get(folder.id)?.open || false);
  const [children, setChildren] = useState<OutlookFolder[] | null>(
    branches.get(folder.id)?.children || null,
  );
  useEffect(() => {
    branches.set(folder.id, { open, children });
  }, [folder.id, open, children]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const expand = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (children) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setChildren(await outlookApi.folders(folder.id));
      setOpen(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div
        className="outlook-folder-row"
        style={{ paddingLeft: Math.min(depth, 10) * 12 }}
      >
        {folder.childFolderCount > 0 ? (
          <button
            className={`folder-expander ${open ? "expanded" : ""}`}
            aria-label={`${open ? "Collapse" : "Expand"} ${folder.displayName}`}
            aria-expanded={open}
            disabled={busy}
            onClick={() => void expand()}
          >
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="folder-expander" />
        )}
        <button
          className={`nav-item ${selected === folder.id || (selected === "inbox" && folder.isInbox) ? "selected" : ""}`}
          onClick={() => onSelect(folder)}
        >
          {folder.isInbox ? <Inbox size={15} /> : <Folder size={15} />}
          <span className="folder-name">{folder.displayName}</span>
          {folder.unreadItemCount > 0 && (
            <span
              className="nav-count"
              aria-label={`${folder.unreadItemCount} unread`}
            >
              {folder.unreadItemCount}
            </span>
          )}
        </button>
      </div>
      {busy && (
        <p className="folder-hint" role="status">
          Loading folders…
        </p>
      )}
      {error && (
        <p className="folder-hint" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void expand()}>
            Retry
          </button>
        </p>
      )}
      {open &&
        children?.map((child) => (
          <FolderBranch
            key={child.id}
            folder={child}
            selected={selected}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </>
  );
}
export function OutlookFolders({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (folder: OutlookFolder) => void;
}) {
  const [folders, setFolders] = useState<OutlookFolder[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setFolders(await outlookApi.folders());
    } catch (error) {
      try {
        const cached = await outlookApi.cachedFolders();
        setFolders(cached);
        if (!cached.length) setError(String(error));
      } catch {
        setError(String(error));
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("outlook-changed", refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("outlook-changed", refresh);
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="outlook-folders">
      <div className="folder-heading">
        <span>Outlook folders</span>
        <button
          className="icon-button"
          aria-label="Refresh folders"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {!folders && (
        <button
          className="nav-item"
          onClick={() => onSelect(defaultOutlookFolder)}
        >
          <Inbox size={15} />
          Inbox
        </button>
      )}
      {folders?.map((folder) => (
        <FolderBranch
          key={folder.id}
          folder={folder}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {busy && (
        <p className="folder-hint" role="status">
          Loading folders…
        </p>
      )}
      {error && (
        <p className="folder-hint" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
