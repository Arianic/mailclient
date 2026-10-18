# UX review — 18 October 2026

Review of the current connected Outlook client and light/dark development fixture. The six priorities below were authorized for implementation. The current checkpoint records what is implemented; the original findings remain as historical context. No cloud/AI access was added.

## Current implementation checkpoint

- Quieter reader: compact header, expandable recipients/appearance, relevant image controls and no duplicate inline-image downloads.
- Archive, move to Deleted Items, folder move, Junk/out of Junk and read/unread, individual/bulk up to 100, with guarded ten-minute session Undo and partial-failure feedback. Junk is a move, not spam-training.
- Session folder/search snapshots preserve loaded pages, filters, selection and scroll; expanded folders persist and previous/next navigation is available.
- Incremental local Outlook index, offline bodies, periodic/reconnect refresh and whole-mailbox search. Ranked snippets, phrases, Boolean operators, people/date/folder/read/attachment filters, deterministic common English phrases, typo suggestions, pagination and coverage. See [search guide](../docs/search.md). Indexing is all-history in this version; configurable cache retention remains pending.
- Indexed conversation history expanded with separators; Reply all, Forward with quoted text and supported original files, Sent rows show recipients.
- Recipient chips, validation, local contact autocomplete, draft discard, native file drop/picker, up to 20 MB/20 files with upload progress and Done after submission. Rich text, signatures, templates, provider draft editing and schedules remain pending.

No real-mail mutations or sends are performed by automated tests. New native provider interactions and GNOME drop/scaling behavior still require laptop validation. Cache and draft databases are separate from prototype state and settings exports, but not encrypted at rest; credentials remain in Keyring.

## Previous inline-images update

Loaded email images stay inside the body. The duplicate image-download strip is removed. The Attachments list excludes provider-marked inline resources such as logos/signatures, while separate files and deliberately attached photographs remain downloadable. No mail-renderer security policy or image-loading permission changed. One interaction regression test covers body rendering, filtering and genuine attachment downloads. All 34 frontend tests and the production build pass; browser checks cover both themes. Rust code is unchanged.

## Original findings and priority order (historical)

1. **Make reading quieter.** Too much vertical space precedes the actual message: image controls, permanent privacy text, status text, attachment instructions and protected-view controls. Keep the subject/sender/date compact; put full recipients, Plain text and Original appearance under a More/details control. Show Load images only when relevant and collapse its explanation after loading. Retain meaningful privacy choices and errors without repeating routine implementation details. Keep real attachment files available in a compact row.

2. **Finish everyday mail actions.** The connected reader currently has Back and Reply, but no archive, delete, move, spam/not-spam or mark-unread actions. Add these with clear outcomes, recoverable Undo where possible, keyboard access and bulk selection. Keeping the corresponding folders visible does not itself provide these actions.

3. **Preserve navigation state.** Open/back restores scroll within the mounted reader, but switching folders or leaving for Settings remounts it and loses loaded pages, relevance selection and reading position. Keep per-folder state, restore row keyboard focus, preserve expanded folders, and add previous/next message controls. Make refresh failures preserve the current working view.

4. **Make incoming mail and search dependable.** The current connected view needs manual Refresh, folder counts can lag, and search only covers loaded sender/subject lines. Add reconnect-aware incremental refresh, accurate unread badges and a visible last-sync/error state; then mailbox-wide search with account/folder, sender, date and attachment filters. An empty loaded page should not look like an empty mailbox. Local offline caching belongs in this milestone too.

5. **Complete conversations and replies.** The current reader opens one message. Add conversation history, quoted replies, Reply all and Forward. In Sent Items, show recipients in the row instead of the user's own From address. The agreed conversation design uses expanded messages separated by fine rules.

6. **Complete compose and draft lifecycle.** Replace raw recipient strings with editable recipient chips, validation feedback and contact autocomplete. Add clear draft deletion/discard, attachment drag/drop and larger-file handling; eventually rich text, signatures and templates. After a successful send, offer Done/close with clear submitted status while preserving the existing durable uncertain-send protection. Keep local and provider Drafts understandable until synchronization is implemented.

Start with reading clutter and everyday actions; then navigation state and sync/search. These address daily friction before adding further integrations or decoration. Native keyboard behavior, scaling and window interactions still need CachyOS/GNOME checks.
