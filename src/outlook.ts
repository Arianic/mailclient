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
};
export type OutlookInbox = { messages: OutlookSummary[]; hasMore: boolean };
export type OutlookMessage = {
  id: string;
  body: { contentType: string; content: string };
  toRecipients?: OutlookSummary["from"][];
  ccRecipients?: OutlookSummary["from"][];
};
export type OutlookDraft = {
  id: string;
  account: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  replyId: string | null;
  state: "draft" | "sending" | "accepted" | "uncertain";
  attachments?: DraftAttachment[];
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
  ) =>
    read(`inbox:${folder}:${view}:${older}`, () =>
      invoke<OutlookInbox>("outlook_inbox", { view, older, folder }),
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
  openCompose: (draftId: string | null = null, replyId: string | null = null) =>
    invoke<void>("open_outlook_compose", { draftId, replyId }),
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
