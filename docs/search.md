# Search all mail

The top search field searches the connected personal Outlook mailbox across discovered folders, independently of the folder or Important/Other view you were browsing. It searches sender names/addresses, To/Cc/Bcc recipients, subjects, visible body text and attachment filenames. Sent Items, Archive, Junk, Deleted Items, server Drafts and discovered custom subfolders are included. Client Local drafts are separate. Gmail and work IMAP are not connected yet.

## Everyday searches

- `invoice` matches words beginning with invoice; matches in subjects and senders receive more weight than body matches.
- `"booking reference"` matches a token phrase. Searches ignore common Latin accents and letter case; punctuation follows the local full-text tokenizer.
- `from:alex invoice has:attachment` combines filters.
- `(invoice OR receipt) -folder:junk` combines alternatives and exclusions.
- `person:alex@example.com after:2026-09-01 before:2026-10-01` searches that person in sender and recipient fields over September.
- `filename:receipt.pdf` searches attachment names, not text inside files.
- `emails from alex about invoice last month` translates common phrases into explicit filters. The interpreted query is displayed so you can inspect or edit it. This is deterministic interpretation, not a general AI understanding claim.

Words combine with AND by default. Use uppercase `AND`, `OR`, `NOT`, parentheses, or a leading minus. Quotes preserve phrases. Use the Filters panel if you prefer fields and date pickers. Best match, Newest and Oldest sorting are available. Results show body snippets and folder names; Load more results continues beyond the first page. There is no 1,000-message search-result cap. Single-word searches with no results can offer local spelling suggestions; they never silently replace your query.

Supported fields: `from:`, `to:`, `cc:`, `bcc:`, `person:`, `subject:`, `body:`, `filename:`, `folder:` (alias `in:`), `after:`, `before:`, `on:`, `is:unread`, `is:read`, `is:important`, `is:other`, `has:attachment`. `me` in a people field resolves to the connected account address. Folder filters match folder-name text, not an entire subtree or full path; duplicate names can match several folders. Dates use local calendar days in YYYY-MM-DD form; after is inclusive and before exclusive. Unknown fields and malformed dates/operators show an error rather than silently ignoring the filter. To search literal text containing a colon, use a supported field with a quoted value, e.g. `body:"https://example.com"`.

Common English date phrases include today, yesterday, last week (the previous Monday-Sunday), last month (the previous calendar month), this month, last year, this year and last N days. Quote a phrase such as `"last month"` to search those literal words instead. No semantic embeddings, attachment-content extraction, OCR or cloud AI are connected.

## Coverage, refresh and offline copies

The first launch builds a local index in the background. Search returns indexed mail immediately and shows its coverage. Older mail and attachment names can still be pending, so an early empty search is not evidence the mailbox contains no match. Large mailboxes can take time; checkpoints survive restarts. Indexing continues while the app runs, including when its main window is hidden. Closing/quitting the process or losing connectivity stops progress until it can resume.

The initial scan uses ordinary folder-message listing and follows every next-page URL, including empty intermediate pages, without a total-result limit. Page size is requested through the Prefer header. A separate delta baseline establishes change tracking after the full listing; later change pages do not discard older indexed history. Folder message changes use Microsoft's per-folder delta checkpoints. Visible lists also refresh periodically and after reconnect/focus; Refresh requests synchronization. Folder discovery is repeated periodically. No desktop push notifications or OS autostart are implemented yet. See [Microsoft's delta guidance](https://learn.microsoft.com/en-us/graph/delta-query-messages).

Saved message bodies can be opened offline, with an offline indicator. Images and attachment bytes are not cached by the search index; loading/downloading these still requires connectivity. Contact suggestions come from locally indexed mail addresses, not a synchronized contacts service. Conversation history uses messages already indexed, with a notice while more history is pending.

Settings → Personal Outlook → Mailbox search & offline copies provides Pause, Resume, Rescan entire mailbox and Clear cached mail. Rescan restarts every folder without deleting existing copies, drafts or credentials. The version-two index upgrade automatically schedules a full scan of older indexes and preserves an intentional pause. The status compares per-folder cached messages with Outlook’s reported item counts and flags incomplete coverage rather than claiming completion. Those provider counts can include non-email items, so the two numbers are not guaranteed to match exactly. Errors take precedence over completion text, and pending delta pages are counted as unfinished. Clearing removes this account's derived message index, filename metadata and contact suggestions and pauses indexing. It does not delete server mail, drafts or credentials. This first implementation indexes all discovered history rather than providing an age/size retention slider.

The cache is `outlook-mail.sqlite` in the app-data directory. It contains private mail and is **not encrypted at rest**; the Linux application directory is owner-only. Use operating-system disk protection as appropriate. Cache clearing is an application-level deletion, not a forensic secure erase. Credentials remain in GNOME Keyring, and neither mail cache nor credentials enter settings exports. Search sends nothing to ChatGPT or another AI service and consumes no Plus allowance.

## Current limits

Only the single connected personal Outlook account is supported. Folder listing has a 1,000-folders-per-level safety limit; Graph responses have an 8 MB limit and timeouts. An oversized response or provider error is shown as incomplete sync rather than complete coverage. File-name indexing follows body indexing and may take longer. Provider throttling/connectivity affect initial indexing. Attachment contents, online archive mailboxes, recoverable-items stores and Outlook-created draft editing are outside this version.

Development fixture results are synthetic; real mailbox synchronization, moves/Undo, native file dropping and larger-file delivery still need a CachyOS check with the user's account. Automated tests never send real email.
