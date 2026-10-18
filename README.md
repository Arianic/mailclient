# Mail

A personal mail client for CachyOS/GNOME, developed on Windows 11 with WSL2. Current milestone: interactive prototype, Tauri Linux desktop shell and personal Outlook inbox, local drafts, optional sending and image/attachment downloads. Real sign-in requires your own Microsoft app registration; no AI service is connected. Sample mail is available only in browser development previews.

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

The browser preview remains useful for design work. The Tauri shell builds on Linux, with real window controls, separate compose windows, close-to-background, single-instance reopening and an explicit Quit action. Formatted mail uses a sanitized, sandboxed renderer. Personal Outlook uses GNOME Keyring, opens directly on launch, supports Important/Other and older pages, and offers optional Mail.Send consent for new messages/replies. Images load only on request and files save through native dialogs. New provider actions still need laptop verification. Autostart and background synchronization remain pending. See [Linux desktop setup](docs/linux-desktop.md) and [Outlook setup](docs/outlook-setup.md).

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

All sample addresses use reserved example domains. Sample attachments only store filenames; nothing is uploaded. The browser composer is a preview and never sends. The Linux app has a separate real composer that submits only after Mail.Send consent and an explicit Send action. Fetched mail stays in memory; real drafts/send-state records use a separate local database.

## Local state and reset

Sample mail changes, drafts, events and appearance preferences live in this browser's localStorage for the local preview origin. This is suitable only for synthetic prototype data, not real email credentials or private mail. To reset, clear site data for the local preview origin using your browser settings. No analytics or external assets are loaded by the prototype.

The native shell stores sample data and preferences in a local SQLite workspace, under the operating system's app-data directory for `dev.personal.mail`. Drafts are stored separately and updates synchronize across application windows. Save failures remain visible and can be retried; compose windows wait for pending saves before closing. The browser preview retains its separate localStorage data. Neither store contains credentials. Personal Outlook refresh credentials are saved only in GNOME Keyring. Real drafts, attachment copies and send states persist separately in `outlook-drafts.sqlite` (not encrypted at rest). A normalized offline Inbox cache is future work.

## Project decisions

See [the action plan](outputs/mail-client-action-plan.md) for full requirements and milestones. Key constraints: work mail must never enter cloud AI; personal automatic cloud relevance analysis may use sender and subject only; manual body sharing requires an explicit action; AI usage caps will follow a measured trial. These boundaries are recorded in the preview, but backend enforcement is a later implementation stage.

## Connected desktop experience

The native app lists actual Outlook folders and expandable subfolders, plus separate Local drafts, with no sample navigation. Important maps to Outlook's Focused classification in Inbox; other folders show all messages. Mail reads 100 headers per page, and Load older messages continues through history. Search covers loaded sender/subject lines. Compose and Reply open native windows with quieter focus styling and optional Cc/Bcc fields, save drafts before close and use a five-second Undo Send delay. Uncertain sends are held for review and are never automatically replayed.

Use Settings → Personal Outlook → Enable sending for Mail.Send consent, and Enable read-status sync for Mail.ReadWrite consent. Opening unread mail then marks it read in Outlook and clears the local dot only after a successful update. Sending supports plain text and up to 2 MB total in 20 attachments, copied into the durable local draft through a native picker. Rich text, large attachments and schedules are pending. Load images is per-message permission; supported raster images are brokered into data URLs without relaxing the email sandbox. Native downloads use a save dialog. See [Outlook setup and limits](docs/outlook-setup.md).

For visual QA only, `npm run dev` also exposes `/?outlookPreview` with synthetic connected-reader/folder data and `/?outlookPreview=compose&outlookCompose=preview-draft` for composing with mock attachments. These fixtures are excluded from production builds and never appear in normal app navigation.
