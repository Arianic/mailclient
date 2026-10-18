import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { nativeDesktop } from "./desktop";

export type OutlookAccount = { displayName: string; email: string };
export type OutlookStatus = {
  account: OutlookAccount | null;
  clientId: string | null;
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
};
export type OutlookInbox = { messages: OutlookSummary[]; hasMore: boolean };
export type OutlookMessage = {
  id: string;
  body: { contentType: string; content: string };
};

// Tokens and network URLs never cross this bridge. Real mail is deliberately
// kept out of the prototype's localStorage/SQLite key-value state and exports.
export const outlookApi = {
  status: () => invoke<OutlookStatus>("outlook_status"),
  connect: (clientId: string) =>
    invoke<OutlookStatus>("outlook_connect", { clientId }),
  cancel: () => invoke<void>("outlook_cancel"),
  disconnect: () => invoke<void>("outlook_disconnect"),
  inbox: () => invoke<OutlookInbox>("outlook_inbox"),
  message: (id: string) => invoke<OutlookMessage>("outlook_message", { id }),
};

export function useOutlook() {
  const [status, setStatus] = useState<OutlookStatus>({
    account: null,
    clientId: null,
  });
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState<
    "" | "checking" | "connecting" | "disconnecting"
  >(nativeDesktop ? "checking" : "");
  const [error, setError] = useState("");
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
    }
  };
  useEffect(() => {
    if (nativeDesktop) void check();
  }, []);
  const connect = async () => {
    setBusy("connecting");
    setError("");
    try {
      setStatus(await outlookApi.connect(clientId.trim()));
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
    setStatus({ account: null, clientId: null });
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
  };
}
export type OutlookConnection = ReturnType<typeof useOutlook>;
