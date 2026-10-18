# Mail development checkpoint — 18 October 2026

## Search guidance without AI — 18 October 2026

The user explicitly declined AI for search. Implemented anchored conversational requests, actor-first senders, defined vague dates with visible explanations, small context-bound grammar typo corrections, whole-condition pills, replacement date editing, account-local contact choices with exact-address native filters, optional curated related-word groups, and measured recovery for empty searches. Recovery counts up to eight condition removals and up to three spelling corrections while preserving other filters; query/contacts/diagnostic responses reject obsolete UI results. No model, model download, embedding endpoint, cloud service, new OAuth scope or cache-schema migration is introduced. Search remains limited to the connected personal Outlook cache. See [search guide](../docs/search.md).

Verification: 159 frontend and 52 Rust tests pass. Coverage includes conversational and quoted wording, calendar assumptions, safe Boolean edits, dictionary limits/idempotence, exact address matching and account isolation, filter-preserving spelling, measured counts, date correction, stale responses and cache clearing. Frontend and Linux executable builds pass. Browser synthetic checks cover ambiguous contact selection, date editing, a measured recovery restoring matches, dictionary expansion and both themes. The DEV fixture evaluator is an approximation; native database tests verify real filtering. WSLg startup is checked separately from CachyOS; live account validation remains deferred at the user's request. No automated real mail is sent.

## Expanded familiar-phrase search — 18 October 2026

Local English interpretation now supports multiword people, grouped sender alternatives, sender/other-clause exclusions, combined read/importance qualifiers, sent-by-me, named folders, subject/body words or phrases, attachment presence/absence and filenames. Dates include rolling windows, weekdays, written month/day/year forms, inclusive between/until ranges, since/before and older/newer cutoffs. Current calendar periods are bounded; rolling day/week windows include today. Explicit filters and quoted whitespace stay intact, malformed quotes remain for native validation, and unsupported/invalid natural dates are not guessed. The visible interpreted query and Search tips explain the behavior. See [search guide](../docs/search.md).

Verification: 120 frontend and 49 Rust tests pass, with native database checks for grouped people, attachment exclusions, inclusive end dates and account isolation; production frontend and Linux executable builds pass. Synthetic browser checks verify interpretation/help in light and dark appearances. Browser fixtures do not implement the complete search grammar; database tests verify actual filtering. No live mail is sent and no AI service, credentials, cache schema or permission scope changes. Real mailbox/laptop checks remain user-driven as previously deferred.

## Rich writing checkpoint — 18 October 2026

New drafts use a local Tiptap editor with basic formatting, headings, lists, quotes, safe links, undo/redo and a plain-text alternative. A per-account writing library supports named formatted signatures, default selection, templates with subjects, creating templates from authored message text, snippets at the cursor, editing/deletion and optimistic revision conflicts. Template replacement requires confirmation for written bodies and preserves recipients/files/signature. Draft signature snapshots and separately stored reply quotes keep signature placement predictable; old plain drafts remain compatible.

Draft schema 4 adds the writing-library table. Drafts persist normalized body HTML, a plain-text equivalent, selected signature and quotes. Both normal and larger attachment sends use the same Rust body builder. Frontend and backend allowlists independently reject active content/resources and unsafe links; no received-mail isolation or AI permission changed. The composer/editor is loaded in a separate production chunk.

Verification: 55 frontend and 48 Rust tests pass, including legacy drafts, default signature snapshots, guarded template replacement, cursor insertion/undo, send locking, HTML isolation, account scoping and conflicting library revisions. Frontend and Linux executable builds pass. A clean software-rendered WSLg startup reaches both application-document and workspace-loaded markers. Browser fixtures verify both themes, formatted template/signature use and creating a snippet; fixtures remain excluded from production output. Real-account formatted delivery/native paste checks are deferred at the user's request.

## Mailbox indexing correction — 18 October 2026

The user reported approximately 300 messages indexed while Settings claimed completion for a mailbox with thousands. The initial history scan now uses ordinary folder-message pagination independently of delta change tracking, requests page size through Prefer, and follows empty intermediate pages. Index schema version 2 preserves cached mail and pause preferences while scheduling a fresh scan. Pending change pages and per-folder count gaps no longer present successful completion. Outlook item counts are shown separately because they may include non-email items. Rescan entire mailbox provides non-destructive recovery without reconnecting or clearing drafts.

Verification: 48 frontend and 44 Rust tests pass, including 2,025 messages, a restart at 300, an empty intermediate page, partial initial delta data, pending incremental pages, old-cache migration and account-scoped rescan. Production frontend and Linux builds pass; clean WSLg startup reaches application and workspace markers. Light/dark synthetic browser checks verify incomplete coverage and rescan feedback; those fixtures are absent from production output. Actual full coverage of the user's mailbox must be confirmed after updating on CachyOS.

## Current search and everyday-mail checkpoint — 18 October 2026

Implemented local whole-mailbox Outlook search and incremental offline caching, coverage and pause/clear controls; quieter reading and indexed expanded conversations; individual/bulk mail actions with guarded session Undo; preserved navigation and previous/next; Reply all/Forward; recipient chips with local suggestions; discard; native file drop; 20 MB/20 file sending with upload progress and durable preparation/submission states. Search includes subject, sender/recipients, body and attachment names, not attached-file contents. No AI service/Plus usage is added. See [search](../docs/search.md), [Outlook setup](../docs/outlook-setup.md) and [UX status](ux-review.md).

Verification: 45 frontend and 41 Rust tests pass; production frontend and Linux executable builds pass. Browser fixture checks cover search, filters, light/dark appearance, bulk action/Undo, reading, inline images, local recipient suggestions/chips, attachments and the submitted/Done state. Synthetic fixtures are development-only and absent from production output. An isolated software-rendered WSLg launch reached both application-document and workspace-loaded markers; expected missing dconf/accessibility-service warnings do not validate GNOME behavior. Real-account laptop checks remain necessary; no automated test sends real mail. Local caches/drafts are unencrypted and excluded from settings exports; credentials remain in GNOME Keyring.

Remaining: real-account validation of new sync/actions/uploads on CachyOS; configurable cache retention; native notifications/autostart; Gmail/work IMAP; provider draft editing; rich text/signatures/templates; calendar and Nextcloud sync; optional AI; rules/plugins. Earlier checkpoints below describe their historical state.

Latest image-display cleanup: loaded images now appear only inside the email body; the duplicate download strip is removed. Inline resources are filtered from Attachments while separate file/photo attachments stay downloadable. All 34 frontend tests and the production build pass, and both themes were checked with synthetic data. Rust is unchanged. See `ux-review.md` for the prioritized UX gaps; those recommendations have not been implemented by this cleanup.

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
