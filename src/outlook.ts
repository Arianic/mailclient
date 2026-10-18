import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { nativeDesktop } from "./desktop";

export type OutlookAccount = { displayName: string; email: string };
export type OutlookStatus = {
  account: OutlookAccount | null;
  clientId: string | null;
  canSend: boolean;
  canManage?: boolean;
};
export type OutlookSummary = {
  id: string;
  subject: string | null;
  from: {
    emailAddress: { name: string | null; address: string | null };
  } | null;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  inferenceClassification?: string | null;
  toRecipients?: NonNullable<OutlookSummary["from"]>[];
  ccRecipients?: NonNullable<OutlookSummary["from"]>[];
  bccRecipients?: NonNullable<OutlookSummary["from"]>[];
  parentFolderId?: string;
  conversationId?: string;
};
export type OutlookInbox = {
  messages: OutlookSummary[];
  hasMore: boolean;
  offline?: boolean;
};
export type OutlookMessage = {
  id: string;
  body: { contentType: string; content: string };
  toRecipients?: NonNullable<OutlookSummary["from"]>[];
  ccRecipients?: NonNullable<OutlookSummary["from"]>[];
  bccRecipients?: NonNullable<OutlookSummary["from"]>[];
  offline?: boolean;
};
export type OutlookDraft = {
  id: string;
  account: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  bodyHtml?: string | null;
  signature?: WritingItem | null;
  quote?: string | null;
  writingInitialized?: boolean;
  replyId: string | null;
  state: "draft" | "sending" | "preparing" | "accepted" | "uncertain";
  attachments?: DraftAttachment[];
  notice?: string | null;
};
export type WritingItem = {
  id: string;
  name: string;
  kind: "signature" | "template" | "snippet";
  body: string;
  bodyHtml?: string | null;
  subject?: string | null;
};
export type WritingLibrary = {
  revision: number;
  entries: WritingItem[];
  defaultSignature: string | null;
};
export type DraftAttachment = { id: string; name: string; size: number };
export type OutlookFolder = {
  id: string;
  displayName: string;
  unreadItemCount: number;
  childFolderCount: number;
  isInbox: boolean;
};
export type OutlookAttachment = {
  id: string;
  name: string;
  size: number;
  contentType: string | null;
  isInline: boolean;
};
export type OutlookImages = {
  images: { source: string; dataUrl: string }[];
  blocked: number;
};
export type IndexStatus = {
  paused?: boolean;
  messages: number;
  folders: number;
  pending: number;
  missingFiles: number;
  reportedItems?: number | null;
  coverageGaps?: number;
  lastSync: number;
  error: string | null;
};
export type SearchPage = OutlookInbox & {
  total: number;
  snippets: Record<string, string>;
  suggestions: string[];
  status: IndexStatus;
};
export type ActionResult = {
  ids: string[];
  failures: { id: string; error: string }[];
  undo: string | null;
};
export type Contact = { name: string | null; address: string | null };

const reads = new Map<string, Promise<unknown>>();
function read<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = reads.get(key);
  if (pending) return pending as Promise<T>;
  const promise = action().finally(() => reads.delete(key));
  reads.set(key, promise);
  return promise;
}

// Tokens and network URLs never cross this bridge. Real mail is deliberately
// kept out of the prototype's localStorage/SQLite key-value state and exports.
export const outlookApi = {
  writingLibrary: (id: string) =>
    invoke<WritingLibrary>("outlook_writing_library", { id }),
  saveWritingLibrary: (id: string, library: WritingLibrary) =>
    invoke<WritingLibrary>("outlook_save_writing_library", { id, library }),
  indexControl: (action: "pause" | "resume" | "clear" | "rebuild") =>
    invoke<IndexStatus>("outlook_index_control", { action }),
  search: (query: string, offset = 0, sort = "relevance") =>
    read(`search:${query}:${offset}:${sort}`, () =>
      invoke<SearchPage>("outlook_search", { query, offset, sort }),
    ),
  indexStatus: () =>
    read("index-status", () => invoke<IndexStatus>("outlook_index_status")),
  sync: () => read("sync", () => invoke<boolean>("outlook_sync")),
  cachedFolders: () =>
    read("cached-folders", () =>
      invoke<OutlookFolder[]>("outlook_cached_folders"),
    ),
  action: (ids: string[], action: string, destination: string | null = null) =>
    invoke<ActionResult>("outlook_action", { ids, action, destination }),
  undo: (key: string) => invoke<ActionResult>("outlook_undo", { key }),
  conversation: (id: string) =>
    read(`conversation:${id}`, () =>
      invoke<{
        messages: (OutlookSummary & OutlookMessage)[];
        complete: boolean;
      }>("outlook_conversation", { id }),
    ),
  contacts: (query: string) =>
    read(`contacts:${query}`, () =>
      invoke<Contact[]>("outlook_contacts", { query }),
    ),
  discardDraft: (id: string) => invoke<void>("outlook_discard_draft", { id }),
  status: () => read("status", () => invoke<OutlookStatus>("outlook_status")),
  connect: (clientId: string, enableSending = false, enableManaging = false) =>
    invoke<OutlookStatus>("outlook_connect", {
      clientId,
      enableSending,
      enableManaging,
    }),
  cancel: () => invoke<void>("outlook_cancel"),
  disconnect: () => invoke<void>("outlook_disconnect"),
  inbox: (
    view: "important" | "other" | "all" = "important",
    older = false,
    folder = "inbox",
    offset = 0,
  ) =>
    read(`inbox:${folder}:${view}:${older}:${offset}`, () =>
      invoke<OutlookInbox>("outlook_inbox", { view, older, folder, offset }),
    ),
  folders: (parent: string | null = null) =>
    read(`folders:${parent}`, () =>
      invoke<OutlookFolder[]>("outlook_folders", { parent }),
    ),
  markRead: (id: string) =>
    read(`read:${id}`, () => invoke<void>("outlook_mark_read", { id })),
  message: (id: string) =>
    read(`message:${id}`, () =>
      invoke<OutlookMessage>("outlook_message", { id }),
    ),
  openCompose: (
    draftId: string | null = null,
    replyId: string | null = null,
    mode: "reply" | "replyAll" | "forward" = "reply",
  ) => invoke<void>("open_outlook_compose", { draftId, replyId, mode }),
  drafts: () => read("drafts", () => invoke<OutlookDraft[]>("outlook_drafts")),
  loadDraft: (id: string) =>
    read(`draft:${id}`, () =>
      invoke<OutlookDraft>("outlook_load_draft", { id }),
    ),
  saveDraft: (draft: OutlookDraft) =>
    invoke<void>("outlook_save_draft", { draft }),
  sendDraft: (id: string) => invoke<string>("outlook_send_draft", { id }),
  addDraftFiles: (id: string) =>
    invoke<DraftAttachment[]>("outlook_add_draft_files", { id }),
  removeDraftFile: (id: string, attachmentId: string) =>
    invoke<DraftAttachment[]>("outlook_remove_draft_file", {
      id,
      attachmentId,
    }),
  attachments: (id: string) =>
    read(`files:${id}`, () =>
      invoke<OutlookAttachment[]>("outlook_attachments", { id }),
    ),
  images: (id: string) =>
    read(`images:${id}`, () =>
      invoke<OutlookImages>("outlook_load_images", { id }),
    ),
  downloadAttachment: (id: string, attachmentId: string) =>
    invoke<boolean>("outlook_download_attachment", { id, attachmentId }),
  downloadImage: (id: string, index: number) =>
    invoke<boolean>("outlook_download_image", { id, index }),
};

export function useOutlook() {
  const [status, setStatus] = useState<OutlookStatus>({
    account: null,
    clientId: null,
    canSend: false,
  });
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState<
    "" | "checking" | "connecting" | "disconnecting"
  >(nativeDesktop ? "checking" : "");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(!nativeDesktop);
  const check = async () => {
    setBusy("checking");
    setError("");
    try {
      const next = await outlookApi.status();
      setStatus(next);
      if (next.clientId) setClientId(next.clientId);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy("");
      setReady(true);
    }
  };
  useEffect(() => {
    if (nativeDesktop) void check();
  }, []);
  const connect = async (enableSending = false, enableManaging = false) => {
    setBusy("connecting");
    setError("");
    try {
      setStatus(
        await outlookApi.connect(
          clientId.trim(),
          enableSending,
          enableManaging,
        ),
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy("");
    }
  };
  const disconnect = async () => {
    setBusy("disconnecting");
    setError("");
    // Hide the connected identity immediately, even if keyring removal fails.
    setStatus({ account: null, clientId: null, canSend: false });
    try {
      await outlookApi.disconnect();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy("");
    }
  };
  const cancel = async () => {
    try {
      await outlookApi.cancel();
    } catch (error) {
      setError(String(error));
    }
  };
  return {
    status,
    clientId,
    setClientId,
    busy,
    error,
    check,
    connect,
    disconnect,
    cancel,
    ready,
  };
}
export type OutlookConnection = ReturnType<typeof useOutlook>;
