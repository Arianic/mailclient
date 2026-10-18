# Writing email

New Outlook drafts open in Rich text. Existing plain-text drafts keep their original format. The format picker switches between Rich text and Plain text; converting written rich text asks first because formatting is removed.

The local Tiptap editor supports bold, italic, underline, strikethrough, two heading levels, bullet/numbered lists, quotations, safe links, clear formatting and undo/redo. Standard editing shortcuts work, including Ctrl+B, Ctrl+I and Ctrl+Z. Link editing accepts http, https and mailto addresses. Editing or previewing a link does not automatically open it. This version does not include tables, arbitrary fonts/colors, embedded images or remote signature logos. Use attachments for image files.

Pasted HTML is restricted to basic formatting. Scripts, styles, remote images, forms, embedded documents and application attributes are removed. The Rust backend independently normalizes outgoing HTML and checks safe links before saving/submitting it. The received-email sandbox and per-message image permission remain unchanged. Tiptap's open-source editor runs locally; no Tiptap cloud service, AI service or collaboration endpoint is connected. See [Tiptap's React integration](https://tiptap.dev/docs/editor/getting-started/install/react).

## Signatures

Open Writing library → Signatures → New signature. Give it a name, write and format it, then Save entry. Select it from the composer's signature picker or choose Use signature in the library. No signature removes it from that draft. The default-signature picker in the library applies to newly initialized empty drafts for this account, including new replies; it does not rewrite existing writing.

A draft holds its own signature snapshot. Editing or deleting the library entry does not silently alter an already saved draft. Reselect or use the edited signature to refresh that draft's copy. Signatures are account-specific and do not change the From address or grant sending aliases. Plain-text sends use the signature's text. New reply/forward drafts keep quoted history separate, so the signature is placed before the quote; older saved drafts retain their existing combined body.

## Templates and snippets

Writing library has separate Signatures, Templates and Snippets tabs, name search and create/edit/delete controls. Each entry supports formatted text. Templates also have an optional subject. Create template from this message starts an entry from the current authored body and subject; recipients, attachments, signature and separately stored quoted history are not included.

Use template replaces message text and subject. Written messages require explicit replacement confirmation. Recipient fields, attachments, selected signature and separate quoted history stay in place. Empty subjects in templates remain empty rather than silently retaining an unrelated subject.

Insert snippet adds its text at the current editor selection, replacing only selected text. Rich text retains supported formatting; plain text inserts the text equivalent. The editor's Undo can reverse a rich snippet insertion. Library edits remain local until Save entry; unsaved edits require a discard choice before leaving the editor. Deleting a library entry requires confirmation and does not edit messages that already use it.

Libraries are saved per account in the same separate `outlook-drafts.sqlite` as real drafts, with a revision check to prevent another compose window's edits being overwritten. A conflict keeps the editor open and offers Reload library; inspect the refreshed library before saving your changes again. The library supports up to 100 entries, with per-entry and total size limits. Credentials, mail, signatures and templates are not included in appearance/settings exports. The database is not encrypted at rest; on Linux its app-data directory is owner-only.

## Sending and verification

Both the normal send path and the larger attachment upload path use the same normalized HTML/text body builder. Drafts preserve rich content, signature snapshots and quotes across saves/restarts. The five-second Undo Send, attachment limits, secure sign-in and durable uncertain-send protection remain in force. Formatted sends use Graph's HTML message body; see [Microsoft's sendMail API](https://learn.microsoft.com/en-us/graph/api/user-sendmail).

Development checks use synthetic content and never send real email. Native WebKit editing/paste behavior, actual formatted delivery and reply appearance in Outlook/Gmail remain part of the user's later CachyOS round-trip checks. Scheduled sending, From aliases, synced contacts and provider-created draft editing are separate later features.
