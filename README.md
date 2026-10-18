# Mail

A personal mail client for CachyOS/GNOME, developed on Windows 11 with WSL2. Current milestone: interactive prototype, Tauri Linux desktop shell and initial read-only personal Outlook connection. Real sign-in requires your own Microsoft app registration; no AI service is connected. Sample mail remains separate.

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

The browser preview remains useful for design work. The Tauri shell builds on Linux, with real window controls, separate compose windows, close-to-background, single-instance reopening and an explicit Quit action. Formatted mail uses a sanitized, sandboxed renderer. Personal Outlook sign-in, GNOME Keyring token storage and an initial recent-inbox reader are implemented for the desktop app; live verification needs your registration. Autostart and background synchronization remain pending. See [Linux desktop setup](docs/linux-desktop.md) and [Outlook setup](docs/outlook-setup.md).

## Try it

- Switch between light and dark with the appearance icon, or choose System in Settings.
- Open conversations and return to the inbox. Archive and undo, star messages, change action categories, or move messages between Important and Other.
- Toggle the sidebar for Drafts, Archive, Trash and follow-up views.
- Search by sender, subject or sample message text; filter by account or unread status.
- Compose in a separate browser window. Drafts autosave locally. If popup windows are blocked, an in-page composer is used instead.
- Create and edit local sample calendar events. Month navigation works; Day and Week are initial agenda sketches anchored to the sample date, October 17, 2026.
- Change inbox density and export appearance settings.
- Account colors: Gmail yellow, Outlook blue, work IMAP green, adapted for light and dark themes.
- Open the Studio North sample for formatted email, blocked remote-image placeholders, Original appearance and Plain text controls.

All sample addresses use reserved example domains. Sample attachments only store filenames; nothing is uploaded. The composer remains a plain-text preview and never sends mail. The separate Outlook reader can fetch real messages only after secure user sign-in; no write/send permission is requested. Fetched messages stay in memory and are not mixed into the sample store.

## Local state and reset

Sample mail changes, drafts, events and appearance preferences live in this browser's localStorage for the local preview origin. This is suitable only for synthetic prototype data, not real email credentials or private mail. To reset, clear site data for the local preview origin using your browser settings. No analytics or external assets are loaded by the prototype.

The native shell stores sample data and preferences in a local SQLite workspace, under the operating system's app-data directory for `dev.personal.mail`. Drafts are stored separately and updates synchronize across application windows. Save failures remain visible and can be retried; compose windows wait for pending saves before closing. The browser preview retains its separate localStorage data. Neither store contains credentials. Personal Outlook refresh credentials are saved only in GNOME Keyring. A normalized offline real-mail cache is future work.

## Project decisions

See [the action plan](outputs/mail-client-action-plan.md) for full requirements and milestones. Key constraints: work mail must never enter cloud AI; personal automatic cloud relevance analysis may use sender and subject only; manual body sharing requires an explicit action; AI usage caps will follow a measured trial. These boundaries are recorded in the preview, but backend enforcement is a later implementation stage.
