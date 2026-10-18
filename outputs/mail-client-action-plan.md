# Personal mail client — action plan

## Progress — rich writing

The composer now has rich text, account-specific signatures/defaults, reusable templates and snippets with local persistence, safe outgoing HTML and preserved send protection. See [writing guide](../docs/writing.md). This milestone does not add sending aliases, schedules, cloud AI, other providers or new permission scopes. Real-account checks are deferred by the user; continue with GNOME integration after this composer milestone.

## Progress — search and daily Outlook UX

The authorized UX/search milestone is implemented: local FTS whole-mailbox search, deterministic common phrase interpretation, filters/ranking/snippets/spelling hints and visible indexing coverage; per-folder delta caching/offline bodies; periodic refresh; everyday single/bulk mail actions and guarded session Undo; navigation snapshots; indexed conversation history; Reply all/Forward; recipient chips/local autocomplete; discard; native attachment drop and larger uploads. See [search behavior and limits](../docs/search.md) and [UX checkpoint](ux-review.md). This connects only the existing personal Outlook account, consumes no AI allowance and does not complete the broader multi-provider/calendar/AI milestones below. Native round trips require laptop checks.

Prepared 17 October 2026. Target: CachyOS with GNOME and WhiteSur. This is an implementation plan, not a claim that the client or its integrations have been built.

Latest refinement, 18 October: the client now browses actual Outlook folders/subfolders, optionally syncs read status with Mail.ReadWrite, and supports durable local draft attachments up to 2 MB/20 files. Compose focus styling is quieter and Cc/Bcc appear on demand. Existing send access is preserved during read-status consent. 64 automated tests and both frontend/Linux builds pass; new consent, live attachment receipt and read-state propagation need laptop checks. See the current checkpoint and Outlook setup guide for limits.

Connected-client refinement, 18 October: Microsoft sign-in was confirmed on CachyOS. Native Mail now opens actual Outlook mail by default, hides sample navigation, pages through older headers and uses Outlook classification for Important/Other. Local real drafts, optional Mail.Send consent, native compose/reply, Undo Send and durable uncertain-send protection have been implemented. A bounded image broker and native downloads replace the previous no-images limitation; the reader fills available window space. Automated tests/builds pass, while live sending/download checks remain user-driven on the laptop. Offline Inbox caching and incremental background sync remain the next reliability milestone. The older progress descriptions below record earlier stages.

Latest progress, 18 October: the user has confirmed the initial shell and theme-aware dropdowns work on CachyOS. A first personal Outlook sign-in/read-only reader is now implemented with browser PKCE sign-in, GNOME Keyring credentials and memory-only recent mail. Automated checks and builds pass; actual Microsoft consent, Secret Service access and live messages still require the user-owned registration described in `../docs/outlook-setup.md`. This is a limited provider proof, not completed multi-account synchronization. See `prototype-status.md` for current scope; the older progress paragraphs below describe earlier checkpoints.

Development environment clarification: all development happens on the user's Windows 11 machine with WSL2. The CachyOS laptop is a Git-pull-and-test target, not the development workstation. Windows support is not added to the product scope by this arrangement.

Current progress: an interactive visual prototype now exists and passes its type/production build check. See `prototype-status.md` in this directory for implemented interactions and verification. Native shell, provider integrations, security boundaries and GNOME validation remain pending; the visual prototype advances the design phase while those prerequisites are still open.

18 October checkpoint: the initial Linux shell builds and reaches application/document and SQLite-workspace loading in a software-rendered WSLg smoke test. The HTML-rendering layer, native SQLite persistence and initial backend privacy-payload rules have been added with 20 passing tests across frontend and Rust suites. Read `prototype-status.md` for scope and limits. Provider connections and native CachyOS/GNOME interaction validation remain pending. Outlook is confirmed personal. Account markers are now Gmail yellow, Outlook blue and work IMAP green.

## Development and test workflow

- Edit and review from Windows; run the Linux desktop build, Linux dependencies and automated checks in WSL2. Use browser previews for fast visual iteration and WSLg, where available, for Linux application smoke tests.
- Prefer a working checkout inside the WSL Linux filesystem for Linux build performance. Keep dependencies and build outputs environment-local; do not share Windows and Linux dependency directories. Confirm the accessible checkout location before establishing it; this plan does not move the current workspace.
- Commit reproducible source, lockfiles, setup instructions and test scripts to Git. Keep credentials, caches and actual mail out of Git. Prepare setup instructions for both the installed WSL distribution and CachyOS.
- Provide a simple documented setup/build/run workflow on the laptop. The user pulls a milestone commit, runs it, and returns observations or privacy-safe diagnostics. Changes are developed on Windows/WSL2 and delivered through Git again.
- Make an early laptop checkpoint part of the shell proof, then repeat native checks after visual, account and background-service milestones. WSLg does not reproduce the complete GNOME desktop; verify WhiteSur appearance, blur fallback, keyring integration, notifications, autostart, scaling and suspend/resume on CachyOS.
- Treat WSL-built binaries as development artifacts until target compatibility is verified. The laptop can build from the pulled source; define and test release packaging separately.

References: [Microsoft WSL GUI support and desktop limitations](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps) and [WSL filesystem recommendations](https://learn.microsoft.com/en-us/windows/wsl/filesystems).

## 1. Product commitments

Build a polished personal desktop mail client whose everyday interface stays compact while advanced features live in contextual menus and settings.

- Custom WhiteSur-inspired styling; GNOME font and text scaling; automatic light/dark with manual override.
- Soft rounded panels, pill controls, neutral light/charcoal surfaces, blue accent, thin outline icons, visible translucency where supported and a polished opaque fallback.
- Left-side macOS-style window controls. Initial window approximately 1100 × 760, adjusted to available screen space. Restore size and position where the desktop permits.
- Single-view navigation: inbox and conversation occupy the same main area. Hidden collapsible sidebar; Inbox, Drafts and Search prominent; other destinations under More.
- Unified Gmail, Outlook and work IMAP inbox, with room for more accounts. Compact sender/subject rows, faint separators, no avatars, unread emphasis and separate account indicators.
- Important/Other segmented control. Uncertain relevance goes to Other with a Needs review marker. Preserve exact inbox position and filters on return.
- Adjustable density, starting with spacious outer panels and compact rows. Modest headings and slightly larger reading text.
- Expanded conversations on one centered, continuous reading surface. Preserve sender formatting where safe, adapt dark-mode colors conservatively, and offer Original appearance. Original appearance never enables unsafe content.
- Separate compose windows; rich formatting, templates, snippets, signatures and aliases. Reply from the receiving identity when available; clearly show From.
- Full Google Calendar accessed through a small Mail/Calendar switch. Nextcloud attachment saving and sharing links.
- Quiet autostart, background operation after window close, selective notifications, sender and subject on the lock screen where supported.
- No team inbox management, project workspace, statistics dashboard, or mobile application in the first release.

## 2. Architecture and early decisions

Proposed starting stack: Tauri 2 desktop shell, TypeScript/React interface, Rust application services, SQLite local cache/search, and GNOME Secret Service/keyring credentials. Keep UI, account adapters, synchronization, scheduling, rules and AI access separate.

This is a provisional engineering choice, subject to the Linux proof below. Custom web-rendered styling fits the requested appearance, while a backend can keep credentials and mail operations outside the visual layer. Tauri uses WebKitGTK on Linux; its dependencies and actual behavior must be tested on CachyOS rather than inferred from a Windows preview. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [WebView versions](https://v2.tauri.app/reference/webview-versions/).

Account adapters: Gmail API, Microsoft Graph, and IMAP plus SMTP for the work account. Confirm actual server capabilities and authentication before finalizing each adapter. Reuse maintained protocol and MIME libraries after license and maintenance review.

No application-hosted server is planned for the initial desktop version. Mail, calendar, storage and optional AI still contact their respective providers. Synchronization and reminders run while the local application is running.

## 3. Phase A — specification and feasibility proof

Create a version-controlled requirements checklist and define the supported behaviors for each provider. Record acceptance checks alongside features so visual completion cannot conceal missing functionality.

Build a small native Linux shell to test:

- GNOME light/dark changes, font settings, scaling and keyboard focus.
- Custom title bar, left window controls, dragging, resizing, maximization and close-to-background behavior.
- Separate compose windows, transitions and opaque/translucent surfaces.
- Keyring access, notification actions and quiet autostart.
- Wayland operation first; X11 where applicable. Do not require a tray extension to recover a hidden running app: launching it again must reopen its window, and an explicit Quit must exist.
- A secure, isolated HTML-mail rendering approach that cannot invoke application commands, access credentials, run email scripts, or issue unapproved network requests. Test this before committing to the shell.

Investigate provider setup at the same stage: Google and Microsoft app registration, work IMAP/SMTP authentication, calendar permissions, and Nextcloud authentication. Determine Google's personal-use/verification requirements and any testing-mode limitations. Gmail restricted-scope requirements and policies for forwarding data to AI must be checked before enabling those flows; public distribution is a separate scope. See [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Deliverable: runnable Linux shell, provider capability matrix, and confirmed architecture. Exit condition: no unresolved blocker in rendering isolation, GNOME operation, or intended account authentication.

## 4. Phase B — interactive design prototype

Use synthetic messages, events and identities. No live mail credentials are needed.

Create light/dark versions of the unified inbox, Other/review state, sidebar, search, expanded conversation, compose window, calendar, settings and overdue queue. Include empty, loading, offline and failed-sign-in states.

Define reusable colors, spacing, typography, radii, icon sizes, focus styles and animation timings. Distinguish unread and account dots by position and accessible labels, not color alone. Test long subjects, unusual sender names, many replies, attachments and enlarged fonts. Respect reduced motion.

Deliverable: clickable prototype with realistic navigation and editable sample content. Exit condition: visual review on the actual GNOME desktop confirms the appearance, spacing and main flows.

## 5. Phase C — local foundations and privacy boundaries

Implement local accounts, settings, messages, folders/labels, drafts, categories and operation queues. Separate synchronized provider data from local-only preferences and annotations. Add database migrations and recovery procedures early.

Use keyring storage for credentials and tokens. Never include credentials or message content in exported settings or routine diagnostics. The local mail cache itself is a sensitive data store; keyring protection for tokens does not automatically encrypt that cache. Document its protection and cleanup behavior accurately.

Enforce these AI rules in backend services, not only buttons:

- Work account content is never sent to cloud AI: sender, subject, body, attachments, snippets, search results, summaries and other derived data are covered.
- Personal-account automatic cloud relevance analysis may receive sender and subject only. No body previews, attachment names or conversation excerpts are silently added.
- Personal message bodies are provided only for an explicitly requested action, with clear scope.
- Cloud search must not send work results to the model. A natural-language query can be translated into local filters without returning matching work content to the cloud; reject or redact queries containing excluded work content.
- Plugins, diagnostics and combined multi-account requests must respect the same exclusions.

Deliverable: persistent local application using synthetic data, with demonstrably enforced access boundaries.

## 6. Phase D — real mail synchronization and reading

Connect one personal account first, then the second provider, then work IMAP. Begin with limited recent history; choose a configurable cache period during implementation and fetch older mail on demand. Never truncate a thread without indicating more messages exist.

Implement incremental synchronization, reconnect/backoff, token renewal, folder changes and stable message identity. Microsoft Graph offers message delta synchronization and immutable IDs that can help preserve references when messages move: [delta queries](https://learn.microsoft.com/en-us/graph/delta-query-messages), [immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).

Keep cross-account messages separate even when their subjects match. Model Gmail labels without duplicating underlying messages. Map archive, trash and spam behavior deliberately for each provider. Queue offline mutations with visible status and reconcile conflicts.

Build safe HTML and plain-text rendering, attachment previews, local search, simple contact autocomplete and trusted-sender remote-image settings. Treat trusted sender status as a user preference, not proof that a message is authentic. Respect provider spam decisions; Block and Not spam must accurately reflect the action supported by that account.

Deliverable: usable multi-account reader and organizer. Exit condition: restart, offline/reconnect, moves and provider-side changes produce no unexplained missing or duplicated messages.

## 7. Phase E — composing and reliable sending

Add separate compose windows, autosaved drafts, reply/reply-all/forward, attachment handling, rich text plus plain-text alternatives, snippets, templates, signatures and authorized aliases.

Make the sender account, recipients and attachment state clear. Add attachment reminders, unusual-recipient warnings and an undo interval implemented as a local delay before submission. Persist pending sends so restarting does not silently lose them.

Scheduled sends run only while the application can send. Missed times go to Overdue for user review; they do not send automatically later. Treat sleep, network loss, authentication failures, time-zone changes and daylight-saving transitions explicitly.

If a provider may have accepted a message but confirmation is lost, mark the outcome uncertain and reconcile against sent mail where possible. Do not blindly retry and risk duplicate delivery.

Deliverable: dependable send/draft workflow. Exit condition: controlled test-account exercises verify correct From identities, attachments, draft recovery, delayed-send cancellation and uncertain-send handling.

## 8. Phase F — organization, relevance and notifications

Add manual Needs reply, Waiting and Reference states; star, snooze and reminders; suggestions that can be accepted or dismissed. Do not silently complete tasks or clear follow-up states.

Implement a visual rule builder with conditions, actions, precedence, a preview against selected messages, and loop prevention. Potentially destructive bulk actions must be reviewable.

Use provider importance and local rules before cloud AI. Keep uncertain items in Other with Needs review. Maintain explicit user overrides and an explanation of relevant classification signals. Spam and relevance remain separate decisions.

Notify selectively for important people and direct conversations; suppress bulk notifications. Handle duplicated events during reconnect and expose quiet hours as a setting. Honor the selected sender/subject lock-screen display within GNOME's permissions.

Deliverable: useful organization and notifications without any requirement to enable AI.

## 9. Phase G — Google Calendar and Nextcloud

Calendar: implement day/week/month views, calendar selection, event creation/editing, invitation handling, all-day events, time zones and recurrence. Distinguish editing one occurrence from a series. Show attendee-notification effects before consequential changes. Make synchronization conflicts and unsupported cases visible. Google's event model explicitly distinguishes recurring instances: [Calendar events reference](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Nextcloud: implement folder selection, attachment upload with progress/retry, filename-conflict handling and insertion of verified sharing links. Review link access, expiry and password settings before creating externally accessible shares. Uploading a file alone must not automatically publish it. Use [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html) for files and its [sharing API](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/OCS/ocs-share-api.html) for links.

Deliverable: working calendar and storage integrations with credentials protected and failures recoverable.

## 10. Phase H — optional AI with measured usage

Validate current eligibility and limitations for the personal local-app ChatGPT sign-in route before implementation. Do not assume it inherits ChatGPT memories or chat history. Plan usage shares an existing allowance, and app limits are caps rather than additional quota: [ChatGPT sign-in and usage controls](https://learn.chatgpt.com/docs/sign-in-with-chatgpt).

Start with manually invoked summaries, reply assistance and natural-language search for eligible data. Enforce permission checks before building prompts. Treat email content as untrusted text, never as authorization to send or export mail.

Run a small explicitly started usage trial, initially with synthetic data. Compare account usage before/after while minimizing other activity; record request count, model and context size. Do not infer subscription percentages from ordinary API prices or promise exact per-request accounting when unavailable.

Choose daily limits and a supported app allowance cap after measurement. Disable automatic credit fallback unless deliberately enabled. Stop automatic analysis at the cap; preserve manual mail functions. Reuse unchanged classifications and cached results. Build only against fields supported by the integration's current [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Deliverable: optional AI that demonstrably obeys content restrictions and pauses predictably. No target number of emails per Plus allowance is promised in advance.

## 11. Phase I — themes, commands and plugins

Expose custom theme tokens, editable shortcuts, contrast/text controls, settings export and named commands. Start with restricted declarative themes rather than executable theme code.

Provide plugin permissions for specific accounts, mail operations, network destinations and AI use; approve on enable and revoke in settings. Enforce permissions outside plugin code. Unrestricted native or same-process plugins must not be described as safely sandboxed. Prove the isolation model before enabling third-party executable plugins; bundled integrations can ship first while this is completed.

Deliverable: documented extension format, example extension, and tested revocation. Work-mail exclusion remains mandatory for all plugins.

## 12. Phase J — reliability, packaging and release

Test on actual CachyOS/GNOME hardware: light/dark changes, opaque fallback, scaling, long sessions, suspend/resume, reboot/autostart, keyring locking, intermittent connectivity, expired logins and large inboxes.

Focus automated checks on meaningful risks: synchronization, identity selection, send queues, message rendering isolation, AI exclusions, plugin permissions, and calendar recurrence/time zones. Use visual and interaction checks for layouts rather than writing tests that merely restate CSS.

Choose and verify an installable Linux package for the target machine. Provide uninstall instructions, migration recovery, release notes and a documented update process. Keep the existing mail clients available during a staged personal pilot.

Release first to one personal account, then all personal accounts, then work mail after its exclusion tests pass. A first dependable core release can precede optional AI and third-party plugins; those remain tracked commitments, not silently removed features.

## 13. Completion criteria

- The agreed visual design works in both themes on CachyOS, including its fallback appearance.
- All three account types read, synchronize, organize and send accurately.
- Drafts and queued actions survive restart; uncertain and overdue sends stay visible.
- Calendar and Nextcloud changes have clear, verifiable outcomes.
- Work mail cannot enter any cloud AI path; eligible personal data follows the selected permissions.
- Ordinary mail functions remain available without AI or when usage is exhausted.
- Credentials are absent from logs and exported settings; rendered mail cannot invoke privileged app functions.
- Background operation, autostart, notification selection and explicit Quit work without a required tray extension.
- Agreed advanced settings and extension features have a clear implemented status and documented limits.

## 14. Inputs needed at the relevant stage

No further long design questionnaire is needed. Before native validation: GNOME version, Wayland/X11 session and display scaling. Before account setup: Outlook account type, work IMAP/SMTP authentication requirements, and Nextcloud URL. Before OAuth integrations: user-owned provider registrations where required, completed through secure sign-in flows rather than pasted credentials. Before AI activation: confirmation of current account eligibility and agreement on the measured usage cap.

Estimate implementation effort after the Linux shell and provider-authentication proofs. Those results determine whether the current architecture is sound; a polished preview alone is not evidence of a dependable mail client.
