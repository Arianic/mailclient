# Mail project

Target CachyOS/GNOME; development happens on Windows 11 with WSL2. The laptop pulls source through Git for native testing. No Windows product release is currently requested.

Read `outputs/mail-client-action-plan.md` for the agreed requirements. Native Mail opens the connected Outlook inbox directly; sample mail is browser-only development material. It has Important/Other classification, older-page loading, local real drafts, optional Mail.Send consent, native compose/reply and brokered image/file downloads. The user confirmed initial Microsoft sign-in on CachyOS; new sending/download round trips still need laptop checks. Read `docs/outlook-setup.md`. Preserve truthful send outcomes: 202 means submitted, interrupted/uncertain sends must never be replayed automatically. Real mail/drafts must stay out of the prototype key-value store and settings exports; credentials stay in GNOME Keyring. Real drafts use a separate local SQLite store.

Visual commitments: soft WhiteSur-inspired appearance, left window controls, system font, light/dark/system appearance, blue accent, translucent chrome with opaque fallback, compact rows in spacious framing, hidden sidebar, single-view inbox/conversations, separate compose windows, full calendar via a small top-bar switch. Prefer quiet desktop-app surfaces over promotional headings or decorative content.

Work mail and any derived work content must never be sent to cloud AI, including through search, plugins or diagnostics. Automatic cloud AI for eligible personal mail is limited to sender and subject. Message bodies require a deliberate user action. AI remains optional; usage limits follow measurement.

Use `npm run build` to check types and production output. Verify meaningful interactions and both themes in the browser. Native GNOME behavior is not verified by a Windows browser preview.
