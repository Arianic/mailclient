// Development-only visual fixture. This module is excluded from production by
// the import.meta.env.DEV gate in main; it never connects or sends real mail.
import { useEffect, useState } from "react";
import { Moon, Sun, Search } from "lucide-react";
import { OutlookInbox } from "./OutlookInbox";
import { outlookApi, type OutlookSummary } from "./outlook";
import { initialMail } from "./data";
import icon from "../src-tauri/icons/icon.png";
import { OutlookComposer } from "./OutlookComposer";
import { IndexSettings } from "./IndexSettings";
const indexPreview =
  new URLSearchParams(location.search).get("outlookPreview") === "index";
let rescanning = false;
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
  bodyHtml: "<p></p>",
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
let previewLibrary: import("./outlook").WritingLibrary = {
  revision: 0,
  defaultSignature: null,
  entries: [
    {
      id: "preview-signature",
      kind: "signature",
      name: "Personal",
      body: "Alex Morgan\nSent from Mail",
      bodyHtml: "<p><strong>Alex Morgan</strong><br>Sent from Mail</p>",
    },
    {
      id: "preview-template",
      kind: "template",
      name: "Meeting follow-up",
      subject: "Following up on our conversation",
      body: "Thank you for your time.\nHere are the next steps:",
      bodyHtml:
        "<p>Thank you for your time.</p><p>Here are the <strong>next steps</strong>:</p><ul><li><p>Confirm a date</p></li></ul>",
    },
    {
      id: "preview-snippet",
      kind: "snippet",
      name: "Thank you",
      body: "Thanks for your help — I appreciate it.",
      bodyHtml: "<p>Thanks for your help — I appreciate it.</p>",
    },
  ],
};
outlookApi.writingLibrary = async () => previewLibrary;
outlookApi.saveWritingLibrary = async (_id, library) => {
  previewLibrary = { ...library, revision: library.revision + 1 };
  return previewLibrary;
};
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
    subject: `${index % 4 === 1 ? "Invoice for September booking" : sample.subject}${index >= initialMail.length ? ` · ${index + 1}` : ""}`,
    from: {
      emailAddress: { name: sample.sender, address: "sender@example.test" },
    },
    receivedDateTime: "2026-09-18T10:00:00Z",
    parentFolderId: index % 5 === 1 ? "folder-0" : "inbox",
    toRecipients: [
      { emailAddress: { name: "Alex Morgan", address: "alex@example.test" } },
    ],
    conversationId: `thread-${index}`,
    isRead: index % 3 === 0,
    hasAttachments: true,
    inferenceClassification: index % 2 ? "other" : "focused",
  };
});
outlookApi.indexStatus = async () => ({
  messages: indexPreview ? 300 : 140,
  reportedItems: indexPreview ? 5000 : 140,
  coverageGaps: indexPreview && !rescanning ? 1 : 0,
  folders: 7,
  pending: rescanning ? 7 : 0,
  missingFiles: 0,
  lastSync: 1,
  error: null,
});
outlookApi.indexControl = async (action) => {
  if (action === "rebuild") rescanning = true;
  return outlookApi.indexStatus();
};
outlookApi.sync = async () => false;
outlookApi.cachedFolders = async () => outlookApi.folders();
outlookApi.contacts = async (query) =>
  [
    { name: "Alex Morgan", address: "alex@example.test" },
    { name: "Maya Chen", address: "maya@example.test" },
  ].filter((contact) =>
    `${contact.name} ${contact.address}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
outlookApi.inbox = async (
  view = "important",
  older = false,
  folder = "inbox",
  offset = 0,
) => {
  const all = messages.filter(
    (message) =>
      (folder === "inbox"
        ? message.parentFolderId === "inbox"
        : message.parentFolderId === folder) &&
      (view === "all" ||
        (message.inferenceClassification === "focused") ===
          (view === "important")),
  );
  return {
    messages: all.slice(older ? offset : 0, (older ? offset : 0) + 10),
    hasMore: (older ? offset : 0) + 10 < all.length,
  };
};
outlookApi.search = async (query, offset = 0, sort = "relevance") => {
  const words = query
    .replace(
      /(?:from|to|subject|body|filename|after|before|folder|is|has):(?:"[^"]*"|\S+)/g,
      "",
    )
    .replaceAll('"', "")
    .trim()
    .toLowerCase();
  let all = messages.filter(
    (message) =>
      !words ||
      `${message.subject} ${message.from?.emailAddress.name}`
        .toLowerCase()
        .includes(words),
  );
  if (sort === "oldest") all = [...all].reverse();
  return {
    messages: all.slice(offset, offset + 10),
    hasMore: offset + 10 < all.length,
    total: all.length,
    snippets: Object.fromEntries(
      all.map((message) => [
        message.id,
        "Your September invoice includes the booking reference, payment details and attached receipt.",
      ]),
    ),
    suggestions: all.length ? [] : ["invoice"],
    status: await outlookApi.indexStatus(),
  };
};
const savedActions = new Map<string, typeof messages>();
outlookApi.action = async (ids, action, destination) => {
  const before = messages
    .filter((message) => ids.includes(message.id))
    .map((message) => ({ ...message }));
  savedActions.set("fixture-undo", before);
  for (const message of messages.filter((message) =>
    ids.includes(message.id),
  )) {
    if (action === "read" || action === "unread")
      message.isRead = action === "read";
    else
      message.parentFolderId =
        destination ||
        {
          archive: "folder-1",
          delete: "folder-3",
          junk: "folder-2",
          notJunk: "inbox",
        }[action] ||
        "inbox";
  }
  return { ids, failures: [], undo: "fixture-undo" };
};
outlookApi.undo = async () => {
  const saved = savedActions.get("fixture-undo") || [];
  for (const before of saved) {
    const message = messages.find((message) => message.id === before.id);
    if (message) Object.assign(message, before);
  }
  return { ids: saved.map((message) => message.id), failures: [], undo: null };
};
outlookApi.discardDraft = async () => {};
outlookApi.conversation = async (id) => ({ messages: [], complete: true });
outlookApi.message = async (id) => ({
  id,
  body: {
    contentType: "html",
    content: `<h2>A little more room to read</h2><p>This is a synthetic message for checking the connected inbox layout.</p><img src="https://images.example.test/logo" alt="Mail logo" width="72"><p>The reading surface now follows the window’s available width and height. The protected frame remains isolated from application controls.</p>${Array.from({ length: 8 }, (_, index) => `<p>Paragraph ${index + 1}. Open a message, load images if you choose, and go back to the same inbox position. Important and Other use the same classification as Outlook.</p>`).join("")}`,
  },
});
outlookApi.attachments = async () => [
  {
    id: "inline-logo",
    name: "email-logo.png",
    size: 256,
    contentType: "image/png",
    isInline: true,
  },
  {
    id: "fixture-file",
    name: "report.pdf",
    size: 256,
    contentType: "application/pdf",
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
            {indexPreview ? (
              <IndexSettings />
            ) : (
              <OutlookInbox
                key={folder.id}
                folder={folder}
                canManage={true}
                account={{
                  email: "you@outlook.example",
                  displayName: "Example",
                }}
                dark={dark}
                query={query}
                onQueryChange={setQuery}
                compose={() => {}}
              />
            )}
          </main>
        </div>
        <footer className="window-footer">
          Development fixture · synthetic messages · no account connected
        </footer>
      </section>
    </div>
  );
}
