# Mail project

Target CachyOS/GNOME; development happens on Windows 11 with WSL2. The laptop pulls source through Git for native testing. No Windows product release is currently requested.

Read `outputs/mail-client-action-plan.md` for the agreed requirements. Current milestone is a synthetic-data visual prototype, not a functioning mail service. Keep disconnected capabilities explicit, avoid implying messages were sent, and never connect actual accounts without a secure user-driven sign-in flow.

Visual commitments: soft WhiteSur-inspired appearance, left window controls, system font, light/dark/system appearance, blue accent, translucent chrome with opaque fallback, compact rows in spacious framing, hidden sidebar, single-view inbox/conversations, separate compose windows, full calendar via a small top-bar switch. Prefer quiet desktop-app surfaces over promotional headings or decorative content.

Work mail and any derived work content must never be sent to cloud AI, including through search, plugins or diagnostics. Automatic cloud AI for eligible personal mail is limited to sender and subject. Message bodies require a deliberate user action. AI remains optional; usage limits follow measurement.

Use `npm run build` to check types and production output. Verify meaningful interactions and both themes in the browser. Native GNOME behavior is not verified by a Windows browser preview.
