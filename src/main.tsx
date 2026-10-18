import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  Inbox,
  Mail as MailIcon,
  Menu,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  SquarePen,
  Star,
  Sun,
  Moon,
  Trash2,
  X,
  Bold,
  Italic,
  Link2,
  ShieldCheck,
  CircleHelp,
  Monitor,
  PanelLeftClose,
} from "lucide-react";
import {
  accounts,
  initialEvents,
  initialMail,
  type Account,
  type CalendarEvent,
  type Category,
  type Draft,
  type Mail,
} from "./data";
import "./styles.css";
import { SafeMessage } from "./SafeMessage";
import { ThemedSelect } from "./ThemedSelect";
import {
  dragNativeWindow,
  nativeDesktop,
  openNativeComposer,
  quitDesktop,
  windowAction,
} from "./desktop";
import { storage, StorageNotice, useStored } from "./storage";
import { getCurrentWindow } from "@tauri-apps/api/window";
type Theme = "system" | "light" | "dark";
function useTheme() {
  const [theme, setTheme] = useStored<Theme>("mail-theme", "system");
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(m.matches);
    m.addEventListener("change", changed);
    return () => m.removeEventListener("change", changed);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return { theme, setTheme, dark };
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function TrafficLights() {
  return (
    <div
      className="traffic"
      aria-label={
        nativeDesktop ? "Window controls" : "Desktop window controls preview"
      }
    >
      {nativeDesktop ? (
        <>
          <button
            className="red"
            aria-label="Close window"
            title="Close window"
            onClick={() => void windowAction("close")}
          >
            <X size={8} />
          </button>
          <button
            className="yellow"
            aria-label="Minimize window"
            title="Minimize window"
            onClick={() => void windowAction("minimize")}
          >
            <span>−</span>
          </button>
          <button
            className="green"
            aria-label="Maximize or restore window"
            title="Maximize or restore window"
            onClick={() => void windowAction("maximize")}
          >
            <Plus size={8} />
          </button>
        </>
      ) : (
        <>
          <span className="red" />
          <span className="yellow" />
          <span className="green" />
        </>
      )}
    </div>
  );
}
const isComposer = new URLSearchParams(location.search).has("compose");

function Composer({
  draftId,
  close,
}: {
  draftId?: string;
  close?: () => void;
}) {
  useTheme();
  const [drafts, setDrafts] = useStored<Draft[]>("mail-drafts", []);
  const [id] = useState(
    draftId ||
      new URLSearchParams(location.search).get("compose") ||
      crypto.randomUUID(),
  );
  useEffect(() => {
    if (!nativeDesktop)
      localStorage.setItem("mail-compose-ready:" + id, String(Date.now()));
  }, [id]);
  const existing = drafts.find((d) => d.id === id);
  const [draft, setDraft] = useState<Draft>(
    existing || {
      id,
      account: "gmail",
      to: "",
      subject: "",
      body: "",
      updated: Date.now(),
    },
  );
  const [status, setStatus] = useState(
    existing ? "Draft restored" : "New message",
  );
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [format, setFormat] = useState("");
  const attachRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const saveNow = () => {
    const current = latestDraft.current;
    if (
      !current.to &&
      !current.subject &&
      !current.body &&
      !current.files?.length
    )
      return;
    const saved = JSON.parse(storage.getItem("mail-drafts") || "[]") as Draft[];
    storage.setItem(
      "mail-drafts",
      JSON.stringify([
        ...saved.filter((d) => d.id !== id),
        { ...current, updated: Date.now() },
      ]),
    );
  };
  useEffect(() => {
    if (!draft.to && !draft.subject && !draft.body && !draft.files?.length)
      return;
    const timer = setTimeout(() => {
      saveNow();
      void storage
        .flush()
        .then(() => setStatus("Saved on this device"))
        .catch(() => setStatus("Not saved — keep this window open"));
    }, 450);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const onUnload = () => {
      if (!nativeDesktop) saveNow();
    };
    window.addEventListener("beforeunload", onUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (nativeDesktop)
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          event.preventDefault();
          saveNow();
          try {
            await storage.flush();
            await getCurrentWindow().destroy();
          } catch {
            setStatus("Not saved — keep this window open");
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        });
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
  const update = (key: keyof Draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function insert(before: string, after = "") {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    update(
      "body",
      draft.body.slice(0, start) +
        before +
        draft.body.slice(start, end) +
        after +
        draft.body.slice(end),
    );
    el.focus();
  }
  const dismiss = async () => {
    saveNow();
    try {
      await storage.flush();
      if (close) close();
      else if (nativeDesktop) await windowAction("close");
      else window.close();
    } catch {
      setStatus("Not saved — keep this window open");
    }
  };
  return (
    <div className={close ? "modal-backdrop" : "compose-page"}>
      <section
        className="composer window"
        role={close ? "dialog" : undefined}
        aria-modal={close ? true : undefined}
        aria-label="Compose message"
      >
        <header className="window-bar" onMouseDown={dragNativeWindow}>
          <TrafficLights />
          <span className="window-title">New message</span>
          <IconButton label="Close compose" onClick={dismiss}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="compose-fields">
          <label>
            <span>From</span>
            <ThemedSelect
              aria-label="From account"
              value={draft.account}
              onValueChange={(value) => update("account", value)}
            >
              {Object.entries(accounts).map(([key, a]) => (
                <option key={key} value={key}>
                  {a.label} · {a.email}
                </option>
              ))}
            </ThemedSelect>
          </label>
          <label>
            <span>To</span>
            <input
              type="email"
              value={draft.to}
              placeholder="Recipient"
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <label>
            <span>Subject</span>
            <input
              value={draft.subject}
              placeholder="A little note…"
              onChange={(e) => update("subject", e.target.value)}
            />
          </label>
        </div>
        <textarea
          className="compose-body"
          ref={bodyRef}
          aria-label="Message body"
          value={draft.body}
          onChange={(e) => update("body", e.target.value)}
          placeholder="Write something thoughtful…"
        />
        {!!draft.files?.length && (
          <div className="compose-files">
            {draft.files.map((file, i) => (
              <span className="attachment" key={`${file}-${i}`}>
                <Paperclip size={14} />
                {file}
                <button
                  aria-label={`Remove ${file}`}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      files: d.files?.filter((_, j) => j !== i),
                    }))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {schedule && (
          <div className="schedule-panel">
            <label>
              Scheduled time{" "}
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
            <p>
              Preview only. Delivery scheduling will be added with account
              connections.
            </p>
          </div>
        )}
        <div className="format-bar">
          <IconButton
            label="Insert bold markers"
            onClick={() => insert("**", "**")}
          >
            <Bold size={16} />
          </IconButton>
          <IconButton
            label="Insert italic markers"
            onClick={() => insert("_", "_")}
          >
            <Italic size={16} />
          </IconButton>
          <IconButton
            label="Insert link"
            onClick={() => insert("[link text](", ")")}
          >
            <Link2 size={16} />
          </IconButton>
          <span className="divider" />
          <ThemedSelect
            aria-label="Insert template"
            value={format}
            onValueChange={(value) => {
              setFormat(value);
              if (value)
                update("body", draft.body + (draft.body ? "\n\n" : "") + value);
            }}
          >
            <option value="">Templates</option>
            <option value="Thank you for getting in touch. I’ll take a look and get back to you shortly.">
              Quick acknowledgment
            </option>
            <option value="Just following up on my previous message. Let me know when you have a moment.">
              Gentle follow-up
            </option>
          </ThemedSelect>
          <span className="grow" />
          <span className="subtle">Plain text preview</span>
        </div>
        <footer className="compose-footer">
          <button
            className="primary-button"
            onClick={() =>
              setStatus(
                "Preview only — no email was sent. Your draft is saved.",
              )
            }
          >
            <Send size={15} />
            Send
          </button>
          <IconButton
            label="Schedule message"
            onClick={() => setSchedule(!schedule)}
            active={schedule}
          >
            <Clock3 size={17} />
          </IconButton>
          <IconButton
            label="Attach files"
            onClick={() => attachRef.current?.click()}
          >
            <Paperclip size={17} />
          </IconButton>
          <input
            hidden
            multiple
            type="file"
            ref={attachRef}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                files: [
                  ...(d.files || []),
                  ...Array.from(e.target.files || []).map((f) => f.name),
                ],
              }))
            }
          />
          <span className="grow" />
          <span className="compose-status" role="status">
            {status}
          </span>
        </footer>
        <div className="compose-disclaimer">
          Design preview · sample identities · no account connected
        </div>
      </section>
    </div>
  );
}

function App() {
  const { theme, setTheme, dark } = useTheme();
  const [density, setDensity] = useStored("mail-density", "compact");
  const [mails, setMails] = useStored<Mail[]>("mail-messages-v1", initialMail);
  const [drafts, setDrafts] = useStored<Draft[]>("mail-drafts", []);
  const [events, setEvents] = useStored<CalendarEvent[]>(
    "mail-events",
    initialEvents,
  );
  const [view, setView] = useState<"mail" | "calendar" | "settings">("mail");
  const [folder, setFolder] = useState("inbox");
  const [tab, setTab] = useState("important");
  const [sidebar, setSidebar] = useState(false);
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [filters, setFilters] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState("");
  const [undo, setUndo] = useState<{
    id: string;
    folder: Mail["folder"];
  } | null>(null);
  const [compose, setCompose] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  const [calendarView, setCalendarView] = useState("Month");
  const [eventEdit, setEventEdit] = useState<CalendarEvent | null>(null);
  const listRef = useRef<HTMLDivElement>(null),
    savedScroll = useRef(0),
    searchRef = useRef<HTMLInputElement>(null);
  const current = mails.find((m) => m.id === selected);
  const showToast = (text: string) => {
    setToast(text);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast("");
      setUndo(null);
    }, 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (selected === null && listRef.current)
      listRef.current.scrollTop = savedScroll.current;
  }, [selected]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setView("mail");
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSelected(null);
        setMore(false);
        setSidebar(false);
        setEventEdit(null);
        setCompose(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const patch = (id: string, data: Partial<Mail>) =>
    setMails((ms) => ms.map((m) => (m.id === id ? { ...m, ...data } : m)));
  const openMail = (mail: Mail) => {
    savedScroll.current = listRef.current?.scrollTop || 0;
    patch(mail.id, { unread: false });
    setSelected(mail.id);
    setMore(false);
  };
  const navigate = (next: string) => {
    setFolder(next);
    setView("mail");
    setSelected(null);
    setSidebar(false);
    setQuery("");
    setMore(false);
  };
  const move = (mail: Mail, destination: Mail["folder"]) => {
    setUndo({ id: mail.id, folder: mail.folder });
    patch(mail.id, { folder: destination });
    setSelected(null);
    setMore(false);
    showToast(
      destination === "archive"
        ? "Conversation archived"
        : "Conversation moved to Trash",
    );
  };
  function openCompose(reply?: Mail, draftId?: string) {
    const id = draftId || crypto.randomUUID();
    if (reply) {
      const last = reply.messages[reply.messages.length - 1];
      const next = {
        id,
        account: reply.account,
        to: last.address,
        subject: `Re: ${reply.subject.replace(/^Re: /, "")}`,
        body: "",
        updated: Date.now(),
      };
      storage.setItem("mail-drafts", JSON.stringify([...drafts, next]));
      setDrafts([...drafts, next]);
    }
    if (nativeDesktop) {
      void storage
        .flush()
        .then(() => openNativeComposer(id))
        .catch(() => {
          setCompose(id);
          showToast(
            "Could not open a separate window. Your draft is open here.",
          );
        });
      return;
    }
    const started = Date.now();
    const popup = window.open(
      `/?compose=${encodeURIComponent(id)}`,
      "compose-" + id,
      "popup,width=760,height=700",
    );
    if (!popup) setCompose(id);
    else
      setTimeout(() => {
        if (
          Number(localStorage.getItem("mail-compose-ready:" + id) || 0) <
          started
        )
          setCompose(id);
      }, 1800);
  }
  const filtered = mails.filter((m) => {
    const matchesFolder =
      folder === "starred"
        ? m.starred && m.folder !== "trash"
        : folder === "needs"
          ? m.category === "Needs reply" && m.folder !== "trash"
          : folder === "waiting"
            ? m.category === "Waiting" && m.folder !== "trash"
            : m.folder === folder;
    return (
      matchesFolder &&
      (folder !== "inbox" || query || m.important === (tab === "important")) &&
      (account === "all" || m.account === account) &&
      (!unreadOnly || m.unread) &&
      (!query ||
        `${m.sender} ${m.subject} ${m.messages.map((x) => x.text).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()))
    );
  });
  const unread = mails.filter((m) => m.folder === "inbox" && m.unread).length;
  const folderName: Record<string, string> = {
    inbox: "Inbox",
    drafts: "Drafts",
    archive: "Archive",
    trash: "Trash",
    starred: "Starred",
    needs: "Needs reply",
    waiting: "Waiting",
  };
  const setSection = (section: "mail" | "calendar") => {
    setView(section);
    setSelected(null);
    setMore(false);
  };
  const newEvent = (date?: string) =>
    setEventEdit({
      id: crypto.randomUUID(),
      title: "",
      date:
        date ||
        `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-17`,
      time: "10:00",
      end: "11:00",
      calendar: "Personal",
      notes: "",
    });

  return (
    <div className="desktop">
      <div className="desktop-glow" />
      <div className="preview-top">
        <span className="preview-brand">
          <MailIcon size={15} />
          Mail
        </span>
        <span>Made for a quieter inbox</span>
        <div className="preview-tools">
          <span className="demo-dot" />
          Interactive design preview
          <IconButton
            label={
              dark ? "Switch to light appearance" : "Switch to dark appearance"
            }
            onClick={() => setTheme(dark ? "light" : "dark")}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </div>
      </div>
      <section
        className={`window main-window density-${density}`}
        aria-label="Mail application"
      >
        <header className="window-bar" onMouseDown={dragNativeWindow}>
          <TrafficLights />
          <IconButton
            label="Toggle sidebar"
            onClick={() => setSidebar(!sidebar)}
            active={sidebar}
          >
            <Menu size={17} />
          </IconButton>
          <span className="window-title">
            {view === "calendar"
              ? "Calendar"
              : view === "settings"
                ? "Settings"
                : "Mail"}
          </span>
          <div className="app-switch" aria-label="Application view">
            <button
              className={view === "mail" ? "selected" : ""}
              onClick={() => setSection("mail")}
            >
              <MailIcon size={14} />
              Mail
            </button>
            <button
              className={view === "calendar" ? "selected" : ""}
              onClick={() => setSection("calendar")}
            >
              <CalendarDays size={14} />
              Calendar
            </button>
          </div>
          <div className="grow" />
          {view === "mail" && (
            <label className="search-field">
              <Search size={15} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                placeholder="Search mail"
                aria-label="Search mail"
              />
              <kbd>Ctrl K</kbd>
            </label>
          )}
          <IconButton
            label="Open settings"
            onClick={() => {
              setView(view === "settings" ? "mail" : "settings");
              setSelected(null);
            }}
            active={view === "settings"}
          >
            <Settings2 size={17} />
          </IconButton>
          <button
            className="compose-button"
            onClick={() => openCompose()}
            aria-label="Compose new message"
          >
            <SquarePen size={17} />
            <span>Compose</span>
          </button>
        </header>
        <div className="app-body">
          {sidebar && (
            <>
              <button
                className="sidebar-scrim"
                aria-label="Close sidebar"
                onClick={() => setSidebar(false)}
              />
              <aside className="sidebar">
                <div className="sidebar-heading">
                  Mailboxes
                  <IconButton
                    label="Hide sidebar"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={15} />
                  </IconButton>
                </div>
                {[
                  ["inbox", Inbox, "Inbox"],
                  ["drafts", FileText, "Drafts"],
                  ["starred", Star, "Starred"],
                  ["archive", Archive, "Archive"],
                  ["trash", Trash2, "Trash"],
                ].map(([id, Icon, label]) => {
                  const I = Icon as typeof Inbox;
                  return (
                    <button
                      key={id as string}
                      className={`nav-item ${folder === id && view === "mail" ? "selected" : ""}`}
                      onClick={() => navigate(id as string)}
                    >
                      <I size={17} />
                      {label as string}
                      {id === "inbox" && (
                        <span className="nav-count">{unread}</span>
                      )}
                      {id === "drafts" && drafts.length > 0 && (
                        <span className="nav-count">{drafts.length}</span>
                      )}
                    </button>
                  );
                })}
                <div className="sidebar-label">Follow up</div>
                <button className="nav-item" onClick={() => navigate("needs")}>
                  <ArrowUpRight size={17} />
                  Needs reply
                </button>
                <button
                  className="nav-item"
                  onClick={() => navigate("waiting")}
                >
                  <Clock3 size={17} />
                  Waiting
                </button>
                <div className="sidebar-label">Accounts</div>
                {Object.entries(accounts).map(([id, a]) => (
                  <button
                    key={id}
                    className="nav-item"
                    onClick={() => {
                      setAccount(id);
                      navigate("inbox");
                    }}
                  >
                    <span
                      className="account-dot"
                      style={{ background: a.color }}
                    />
                    {a.label}
                    {id === "work" && (
                      <ShieldCheck size={13} className="muted" />
                    )}
                  </button>
                ))}
                <div className="sidebar-bottom">
                  <ShieldCheck size={15} />
                  <span>Work mail stays out of cloud AI</span>
                </div>
              </aside>
            </>
          )}
          <main className="main-content">
            {view === "mail" && !selected && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR SPACE, A LITTLE CLEARER</div>
                    <h1>{query ? "Search results" : folderName[folder]}</h1>
                    <p>
                      {query
                        ? `Matches for “${query}”`
                        : folder === "inbox"
                          ? "A place for the conversations that matter."
                          : folder === "drafts"
                            ? "A few thoughts, ready when you are."
                            : folder === "needs"
                              ? "Conversations waiting for your next move."
                              : folder === "waiting"
                                ? "A little space for things in progress."
                                : "Everything right where you left it."}
                    </p>
                  </div>
                  <div className="heading-right">
                    <span className="date-label">Saturday, October 17</span>
                    <div className="account-picker">
                      <ThemedSelect
                        aria-label="Filter by account"
                        value={account}
                        onValueChange={setAccount}
                      >
                        <option value="all">All accounts</option>
                        {Object.entries(accounts).map(([id, a]) => (
                          <option key={id} value={id}>
                            {a.label}
                          </option>
                        ))}
                      </ThemedSelect>
                    </div>
                  </div>
                </div>
                <div className="mail-panel">
                  <div className="list-toolbar">
                    {folder === "inbox" && !query ? (
                      <div className="segmented" aria-label="Relevance view">
                        <button
                          className={tab === "important" ? "selected" : ""}
                          onClick={() => setTab("important")}
                        >
                          Important
                          <span>
                            {
                              mails.filter(
                                (m) =>
                                  m.folder === "inbox" &&
                                  m.important &&
                                  m.unread,
                              ).length
                            }
                          </span>
                        </button>
                        <button
                          className={tab === "other" ? "selected" : ""}
                          onClick={() => setTab("other")}
                        >
                          Other
                          <span>
                            {
                              mails.filter(
                                (m) =>
                                  m.folder === "inbox" &&
                                  !m.important &&
                                  m.unread,
                              ).length
                            }
                          </span>
                        </button>
                      </div>
                    ) : (
                      <span className="list-caption">
                        {folder === "drafts" ? drafts.length : filtered.length}{" "}
                        {folder === "drafts" ? "drafts" : "conversations"}
                      </span>
                    )}
                    <span className="grow" />
                    <button
                      className={`text-button ${unreadOnly ? "active" : ""}`}
                      onClick={() => setUnreadOnly(!unreadOnly)}
                    >
                      {unreadOnly ? <Check size={13} /> : null}Unread
                    </button>
                    <IconButton
                      label="Search filters"
                      onClick={() => setFilters(!filters)}
                      active={filters}
                    >
                      <SlidersHorizontal size={16} />
                    </IconButton>
                    <div className="menu-anchor">
                      <IconButton
                        label="More mailboxes"
                        onClick={() => setMore(!more)}
                        active={more}
                      >
                        <MoreHorizontal size={19} />
                      </IconButton>
                      {more && (
                        <div className="dropdown">
                          {[
                            ["drafts", "Drafts"],
                            ["starred", "Starred"],
                            ["archive", "Archive"],
                            ["trash", "Trash"],
                            ["needs", "Needs reply"],
                            ["waiting", "Waiting"],
                          ].map(([id, label]) => (
                            <button key={id} onClick={() => navigate(id)}>
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {filters && (
                    <div className="filter-bar">
                      <span>Search within</span>
                      <ThemedSelect
                        aria-label="Account search filter"
                        value={account}
                        onValueChange={setAccount}
                      >
                        <option value="all">All accounts</option>
                        {Object.entries(accounts).map(([id, a]) => (
                          <option value={id} key={id}>
                            {a.label}
                          </option>
                        ))}
                      </ThemedSelect>
                      <span className="subtle">
                        Sender, subject & message text
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          setAccount("all");
                          setUnreadOnly(false);
                          setQuery("");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                  <div className="message-list" ref={listRef}>
                    {folder === "drafts" ? (
                      drafts.length ? (
                        [...drafts]
                          .sort((a, b) => b.updated - a.updated)
                          .map((d) => (
                            <div className="mail-row" key={d.id}>
                              <button
                                className="row-main"
                                onClick={() => openCompose(undefined, d.id)}
                              >
                                <span className="sender">
                                  {d.to || "No recipient"}
                                </span>
                                <span className="subject">
                                  {d.subject || "Untitled message"}
                                </span>
                                <span className="draft-tag">Draft</span>
                              </button>
                              <IconButton
                                label={`Delete draft ${d.subject || "Untitled message"}`}
                                onClick={() =>
                                  setDrafts((ds) =>
                                    ds.filter((x) => x.id !== d.id),
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          ))
                      ) : (
                        <Empty
                          icon={<FileText size={27} />}
                          title="Nothing unfinished"
                          text="Your saved drafts will be waiting here."
                        />
                      )
                    ) : filtered.length ? (
                      filtered.map((mail, index) => (
                        <React.Fragment key={mail.id}>
                          {index === 0 && (
                            <div className="date-divider">
                              {query
                                ? "MATCHING CONVERSATIONS"
                                : tab === "other"
                                  ? "UPDATES & OTHER MAIL"
                                  : "RECENT CONVERSATIONS"}
                            </div>
                          )}
                          <div
                            className={`mail-row ${mail.unread ? "unread" : ""}`}
                          >
                            <button
                              className="row-main"
                              onClick={() => openMail(mail)}
                            >
                              <span
                                className={`unread-dot ${mail.unread ? "visible" : ""}`}
                                aria-label={mail.unread ? "Unread" : "Read"}
                              />
                              <span className="sender">{mail.sender}</span>
                              <span className="subject">{mail.subject}</span>
                              {mail.category && (
                                <span
                                  className={`category category-${mail.category.replace(" ", "-").toLowerCase()}`}
                                >
                                  {mail.category}
                                </span>
                              )}
                              {mail.review && (
                                <span className="review-label">
                                  Needs review
                                </span>
                              )}
                              {mail.attachment && (
                                <Paperclip
                                  size={13}
                                  className="attachment-icon"
                                />
                              )}
                              <span
                                className="account-dot"
                                style={{
                                  background: accounts[mail.account].color,
                                }}
                                title={`${accounts[mail.account].label} · ${accounts[mail.account].email}`}
                                aria-label={`${accounts[mail.account].label} account`}
                              />
                              <time>{mail.time}</time>
                            </button>
                            <button
                              className={`star-button ${mail.starred ? "starred" : ""}`}
                              aria-label={`${mail.starred ? "Unstar" : "Star"} ${mail.subject}`}
                              onClick={() =>
                                patch(mail.id, { starred: !mail.starred })
                              }
                            >
                              <Star
                                size={14}
                                fill={mail.starred ? "currentColor" : "none"}
                              />
                            </button>
                          </div>
                        </React.Fragment>
                      ))
                    ) : (
                      <Empty
                        icon={<Inbox size={27} />}
                        title={
                          query ? "No conversations found" : "All clear here"
                        }
                        text={
                          query
                            ? "Try another name or a shorter search."
                            : "You’re up to date. Enjoy a little breathing room."
                        }
                      />
                    )}
                  </div>
                  <div className="list-footer">
                    <span>
                      {folder === "drafts" ? drafts.length : filtered.length}{" "}
                      {folder === "drafts" ? "drafts" : "conversations"}
                    </span>
                    <span>
                      <span className="small-status-dot" />
                      Sample data · stored on this device
                    </span>
                  </div>
                </div>
                <div className="quiet-note">
                  <ShieldCheck size={13} />A quieter inbox. Your attention, on
                  your terms.
                </div>
              </>
            )}
            {view === "mail" && current && (
              <div className="conversation">
                <div className="reading-toolbar">
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(null);
                      setMore(false);
                    }}
                  >
                    <ArrowLeft size={16} />
                    Inbox
                  </button>
                  <span className="grow" />
                  <IconButton
                    label="Archive conversation"
                    onClick={() => move(current, "archive")}
                  >
                    <Archive size={17} />
                  </IconButton>
                  <button
                    className="soft-button"
                    onClick={() => openCompose(current)}
                  >
                    Reply
                    <ArrowUpRight size={14} />
                  </button>
                  <div className="menu-anchor">
                    <IconButton
                      label="More conversation actions"
                      onClick={() => setMore(!more)}
                    >
                      <MoreHorizontal size={19} />
                    </IconButton>
                    {more && (
                      <div className="dropdown">
                        <button
                          onClick={() => {
                            patch(current.id, { unread: true });
                            setSelected(null);
                            setMore(false);
                          }}
                        >
                          Mark unread
                        </button>
                        <button
                          onClick={() => {
                            patch(current.id, {
                              important: !current.important,
                              review: false,
                            });
                            setMore(false);
                            showToast(
                              `Moved to ${current.important ? "Other" : "Important"}`,
                            );
                          }}
                        >
                          Move to {current.important ? "Other" : "Important"}
                        </button>
                        <button onClick={() => move(current, "trash")}>
                          Move to Trash
                        </button>
                        <button
                          onClick={() => {
                            setMore(false);
                            showToast(
                              "Remote images are blocked in this preview.",
                            );
                          }}
                        >
                          Original appearance
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="reading-column">
                  <div className="conversation-heading">
                    <span className="account-caption">
                      <span
                        className="account-dot"
                        style={{ background: accounts[current.account].color }}
                      />
                      {accounts[current.account].label}
                      {current.account === "work" && (
                        <span className="privacy-badge">
                          <ShieldCheck size={12} />
                          Cloud AI excluded
                        </span>
                      )}
                    </span>
                    <h1>{current.subject}</h1>
                    <div className="conversation-meta">
                      <span>
                        {current.messages.length}{" "}
                        {current.messages.length === 1 ? "message" : "messages"}
                      </span>
                      <ThemedSelect
                        aria-label="Conversation action category"
                        value={current.category}
                        onValueChange={(value) =>
                          patch(current.id, {
                            category: value as Category,
                          })
                        }
                      >
                        <option value="">Add category</option>
                        <option>Needs reply</option>
                        <option>Waiting</option>
                        <option>Reference</option>
                      </ThemedSelect>
                      <IconButton
                        label={
                          current.starred
                            ? "Unstar conversation"
                            : "Star conversation"
                        }
                        onClick={() =>
                          patch(current.id, { starred: !current.starred })
                        }
                      >
                        <Star
                          size={15}
                          fill={current.starred ? "currentColor" : "none"}
                        />
                      </IconButton>
                    </div>
                  </div>
                  {current.messages.map((m, i) => (
                    <article className="expanded-message" key={i}>
                      <header>
                        <div>
                          <strong>{m.sender}</strong>
                          <span className="message-address">{m.address}</span>
                        </div>
                        <time>{m.date}</time>
                      </header>
                      <p className="message-to">
                        To{" "}
                        {m.sender === "You"
                          ? current.messages[current.messages.length - 1]
                              .address
                          : accounts[current.account].email}
                      </p>
                      <SafeMessage
                        html={
                          m.html ??
                          initialMail.find((item) => item.id === current.id)
                            ?.messages[i]?.html
                        }
                        text={m.text}
                        dark={dark}
                      />
                      {current.attachment &&
                        i === current.messages.length - 1 && (
                          <button
                            className="attachment"
                            onClick={() =>
                              showToast(
                                "Sample attachment — no file is downloaded.",
                              )
                            }
                          >
                            <FileText size={18} />
                            <span>
                              {current.attachment}
                              <small>Sample attachment</small>
                            </span>
                            <ArrowDown size={15} />
                          </button>
                        )}
                    </article>
                  ))}
                  <div className="reply-prompt">
                    <button
                      className="soft-button"
                      onClick={() => openCompose(current)}
                    >
                      <ArrowUpRight size={15} />
                      Reply to {current.sender.split(" ")[0]}
                    </button>
                    <span>Opens in a separate window</span>
                  </div>
                </div>
              </div>
            )}
            {view === "calendar" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">A LITTLE ROOM FOR WHAT’S NEXT</div>
                    <h1>
                      {month.toLocaleDateString("en", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h1>
                    <p>Plans, people, and time for yourself.</p>
                  </div>
                  <div className="calendar-heading-controls">
                    <button
                      className="soft-button"
                      onClick={() => setMonth(new Date(2026, 9, 1))}
                    >
                      Today
                    </button>
                    <div className="month-navigation">
                      <IconButton
                        label="Previous month"
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() - 1,
                              1,
                            ),
                          )
                        }
                      >
                        <ChevronLeft size={16} />
                      </IconButton>
                      <IconButton
                        label="Next month"
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() + 1,
                              1,
                            ),
                          )
                        }
                      >
                        <ChevronRight size={16} />
                      </IconButton>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => newEvent()}
                    >
                      <Plus size={15} />
                      Event
                    </button>
                  </div>
                </div>
                <div className="calendar-panel">
                  <div className="list-toolbar">
                    <div className="segmented">
                      {["Month", "Week", "Day"].map((v) => (
                        <button
                          key={v}
                          className={v === calendarView ? "selected" : ""}
                          onClick={() => setCalendarView(v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <span className="grow" />
                    <span className="calendar-key">
                      <span
                        className="account-dot"
                        style={{ background: accounts.gmail.color }}
                      />
                      Personal
                      <span
                        className="account-dot"
                        style={{ background: accounts.work.color }}
                      />
                      Work
                    </span>
                  </div>
                  {calendarView === "Month" ? (
                    <>
                      <div className="week-labels">
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                          (d) => (
                            <span key={d}>{d}</span>
                          ),
                        )}
                      </div>
                      <div className="month-grid">
                        {Array.from(
                          {
                            length:
                              Math.ceil(
                                (((new Date(
                                  month.getFullYear(),
                                  month.getMonth(),
                                  1,
                                ).getDay() +
                                  6) %
                                  7) +
                                  new Date(
                                    month.getFullYear(),
                                    month.getMonth() + 1,
                                    0,
                                  ).getDate()) /
                                  7,
                              ) * 7,
                          },
                          (_, i) => {
                            const offset =
                              (new Date(
                                month.getFullYear(),
                                month.getMonth(),
                                1,
                              ).getDay() +
                                6) %
                              7;
                            const date = new Date(
                              month.getFullYear(),
                              month.getMonth(),
                              i - offset + 1,
                            );
                            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                            const dayEvents = events.filter(
                              (e) => e.date === key,
                            );
                            return (
                              <div
                                className={`calendar-cell ${date.getMonth() !== month.getMonth() ? "outside" : ""}`}
                                key={key}
                              >
                                <button
                                  className={`day-number ${key === "2026-10-17" ? "today" : ""}`}
                                  aria-label={`Add event on ${key}`}
                                  onClick={() => newEvent(key)}
                                >
                                  {date.getDate()}
                                </button>
                                {dayEvents.map((e) => (
                                  <button
                                    className={`calendar-event ${e.calendar === "Work" ? "work-event" : ""}`}
                                    key={e.id}
                                    onClick={() => setEventEdit(e)}
                                  >
                                    <span>{e.time}</span>
                                    {e.title}
                                  </button>
                                ))}
                              </div>
                            );
                          },
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="agenda">
                      <div className="agenda-title">
                        {calendarView === "Day"
                          ? "Saturday, October 17"
                          : "October 12–18"}
                      </div>
                      {events
                        .filter((e) =>
                          calendarView === "Day"
                            ? e.date === "2026-10-17"
                            : e.date >= "2026-10-12" && e.date <= "2026-10-18",
                        )
                        .sort((a, b) => a.time.localeCompare(b.time))
                        .map((e) => (
                          <button
                            key={e.id}
                            className="agenda-event"
                            onClick={() => setEventEdit(e)}
                          >
                            <time>
                              {e.time}
                              <small>{e.end}</small>
                            </time>
                            <span>
                              <strong>{e.title}</strong>
                              <small>
                                {e.calendar} ·{" "}
                                {e.notes || "No additional notes"}
                              </small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      <span className="agenda-note">
                        Day and week preview anchored to October 17.
                      </span>
                    </div>
                  )}
                  <div className="list-footer">
                    <span>Calendar preview</span>
                    <span>
                      Changes stay on this device · Google Calendar not
                      connected
                    </span>
                  </div>
                </div>
              </>
            )}
            {view === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                    <h1>Just your kind of quiet.</h1>
                    <p>
                      A few considered choices. Everything else, out of the way.
                    </p>
                  </div>
                </div>
                <div className="settings-grid">
                  <section className="settings-card">
                    <h2>
                      <SlidersHorizontal size={18} />
                      Appearance
                    </h2>
                    <label className="setting-row">
                      <span>
                        Theme
                        <small>System follows your desktop preference</small>
                      </span>
                      <ThemedSelect
                        aria-label="Theme"
                        value={theme}
                        onValueChange={(value) => setTheme(value as Theme)}
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </ThemedSelect>
                    </label>
                    <label className="setting-row">
                      <span>
                        Inbox density<small>Keep the framing spacious</small>
                      </span>
                      <ThemedSelect
                        aria-label="Inbox density"
                        value={density}
                        onValueChange={setDensity}
                      >
                        <option value="compact">Compact</option>
                        <option value="comfortable">Comfortable</option>
                        <option value="spacious">Spacious</option>
                      </ThemedSelect>
                    </label>
                    <div className="setting-row">
                      <span>
                        Typography
                        <small>Uses the available system interface font</small>
                      </span>
                      <Monitor size={18} />
                    </div>
                  </section>
                  <section className="settings-card">
                    <h2>
                      <ShieldCheck size={18} />
                      Privacy by account
                    </h2>
                    {Object.entries(accounts).map(([id, a]) => (
                      <div className="setting-row" key={id}>
                        <span className="account-setting">
                          <span
                            className="account-dot"
                            style={{ background: a.color }}
                          />
                          <span>
                            {a.label}
                            <small>
                              {id === "work"
                                ? "Excluded from all cloud AI"
                                : "Automatic AI: sender & subject only"}
                            </small>
                          </span>
                        </span>
                        <span className="setting-status">
                          {id === "work" ? "Protected" : "Not active"}
                        </span>
                      </div>
                    ))}
                    <p className="settings-note">
                      AI is not connected. No sample messages are sent to an AI
                      service. Real account access and these privacy controls
                      will be implemented in the application backend.
                    </p>
                  </section>
                  <section className="settings-card">
                    <h2>
                      <MailIcon size={18} />
                      Connected services
                    </h2>
                    {[
                      "Gmail & Outlook",
                      "Work IMAP",
                      "Google Calendar",
                      "Nextcloud",
                      "ChatGPT",
                    ].map((s) => (
                      <div className="setting-row" key={s}>
                        <span>{s}</span>
                        <span className="setting-status">Not connected</span>
                      </div>
                    ))}
                  </section>
                  <section className="settings-card">
                    <h2>
                      <CircleHelp size={18} />
                      About this preview
                    </h2>
                    <p>
                      Explore the inbox, open conversations, save drafts in a
                      separate window, and create sample calendar events.
                    </p>
                    <p>
                      Changes are saved only on this device. Mail delivery,
                      synchronization, rich text editing, AI, and service
                      connections are future implementation stages.
                    </p>
                    <button
                      className="soft-button"
                      onClick={() => {
                        const blob = new Blob(
                          [JSON.stringify({ theme, density }, null, 2)],
                          { type: "application/json" },
                        );
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "mail-appearance.json";
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast("Appearance settings exported");
                      }}
                    >
                      Export appearance settings
                      <ArrowDown size={14} />
                    </button>
                    {nativeDesktop && (
                      <button
                        className="soft-button quit-button"
                        onClick={() =>
                          void storage
                            .flush()
                            .then(() => quitDesktop())
                            .catch((error) => showToast(String(error)))
                        }
                      >
                        Quit Mail
                        <X size={14} />
                      </button>
                    )}
                  </section>
                </div>
              </>
            )}
          </main>
        </div>
        <footer className="window-footer">
          <button onClick={() => navigate("inbox")}>
            <span className="small-status-dot" />
            Design preview
          </button>
          <span>
            {view === "calendar"
              ? "Your time, thoughtfully arranged."
              : "All accounts. One calm place."}
          </span>
          <button onClick={() => setView("settings")}>
            Local sample data
            <ChevronRight size={12} />
          </button>
        </footer>
      </section>
      <div className="desktop-bottom">
        <span>Gmail · Outlook · IMAP</span>
        <span>Designed around your attention.</span>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          {undo && (
            <button
              onClick={() => {
                patch(undo.id, { folder: undo.folder });
                setUndo(null);
                setToast("Action undone");
              }}
            >
              Undo
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {compose && <Composer draftId={compose} close={() => setCompose(null)} />}
      {eventEdit && (
        <div className="modal-backdrop">
          <form
            className="event-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              events.some((e) => e.id === eventEdit.id)
                ? "Edit event"
                : "New event"
            }
            onSubmit={(e) => {
              e.preventDefault();
              if (eventEdit.end <= eventEdit.time) {
                showToast("End time must be after start time.");
                return;
              }
              setEvents((es) => [
                ...es.filter((x) => x.id !== eventEdit.id),
                eventEdit,
              ]);
              setEventEdit(null);
              showToast("Sample event saved on this device");
            }}
          >
            <div className="dialog-heading">
              <h2>
                {events.some((e) => e.id === eventEdit.id)
                  ? "Edit event"
                  : "A little time for…"}
              </h2>
              <IconButton
                label="Close event editor"
                onClick={() => setEventEdit(null)}
              >
                <X size={17} />
              </IconButton>
            </div>
            <label>
              Event title
              <input
                autoFocus
                required
                placeholder="What’s the plan?"
                value={eventEdit.title}
                onChange={(e) =>
                  setEventEdit({ ...eventEdit, title: e.target.value })
                }
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={eventEdit.date}
                onChange={(e) =>
                  setEventEdit({ ...eventEdit, date: e.target.value })
                }
              />
            </label>
            <div className="form-pair">
              <label>
                Starts
                <input
                  type="time"
                  required
                  value={eventEdit.time}
                  onChange={(e) =>
                    setEventEdit({ ...eventEdit, time: e.target.value })
                  }
                />
              </label>
              <label>
                Ends
                <input
                  type="time"
                  required
                  value={eventEdit.end}
                  onChange={(e) =>
                    setEventEdit({ ...eventEdit, end: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Calendar
              <ThemedSelect
                aria-label="Calendar"
                value={eventEdit.calendar}
                onValueChange={(value) =>
                  setEventEdit({
                    ...eventEdit,
                    calendar: value as CalendarEvent["calendar"],
                  })
                }
              >
                <option>Personal</option>
                <option>Work</option>
              </ThemedSelect>
            </label>
            <label>
              Notes
              <textarea
                value={eventEdit.notes}
                onChange={(e) =>
                  setEventEdit({ ...eventEdit, notes: e.target.value })
                }
                placeholder="Anything to remember?"
              />
            </label>
            <div className="dialog-actions">
              {events.some((e) => e.id === eventEdit.id) && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    setEvents((es) => es.filter((e) => e.id !== eventEdit.id));
                    setEventEdit(null);
                    showToast("Sample event deleted");
                  }}
                >
                  Delete event
                </button>
              )}
              <span className="grow" />
              <button
                type="button"
                className="soft-button"
                onClick={() => setEventEdit(null)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Save event
              </button>
            </div>
            <p className="settings-note">
              Local preview only · nothing is added to Google Calendar.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
void storage
  .initialize()
  .then(() => {
    root.render(
      <React.StrictMode>
        <StorageNotice />
        {isComposer ? <Composer /> : <App />}
      </React.StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <div className="startup-error" role="alert">
        <h1>Mail couldn’t open its local workspace.</h1>
        <p>
          Your saved data has not been reset. Check access to the application
          data folder, then restart Mail.
        </p>
        {nativeDesktop && (
          <button className="soft-button" onClick={() => void quitDesktop()}>
            Quit Mail
          </button>
        )}
      </div>,
    );
  });
