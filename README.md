# Mail

A personal mail client for CachyOS/GNOME, developed on Windows 11 with WSL2. Current milestone: personal Outlook mail with local whole-mailbox search, incremental caching, everyday mail actions, conversations and durable local drafts in a Tauri Linux desktop shell. Real sign-in requires your own Microsoft app registration; no AI service is connected. Sample mail is available only in browser development previews.

## Run the prototype

Install a current Node.js LTS version, then:

```sh
npm ci
npm run dev
```

Open the local address shown in the terminal (normally http://127.0.0.1:5173). The same source can be pulled and run on the CachyOS laptop. Keep each environment's node_modules directory separate. Build verification:

```sh
npm run build
```

The browser preview remains useful for design work. The Tauri shell builds on Linux, with real window controls, separate compose windows, close-to-background, single-instance reopening and an explicit Quit action. Formatted mail uses a sanitized, sandboxed renderer. Personal Outlook uses GNOME Keyring, opens directly on launch, supports Important/Other and older pages, and offers optional Mail.Send consent for new messages/replies. Images load only on request and files save through native dialogs. New provider actions still need laptop verification. Incremental synchronization runs while the app is open or hidden; OS autostart and notifications remain pending. See [Linux desktop setup](docs/linux-desktop.md) and [Outlook setup](docs/outlook-setup.md).

## Browser design preview

- Switch between light and dark with the appearance icon, or choose System in Settings.
- Open conversations and return to the inbox. Archive and undo, star messages, change action categories, or move messages between Important and Other.
- Toggle the sidebar for Drafts, Archive, Trash and follow-up views.
- Search by sender, subject or sample message text; filter by account or unread status.
- Compose in a separate browser window. Drafts autosave locally. If popup windows are blocked, an in-page composer is used instead.
- Create and edit local sample calendar events. Month navigation works; Day and Week are initial agenda sketches anchored to the sample date, October 17, 2026.
- Change inbox density and export appearance settings.
- Account colors: Gmail yellow, Outlook blue, work IMAP green, adapted for light and dark themes.
- Open the Studio North sample for formatted email, blocked remote-image placeholders, Original appearance and Plain text controls.

All sample addresses use reserved example domains. Sample attachments only store filenames; nothing is uploaded. The browser composer is a preview and never sends. The Linux app has a separate real composer that submits only after Mail.Send consent and an explicit Send action. Real mail uses a separate local search/offline database; real drafts and send-state records use their own database. Both contain unencrypted local mail data.

## Local state and reset

Sample mail changes, drafts, events and appearance preferences live in this browser's localStorage for the local preview origin. This is suitable only for synthetic prototype data, not real email credentials or private mail. To reset, clear site data for the local preview origin using your browser settings. No analytics or external assets are loaded by the prototype.

The native shell stores sample data and preferences in a local SQLite workspace, under the operating system's app-data directory for `dev.personal.mail`. Drafts are stored separately and updates synchronize across application windows. Save failures remain visible and can be retried; compose windows wait for pending saves before closing. The browser preview retains its separate localStorage data. Neither store contains credentials. Personal Outlook refresh credentials are saved only in GNOME Keyring. Real drafts, attachment copies and send states persist separately in `outlook-drafts.sqlite` (not encrypted at rest). The separate `outlook-mail.sqlite` caches indexed message bodies, folder metadata and attachment names for offline reading/search. It is not encrypted. Settings offers pause/resume and account-scoped cache clearing; credentials and mail are excluded from settings exports.

## Project decisions

See [the action plan](outputs/mail-client-action-plan.md) for full requirements and milestones. Key constraints: work mail must never enter cloud AI; personal automatic cloud relevance analysis may use sender and subject only; manual body sharing requires an explicit action; AI usage caps will follow a measured trial. These boundaries are recorded in the preview, but backend enforcement is a later implementation stage.

## Connected desktop experience

The native app lists actual Outlook folders and expandable subfolders, plus separate Local drafts, with no sample navigation. Important/Other follows Outlook's Focused classification. Opening a message shows a quieter reading page, expanded indexed conversation history, Reply, Reply all and Forward. Folder state, loaded pages and scroll position are remembered during the session; previous/next navigation is available.

The top search field searches all indexed Outlook folders, including body text, recipients and filenames. It supports ranked results, snippets, spelling suggestions, phrases, Boolean queries, date/attachment/folder filters and common English date phrases. Initial indexing and filename coverage remain visible. See [search syntax, coverage and privacy](docs/search.md).

Use Settings → Personal Outlook → Enable sending for Mail.Send consent, and Enable mail actions & read sync for Mail.ReadWrite consent. Archive, move to Deleted Items, move folders, Junk/out of Junk and read/unread work individually or in selections of up to 100. Undo is available for ten minutes in the current session, provided the message has not changed externally. Junk actions move mail; they do not claim to train Microsoft's spam filtering or block senders.

Compose uses editable recipient chips with locally derived contact suggestions, optional Cc/Bcc, plain text, discard confirmation, native attachment picking/drop, progress and Done after submission. Up to 20 MB total and 20 files can be copied into a draft; the larger upload path also requires Mail.ReadWrite. Provider limits still apply. A five-second Undo Send precedes submission. Uncertain sends are held and never automatically replayed. Rich text, templates, signatures and schedules remain pending. See [Outlook setup and laptop checks](docs/outlook-setup.md).

For visual QA only, `npm run dev` also exposes `/?outlookPreview` with synthetic connected-reader/folder data and `/?outlookPreview=compose&outlookCompose=preview-draft` for composing with mock attachments. These fixtures are excluded from production builds and never appear in normal app navigation.
