# Mail development checkpoint — 18 October 2026

Current update: compose fields have inline theme-aware focus styling, Cc/Bcc disclosure and autofocus, native file selection/removal and durable draft attachment copies (2 MB total/20 files). Actual Outlook folders and lazy subfolders are browsable, including Sent Items/Junk/Deleted Items and provider Drafts; local drafts stay separate. Inbox alone has Important/Other. Optional Mail.ReadWrite consent enables server read-status updates after successful message loads, clearing local unread dots only after server success. Existing sending permission survives upgrades. The reader shows To/Cc; identical addresses in both remain separate headers, while pagination only merges identical provider message IDs.

Validation: 33 frontend and 31 Rust tests pass (64 total); frontend and Linux builds pass. Browser checks with synthetic data cover attachment controls and soft focus in light/dark, folder/subfolder selection and clearing unread indicators after opening/back. Native file-picker behavior, new Microsoft consent, attachment receipt and live read-state propagation still need laptop verification. No real email was sent in these checks. Large outgoing attachments, rich text, scheduling, provider-draft editing, offline caching and background sync remain pending.

## Earlier connected-client checkpoint

Latest connected-client changes: native startup opens the real Outlook inbox automatically and removes sample navigation. Important/Other uses provider inferenceClassification; 100-header pages continue through Load older messages. Compose and Reply open native windows with separate durable local drafts, To/Cc/Bcc, plain-text sending after additional Mail.Send consent, five-second Undo Send, and persistent uncertain-send states that block replay. Existing read-only credentials remain valid. The reader fills available width/height; per-message image loading uses a bounded raster broker, CID support, public-address/DNS pinning and no token-bearing remote requests. Images and file attachments can be saved through native dialogs. The email sandbox stays unchanged.

Verification for this update: 26 frontend and 26 Rust tests pass (52 total), frontend and Linux executable builds pass, and startup reaches document/workspace loading in WSLg software rendering. Browser QA uses an explicitly marked development-only synthetic fixture; it covers paging to 70 matching messages, switching relevance views, opening a message, image replacement, and the responsive reading surface in both themes. Live Mail.Send consent, delivery and native download dialogs still require laptop verification. No real email was sent by development checks. Sending is plain text; outgoing attachments, scheduling, rich text, offline Inbox cache, background sync and full threads remain pending. See `docs/outlook-setup.md` for setup, size limits and private-data storage behavior. The older checkpoints below are historical.

## Earlier Outlook reader checkpoint

Current milestone: initial personal Outlook connection and read-only recent-mail reader. Settings accepts a user-owned Microsoft client ID, opens the system browser for authorization-code/PKCE sign-in and stores refresh credentials in GNOME Keyring. The separate reader fetches 25 recent Inbox headers and loads individual bodies only on opening, through the existing sandboxed renderer. It offers local sender/subject search, refresh, clear errors and disconnect. Sending/mutations, offline cache, paging, full threads and other providers remain pending. No AI is connected; real mail stays in memory outside the sample store/exports.

Verification: 20 frontend tests and 18 Rust tests pass; frontend production build and Linux executable build pass. Tests cover callback state/Host/path, a real local callback listener, cancellation, token-free public status, simulated vault failures/refresh rotation, unknown IDs and frontend message isolation/late responses. The user confirmed the earlier shell and themed dropdowns work on CachyOS. This new account flow has not been verified against a real Microsoft account or actual Secret Service: it requires the user's own registration. Follow [Outlook setup](../docs/outlook-setup.md). Native startup is smoke-tested separately from GNOME appearance.

## Earlier local foundations checkpoint

Dropdown appearance update: replaced all eight native select controls with an app-owned, theme-aware popup. Account filters, action categories, appearance settings, sender identity, templates and the calendar picker now share rounded surfaces, a selected checkmark and a blue highlight. Keyboard arrows, Home/End, typing to find a choice, Enter/Space, Escape and Tab are supported. Popups are positioned within the viewport and close on outside interaction, scrolling or resizing. Five new interaction tests pass, bringing the frontend suite to 16. The production build and light/dark browser appearance checks pass; account filtering and calendar selection were also verified in the browser. The user reported that the initial app runs and looks good on CachyOS; these updated dropdowns still need a laptop check.

The initial Linux shell now builds and loads both its bundled application document and native SQLite workspace during a software-rendered WSLg startup check. This does not yet validate native GNOME interactions or appearance.

Implemented since the first prototype:

- Gmail yellow, Outlook blue and work IMAP green throughout the interface, with theme-specific contrast.
- Tauri shell with custom window controls, separate compose windows, close-to-background, single-instance reopening, window-state restoration and explicit Quit.
- Protected formatted-message view: sanitization, opaque-origin sandbox, restrictive content policies, blocked remote images/scripts/forms/navigation, and safe Original appearance/Plain text toggles.
- Native SQLite persistence with separate draft records, revisioned updates between windows, visible save failures and retry. Compose windows flush drafts before closing. Quit asks to close open compose windows first.
- Backend privacy-payload foundation: automatic personal relevance input excludes bodies; manual summary/reply requires explicit body sharing; work mail and flagged derived work content are rejected. There is no connected AI dispatcher yet.

Verification: 11 frontend tests and 9 Rust tests pass. The production build passes. Tests cover HTML safety, simultaneous drafts, save failures, stale updates, database reopening, schema versions and privacy policy. The icon library produces non-blocking client-directive bundler notices. Browser checks also cover save-before-close and updated appearance.

Pending: CachyOS/GNOME window-interaction and styling checks; keyring; autostart; real notifications and blur; real account sign-in/synchronization; mail delivery/scheduling; full calendar synchronization; Nextcloud; rich text; rules; plugins. Day/Week calendar views remain fixture-date agenda sketches. Normal accelerated WSLg startup reported graphics-driver errors; software rendering reached the expected startup signals, with warnings about unavailable desktop services.

Outlook is confirmed to be a personal Microsoft account. No real account or AI service is connected. Browser state remains in localStorage; the native shell uses its own SQLite workspace. Credentials do not belong in either store. The native database is not encrypted at rest.

Run `npm ci` and `npm run dev` for the browser preview. Linux build/setup instructions and the laptop checklist are in `docs/linux-desktop.md` in the source repository.

## First prototype — historical record

The following describes the original browser-only checkpoint and is superseded by the status above.

The project now contains an interactive React/TypeScript visual prototype for the agreed Mail design. Run `npm ci` followed by `npm run dev` from the project directory. The source runs on Windows and Linux; the final desktop application remains targeted at CachyOS/GNOME.

Implemented in the preview: light/dark/system appearance, adjustable inbox density, a unified sample inbox, account and unread filters, text search, collapsible navigation, expanded conversations, stars and action categories, archive/trash with undo, separate compose windows with local draft saving, and a sample calendar with event editing.

Not yet implemented: native desktop shell, actual background services, real mail or calendar synchronization, delivery/scheduling, attachment upload/download, rich-text editing, Nextcloud, AI, or plugins. The calendar's Day and Week views are early agenda sketches anchored to the fixture date. Settings accurately identify disconnected services. Sample state is stored in the browser only.

Next milestone: review and refine this appearance, then validate the Tauri shell and safe email rendering in WSL2 and on the CachyOS laptop before connecting accounts.

Verification completed: production build and TypeScript check; browser inspection in light and dark; conversation opening; archive and undo; text search; editing and saving a calendar event; standalone composer fields; draft autosave and restoration after reload; draft visibility in the main window. Browser error logs were empty during these checks. Screenshots are saved beside this document as `mail-light.png` and `mail-dark.png`.

The available WSL distributions were identified as Kali Linux and Docker Desktop. Their application build dependencies have not yet been configured. No native CachyOS behavior has been verified.
