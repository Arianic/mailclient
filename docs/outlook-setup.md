# Connect a personal Outlook account

This first connection reads your latest 25 Inbox messages and opens individual messages on demand. It cannot send, archive, delete or mark messages as read. Sign-in uses your normal browser and GNOME Keyring. Real messages stay in memory, separately from the sample inbox, outside the prototype database and settings exports. No AI service is connected.

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
5. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add **User.Read** and **Mail.Read**. User.Read may already be present. This version does not need application/daemon permissions, Mail.Send or Mail.ReadWrite.

Mail also requests `offline_access` during sign-in so it can renew access after restarting. [Microsoft explains this scope](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#the-offline_access-scope). Mail.Read grants mailbox read access; the 25-message limit is this app's initial reader limit, not a restriction on Microsoft's permission.

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
3. Return to Mail when prompted. Once your address appears, choose **Open inbox**. The top-bar Mail button subsequently opens your connected reader. **Sample inbox** returns to demo data.

The local sign-in listener waits three minutes; **Cancel sign-in** stops waiting. Do not include sign-in URLs, codes, tokens or message contents in bug reports.

## 3. Check the connection

- Verify the connected address, fetch recent mail, and open a message in both themes. Remote images and links remain inactive; attachment downloads are pending.
- Go back, try sender/subject search and Refresh. A note identifies when more than 25 messages exist. Older pages and full conversation expansion are pending.
- Compare read status in Outlook before/after opening a message here: it should remain unchanged.
- Quit/reopen and fetch again. Keyring should retain sign-in; messages require a fresh fetch because offline mail storage is pending.
- **Disconnect** removes the app's saved sign-in and clears its session. It does not sign out your browser or revoke Microsoft's existing consent. Remove the app's grant separately in your Microsoft account's app-permission controls if desired.

If **AADSTS50011** appears, check the return URI path and desktop platform; do not register a particular random port. A **client secret required** error usually means the return address was configured as Web. For a locked keyring, unlock the GNOME login collection and choose **Check again**. For permission denial, check delegated Mail.Read and reconnect. Offline/rate-limit errors offer a manual retry.

## Implementation and validation

Authorization uses the personal-account `/consumers` authority, S256 PKCE and a random state, with a temporary IPv4-loopback listener checking Host, path and query parameters. Tokens stay in Rust and Secret Service/GNOME Keyring. Outlook commands are restricted to the local main window. The opener has no frontend permissions and its automatic link handler is disabled. Microsoft HTTP requests enforce HTTPS, disable redirects, use timeouts and cap Graph responses. There is no arbitrary-URL fetch command or connected AI route.

Automated checks cover the real local callback listener, cancellation, incorrect callback parameters, redacted errors, token-free public status, simulated secure-vault failures/refresh rotation, unknown message IDs and frontend body isolation/late responses. They use synthetic data and a test credential vault. Real Microsoft consent, actual Keyring access and the live mailbox round trip still need your registration and CachyOS session.

Deferred: offline real-mail cache, background/incremental sync, paging, full threads, folders/mutations, attachments, sending and other providers. Work IMAP is not connected.
