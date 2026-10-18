// Development-only visual fixture. This module is excluded from production by
// the import.meta.env.DEV gate in main; it never connects or sends real mail.
import { useEffect, useState } from "react";
import { Moon, Sun, Search } from "lucide-react";
import { OutlookInbox } from "./OutlookInbox";
import { outlookApi, type OutlookSummary } from "./outlook";
import { initialMail } from "./data";
import icon from "../src-tauri/icons/icon.png";
import { OutlookComposer } from "./OutlookComposer";
import { OutlookFolders, defaultOutlookFolder } from "./OutlookFolders";
import type { OutlookDraft, OutlookFolder } from "./outlook";

let previewDraft: OutlookDraft = {
  id: "preview-draft",
  account: "you@outlook.example",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  replyId: null,
  state: "draft",
  attachments: [],
};
outlookApi.status = async () => ({
  account: { email: previewDraft.account, displayName: "Example" },
  clientId: "fixture",
  canSend: true,
  canManage: true,
});
outlookApi.loadDraft = async () => previewDraft;
outlookApi.saveDraft = async (draft) => {
  previewDraft = { ...draft };
};
outlookApi.addDraftFiles = async () => [
  { id: "draft-file", name: "trip-notes.pdf", size: 45000 },
];
outlookApi.removeDraftFile = async () => [];
outlookApi.sendDraft = async () => "Development fixture — no email sent";
outlookApi.markRead = async (id) => {
  const message = messages.find((message) => message.id === id);
  if (message) message.isRead = true;
};
outlookApi.folders = async (parent = null) =>
  parent
    ? [
        {
          id: "child-1",
          displayName: "Travel",
          isInbox: false,
          unreadItemCount: 2,
          childFolderCount: 0,
        },
      ]
    : [
        defaultOutlookFolder,
        ...[
          "Sent Items",
          "Archive",
          "Junk Email",
          "Deleted Items",
          "Outlook Drafts",
          "Personal",
        ].map((displayName, index) => ({
          id: `folder-${index}`,
          displayName,
          isInbox: false,
          unreadItemCount: 0,
          childFolderCount: index === 5 ? 1 : 0,
        })),
      ];

const messages: OutlookSummary[] = Array.from({ length: 140 }, (_, index) => {
  const sample = initialMail[index % initialMail.length];
  return {
    id: `preview-${index}`,
    subject: `${sample.subject}${index >= initialMail.length ? ` · ${index + 1}` : ""}`,
    from: {
      emailAddress: { name: sample.sender, address: "sender@example.test" },
    },
    receivedDateTime: "2026-10-18T10:00:00Z",
    isRead: index % 3 === 0,
    hasAttachments: true,
    inferenceClassification: index % 2 ? "other" : "focused",
  };
});
outlookApi.inbox = async (view = "important", older = false) => ({
  messages: messages
    .filter(
      (message) =>
        (message.inferenceClassification === "focused") ===
          (view === "important") || view === "all",
    )
    .slice(older ? 10 : 0, older ? 70 : 10),
  hasMore: !older,
});
outlookApi.message = async (id) => ({
  id,
  body: {
    contentType: "html",
    content: `<h2>A little more room to read</h2><p>This is a synthetic message for checking the connected inbox layout.</p><img src="https://images.example.test/logo" alt="Mail logo" width="72"><p>The reading surface now follows the window’s available width and height. The protected frame remains isolated from application controls.</p>${Array.from({ length: 8 }, (_, index) => `<p>Paragraph ${index + 1}. Open a message, load images if you choose, and go back to the same inbox position. Important and Other use the same classification as Outlook.</p>`).join("")}`,
  },
});
outlookApi.attachments = async () => [
  {
    id: "fixture-file",
    name: "picture.png",
    size: 256,
    contentType: "image/png",
    isInline: false,
  },
];
outlookApi.images = async () => {
  const blob = await (await fetch(icon)).blob();
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return {
    images: [{ source: "https://images.example.test/logo", dataUrl }],
    blocked: 0,
  };
};
outlookApi.downloadAttachment = async () => false;
outlookApi.downloadImage = async () => false;

export function ConnectedPreview() {
  const [dark, setDark] = useState(false);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<OutlookFolder>(defaultOutlookFolder);
  const composePreview =
    new URLSearchParams(location.search).get("outlookPreview") === "compose";
  useEffect(() => {
    document.documentElement.dataset.native = "true";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return composePreview ? (
    <>
      <button
        style={{ position: "fixed", right: 20, top: 14, zIndex: 10 }}
        className="soft-button"
        onClick={() => setDark(!dark)}
      >
        {dark ? "Light appearance" : "Dark appearance"}
      </button>
      <OutlookComposer
        controls={
          <div className="traffic">
            <span className="red" />
            <span className="yellow" />
            <span className="green" />
          </div>
        }
      />
    </>
  ) : (
    <div className="desktop">
      <section className="window main-window density-compact">
        <header className="window-bar">
          <div className="traffic">
            <span className="red" />
            <span className="yellow" />
            <span className="green" />
          </div>
          <span className="window-title">Mail</span>
          <span className="grow" />
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Search mail"
              placeholder="Search mail"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label={dark ? "Light appearance" : "Dark appearance"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        <div className="app-body">
          <aside className="sidebar">
            <OutlookFolders selected={folder.id} onSelect={setFolder} />
            <a href="/?outlookPreview=compose&outlookCompose=preview-draft">
              Compose preview
            </a>
          </aside>
          <main className="main-content">
            <OutlookInbox
              key={folder.id}
              folder={folder}
              canManage={true}
              account={{ email: "you@outlook.example", displayName: "Example" }}
              dark={dark}
              query={query}
              compose={() => {}}
            />
          </main>
        </div>
        <footer className="window-footer">
          Development fixture · synthetic messages · no account connected
        </footer>
      </section>
    </div>
  );
}
