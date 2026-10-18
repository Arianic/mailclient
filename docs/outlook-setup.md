# Connect a personal Outlook account

The desktop app opens your connected Outlook inbox directly. Important/Other follows Outlook Focused Inbox classification, and Load older messages fetches more history in pages instead of stopping at 25. You can compose, reply, Reply all and Forward in separate native windows; search all indexed folders; organize individual messages or selections; load images per message; and save attachments through a native dialog. Initial sign-in remains read-only; sending requires the separate permission step below. No AI service is connected.

## 1. Register your Microsoft app

You can do this in a browser on either computer. Microsoft requires access to an Entra directory where you can register apps; having a personal Outlook mailbox alone does not satisfy those developer prerequisites. If the portal requests a directory/subscription you don't have, report that screen before proceeding with account or billing setup. See [Microsoft's registration prerequisites](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/). Go to **Entra ID → App registrations → New registration**. Some layouts place it under **Identity → Applications**.
2. Name the app **Personal Mail** (or another name you will recognize at consent). Choose **Personal Microsoft accounts only** / **Personal accounts only**, then register.
3. From Overview, copy **Application (client) ID**. This is a public identifier, not a password; enter it in Mail. Do not create a client secret.
4. Under **Authentication → Add a platform → Mobile and desktop applications**, add this exact custom redirect URI and save:

   ```text
   http://localhost/oauth/callback
   ```

   Use the desktop platform rather than Web or Single-page application. Leave implicit token flows off. Mail adds a random local port at runtime; Microsoft ignores the port for localhost matching, while the path must match. See [platform setup](https://learn.microsoft.com/en-us/graph/auth-register-app-v2) and [localhost matching](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions).
5. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add **User.Read** and **Mail.Read**. User.Read may already be present. Add **Mail.Send** for sending and **Mail.ReadWrite** for mail actions, read-status sync and larger attachment uploads. Use delegated permissions for your personal account, with no client secret.

Mail also requests `offline_access` during sign-in so it can renew access after restarting. [Microsoft explains this scope](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#the-offline_access-scope). Mail.Read grants mailbox read access. Before a folder finishes indexing, Mail loads live headers in pages. Once indexed, local pages provide consistent filtering and offline access. Search has its own whole-mailbox index, independent of the currently loaded list; see [the search guide](search.md).

## 2. Update and connect on CachyOS

Quit Mail through **Settings → Quit Mail**, stop the development command with Ctrl+C, and run from the cloned `mailclient` folder:

```sh
git pull --ff-only
npm ci
npm run desktop:dev
```

The first build downloads additional Rust libraries. GNOME Keyring must be installed and your login collection unlocked. If missing, install `gnome-keyring` with CachyOS's package manager and sign out/back into GNOME. Run Mail as your normal user. There is no plaintext token-file fallback.

1. Open **Settings → Personal Outlook**, enter the Application (client) ID, and choose **Connect Outlook**.
2. Your normal browser opens Microsoft. Check the app name and read/stay-signed-in permissions, then sign in to your personal account there. Passwords and MFA stay with Microsoft.
3. Return to Mail when prompted. Your connected inbox opens automatically. The sidebar lists real Outlook folders, including Sent Items, Archive, Junk, Deleted Items and your own folders using their provider names. Expand an arrow to load subfolders. **Local drafts** contains drafts written in this client; Outlook's own Drafts folder is a separate read-only message view. Sample mail is restricted to browser development previews.

The local sign-in listener waits three minutes; **Cancel sign-in** stops waiting. Do not include sign-in URLs, codes, tokens or message contents in bug reports.

## 3. Enable sending once

Your existing read-only sign-in continues to work. To send, open **Settings → Personal Outlook → Enable sending**. Select the same personal account and approve Microsoft's additional **Mail.Send** permission. If needed, first add Mail.Send under Microsoft Graph delegated API permissions in your app registration. No new secret or return URI is needed. Microsoft's [sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail) and [reply](https://learn.microsoft.com/en-us/graph/api/message-reply) APIs support this delegated permission.

Use Compose or Reply. The From address is your connected account; To, Cc and Bcc use editable recipient chips, paste/keyboard entry, inline validation and local autocomplete from indexed mail addresses. Drafts autosave in a separate local mail database and reopen from the sidebar. If a compose window was already open before enabling sending, close/reopen that saved draft to refresh its permission state.

Send waits five seconds with **Undo Send**. Closing a compose window during that delay cancels submission and saves the draft. Once submission starts, wait for its result. A successful response is reported as **Submitted to Outlook**, not confirmed delivery. If the response is lost, the draft is marked uncertain and cannot be resent automatically; check Outlook Sent Items before composing another copy. A process interruption during submission recovers as uncertain on restart.

The compose fields use an inline focus treatment. Discard asks for confirmation and removes a saved local draft; Done closes a submitted draft. Reply all excludes your own primary address and duplicates and preserves other Cc recipients. Forward copies supported non-inline original files into the new local draft; if files cannot be copied, a visible notice asks you to attach them manually. **Cc** and **Bcc** are hidden until requested unless the draft already contains those recipients. Both fields remain separate in the outgoing message, even if the same address appears in To and Cc. A recipient address listed twice normally receives one copy; the reader now shows To and Cc so you can check the headers.

**Attach** opens a native file picker; dropping files into the native compose window also copies them into the draft. Files are copied into the local draft database and survive closing/reopening the draft, even if the source file later changes or disappears. Remove a file with its × button. The app allows up to **20 MB total and 20 files**, for both new messages and replies. Above 2 MB total, Mail uses a prepared Outlook draft and attachment uploads; this additionally requires Mail.ReadWrite. Upload progress appears in the composer, and provider sending limits still apply. Interrupted preparation returns to a saved draft; uncertain actual submissions are held for review. A persisted server draft reference prevents silently submitting a second copy on retry. See [Microsoft's upload flow](https://learn.microsoft.com/en-us/graph/outlook-large-attachments). Attachments stay local until Send. Text changes cannot overwrite attachments, and attachments cannot change once submission starts.

This version sends plain text. Rich text, scheduled sending and learned unusual-recipient warnings remain pending. Empty subjects and attachment mentions with no files attached prompt a warning before submission.

### Enable mail actions and read-status sync

Choose **Settings → Personal Outlook → Enable mail actions & read sync**, select the same account and approve **Mail.ReadWrite**. Add that delegated permission to your existing app registration first if Microsoft requires it. Existing Mail.Send access is preserved; no disconnection, new application ID or redirect URI is needed.

Microsoft labels this permission as read/write mail access. The client uses it for read/unread changes, archive, moving to Deleted Items, folder moves, moving into/out of Junk and preparing larger attachment sends. These actions support individual messages and selections of up to 100. Delete moves to Deleted Items; there is no permanent-delete action. Undo lasts ten minutes within the current app session and checks that server state has not changed externally. Junk controls move mail; they do not train spam filtering or block a sender. [Microsoft requires Mail.ReadWrite to update isRead](https://learn.microsoft.com/en-us/graph/api/message-update). After consent, unread messages are marked read after a successful body load. Failed body loads remain unread. Failed status updates leave the local row unread and show an error; refresh/reopen to retry. Without the permission, messages still open with a visible explanation that read status cannot sync.

## 4. Images, downloads and reading

Remote images remain blocked initially. **Load images** grants permission for that message only; remote image requests can reveal your IP and that the message was opened. Inline CID images are also supported. Loaded images appear only in the email body, with no duplicate image-download strip. **Attachments** excludes inline resources such as logos and signatures; separate files, including intentionally attached photos, remain downloadable. Clicking a filename opens the native save dialog.

The broker accepts HTTPS/public IPv4 image hosts only, pins DNS results, sends no mail tokens/cookies/referrer, follows no redirects and re-encodes supported raster formats. IPv6-only hosts, private addresses, HTTP sources, redirects, unsupported formats and oversized images remain blocked. Up to 24 sources are attempted; downloaded images are limited to 3 MB encoded and 4096 pixels per side, with a smaller re-encoded display limit and total budget. File attachment downloads support up to 20 MB, with paginated file metadata. Some senders' images may therefore remain unavailable. Links in email content remain inactive. The email frame still has no scripts, same-origin permission or privileged app bridge; it grows with available reading width and height.

## 5. Check on the laptop

- Relaunch: the real inbox should open directly, with no placeholder mailboxes.
- Switch Important/Other; use Load older messages, then open/back and check scroll position.
- Resize the main window and check the reading surface grows in both directions.
- Load images deliberately: they should appear only inside the email, with no duplicate download buttons. Download a separate attachment to a location you choose; inline logos should not appear in that list.
- Compose a test to yourself, close/reopen its saved draft, then test Undo Send. When ready, send one test and verify Sent Items/receipt yourself.
- Attach a small file, close/reopen its draft, remove/re-add it, and verify the received attachment contents after a deliberate test send.
- Enable mail actions & read sync, open an unread message, go back and verify its dot clears; confirm the same state in Outlook web.
- Open Sent Items, Junk and a custom subfolder; Inbox alone should have the Important/Other switch.
- Reopen after a restart to verify sign-in renewal and local draft persistence.

Indexed headers, bodies, folders, attachment names and derived contact suggestions now persist in a separate `outlook-mail.sqlite` for local search and offline reading. Initial whole-history indexing takes time and shows progress; Settings offers pause/resume and clear-and-pause controls. Images and binary downloads are not included in this cache. See [search coverage and privacy](search.md). Local real drafts, their attachment copies and send-state records persist in `outlook-drafts.sqlite`, separate from the prototype key-value store. Schema version 3 migrates existing local drafts in place and records prepared upload drafts. This database is not encrypted at rest; the application data directory is owner-only on Linux. Credentials remain only in GNOME Keyring. Neither mail nor credentials enter settings exports. Incremental sync runs while the process is running, including with the main window hidden; OS autostart and desktop notifications are still pending.

Disconnect clears the app session and Keyring credentials after compose windows are closed. Local drafts and indexed mail remain on this device and are restricted to the matching account. Clear cached mail in Settings before disconnecting if you want to remove the derived search/offline cache; local drafts have their own Discard action. Disconnect does not revoke Microsoft's consent or sign out your browser; remove the app grant separately in your Microsoft account if desired.

If **AADSTS50011** appears, check the return URI path and desktop platform; do not register a particular random port. A **client secret required** error usually means the return address was configured as Web. For a locked keyring, unlock the GNOME login collection and choose **Check again**. For permission denial, check delegated Mail.Read and reconnect. Offline/rate-limit errors offer a manual retry.

## Implementation and validation

Authorization uses the personal-account `/consumers` authority, S256 PKCE and a random state, with a temporary IPv4-loopback listener checking Host, path and query parameters. Tokens stay in Rust and Secret Service/GNOME Keyring. Account, inbox and media commands are restricted to the local main window. Dedicated compose windows can only read account status and edit/submit their own draft; they cannot browse mail, load arbitrary URLs or access other drafts. The opener has no frontend permissions and its automatic link handler is disabled. Microsoft HTTP requests enforce HTTPS, disable redirects, use timeouts and cap Graph responses. There is no arbitrary-URL fetch command or connected AI route.

Automated checks cover the real local callback listener, cancellation, incorrect callback parameters, redacted errors, token-free public status, simulated secure-vault failures/refresh rotation, unknown message IDs and frontend body isolation/late responses. They use synthetic data and a test credential vault. The user confirmed initial Microsoft sign-in on CachyOS. Search/index delta sync, actions/Undo, Reply all/Forward, larger sending, paging and native file-dialog/drop round trips still need laptop checks; development tests never send real mail.

Deferred: editing Outlook-created drafts, rich text, signatures/templates, scheduled delivery, push notifications/autostart, retention-size controls and other providers. Indexed conversation history is implemented; initial indexing determines how much history is available. Work IMAP is not connected.
