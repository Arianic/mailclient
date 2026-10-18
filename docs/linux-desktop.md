# Linux desktop development

The UI is developed on Windows. Native Linux checks run in Kali WSL2; the final GNOME/WhiteSur checks run on CachyOS after pulling from Git. Native application data is separate from the browser preview's sample data.

## CachyOS setup

Install Node.js 22.12 or newer (24 LTS recommended), npm, a current stable Rust/Cargo toolchain, a C/C++ toolchain, pkg-config, GTK3/WebKitGTK 4.1 development files, OpenSSL and librsvg. For CachyOS/Arch, the usual package names are:

```sh
sudo pacman -S --needed base-devel pkgconf rust nodejs npm webkit2gtk-4.1 openssl librsvg
git clone https://github.com/Arianic/mailclient.git
cd mailclient
npm ci
npm run test
npm run desktop:dev
```

The setup command belongs on the laptop; it has not been run there. Review package availability for your installed snapshot. No accounts need to be connected to test the shell.

If already cloned, enter that existing folder instead of cloning again. Run all `npm` commands in the folder containing `package.json`. For personal Outlook sign-in, follow [the Outlook setup guide](outlook-setup.md); GNOME Keyring must be available in your desktop session.

Connected-client update: native Mail opens your Outlook inbox directly and hides sample mailboxes. Use Settings → Personal Outlook → Enable sending to approve the additional Mail.Send permission once, then use Compose/Reply and local Drafts. Load older messages continues past the first page; Important/Other follows Outlook classification. Load images is per message and opens no remote content directly in the email frame. Images/attachments save through native dialogs. See the Outlook guide for limits and laptop checks. Old sample drafts remain separate and are not migrated into real mail.

To compile the local desktop executable:

```sh
npm run desktop:build
```

Installable packages and application-menu installation are not part of this milestone. The executable is normally `src-tauri/target/release/mail-desktop`. Starting another instance should reopen the main window. Closing the main window hides it; use Settings → Quit Mail to terminate the process. Close compose windows first so their pending drafts can finish saving; Quit will explain this if any are still open.

## WSL2 checks from Windows

Linux build prerequisites are installed in the existing `kali-linux` distribution. The initial proof uses the source from the Windows workspace and a Linux-local Cargo target directory, keeping large build artifacts off the shared filesystem. The frontend is built on Windows first. For the current workspace:

```powershell
npm.cmd run test
npm.cmd run build
wsl -d kali-linux -- sh -lc 'CARGO_TARGET_DIR=/tmp/personal-mail-target cargo test --locked --features custom-protocol --manifest-path /mnt/c/Users/fipse/Documents/Codex/2026-10-17/would-there-be-x20/src-tauri/Cargo.toml'
wsl -d kali-linux -- sh -lc 'CARGO_TARGET_DIR=/tmp/personal-mail-target cargo build --locked --features custom-protocol --manifest-path /mnt/c/Users/fipse/Documents/Codex/2026-10-17/would-there-be-x20/src-tauri/Cargo.toml'
```

Run the resulting binary in a user session with a session D-Bus. WSLg provides a GUI surface but does not reproduce a full GNOME session. Do not infer desktop compatibility from successful compilation or a WSLg launch alone.

## Check on the laptop

- Left close/minimize/maximize controls and dragging the header.
- Main window fills its native frame and remembers size where supported.
- Separate compose window, saved sample drafts, and reopening an existing draft.
- Close main window, relaunch executable, confirm it reappears; then explicitly quit.
- System light/dark changes, both manual overrides, font scaling, keyboard focus.
- Gmail yellow, Outlook blue, work IMAP green throughout navigation and message views.
- Open the Studio North sample email: formatted content loads, remote image is replaced, Original appearance and Plain text work.
- Verify unreadable/cut-off email content can be read by scrolling inside the protected message view. Automatic frame sizing and trusted-sender image loading are future work.

GNOME Keyring and an initial personal Outlook reader are implemented; actual sign-in/keyring checks need your Microsoft registration and laptop session. Autostart, notification delivery, real blur and other mailbox integrations remain pending. The current shell uses the opaque fallback; it does not enable compositor effects or change GNOME settings.

## Local storage and privacy foundations

The native shell uses `workspace.sqlite` in its OS app-data directory. On Linux the application directory is restricted to its owner. SQLite uses a versioned schema, WAL and full synchronization. Preferences, sample mail state and sample calendar data are persisted; each draft is a separate record so simultaneous compose windows do not overwrite unrelated drafts. Windows receive revisioned updates, ignore stale events and show persistent save failures. Closing a compose window flushes its draft first.

The browser preview still uses localStorage and does not share its sample data with the native app. No credentials are stored in SQLite. The database is not encrypted at rest. Outlook refresh credentials are kept separately in Secret Service/GNOME Keyring; its access token and fetched messages stay in memory. An offline real-mail cache/schema is still pending.

Real drafts and send states now use a separate `outlook-drafts.sqlite` in the owner-only app data directory. Drafts are not encrypted at rest. Credential storage remains separate. A send is durably marked before its sole network attempt; interrupted submissions recover as uncertain instead of being replayed. Compose windows must finish saving before closing and cannot close during submission. Disconnect/quit require closing those windows first.

The Rust privacy module prepares future cloud payloads: automatic personal relevance input excludes message bodies; manual summary/reply requires an explicit body request; work accounts and personal messages marked as containing derived work material are rejected. No cloud dispatcher exists yet. Future adapters must resolve account identity/provenance from trusted backend records and use this boundary; these tests do not claim that real provider or AI integrations have already been completed.

## Email isolation

HTML is sanitized with DOMPurify and a presentation-only allowlist, then placed in an iframe with an empty `sandbox` attribute, no same-origin permission and no script permission. A policy inside the frame blocks scripts, connections, external frames, forms and remote images. Navigation targets, inline event handlers, app drag markers and unsafe CSS are removed. Safe raster data images are allowed; SVG and arbitrary embedded documents are not.

Original appearance changes safe colors only; it never grants scripts, external images, navigation or application commands. The shell does not grant remote origins capabilities. Do not add `allow-scripts`, `allow-same-origin`, wildcard remote origins, shell execution or filesystem access to make email features work. Trusted-sender images and CID attachments require a separate resource broker before real mail is supported.

The renderer tests cover known adversarial examples. They are one part of validation, not a claim that the entire future mail client is security-audited.
