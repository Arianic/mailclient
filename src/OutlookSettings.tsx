import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { nativeDesktop } from "./desktop";
import type { OutlookConnection } from "./outlook";

export function OutlookSettings({
  connection,
  openInbox,
}: {
  connection: OutlookConnection;
  openInbox: () => void;
}) {
  const {
    status,
    clientId,
    setClientId,
    busy,
    error,
    check,
    connect,
    disconnect,
    cancel,
  } = connection;
  return (
    <section className="settings-card outlook-settings">
      <h2>
        <span className="account-dot outlook-dot" />
        Personal Outlook
      </h2>
      {status.account ? (
        <>
          <div className="outlook-identity">
            <strong>{status.account.displayName}</strong>
            <span>{status.account.email}</span>
          </div>
          <p className="settings-note">
            {status.canSend
              ? "Reading and sending are enabled."
              : "Reading is enabled. Approve sending below to send new messages and replies."}{" "}
            Your sign-in is saved in GNOME Keyring.
          </p>
          <div className="outlook-actions">
            <button
              className="soft-button"
              disabled={!!busy}
              onClick={() => void connect(false, true)}
            >
              {status.canManage
                ? "Review read-status permission"
                : "Enable read-status sync"}
            </button>
            <button
              className="primary-button"
              onClick={openInbox}
              disabled={!!busy}
            >
              Open inbox <ArrowUpRight size={14} />
            </button>
            <button
              className="text-button"
              onClick={() => void disconnect()}
              disabled={!!busy}
            >
              Disconnect
            </button>
            <button
              className="soft-button"
              disabled={!!busy}
              onClick={() => void connect(true)}
            >
              {busy === "connecting"
                ? "Waiting for Microsoft…"
                : status.canSend
                  ? "Review sending permission"
                  : "Enable sending"}
            </button>
            {busy === "connecting" && (
              <button className="text-button" onClick={() => void cancel()}>
                Cancel sign-in
              </button>
            )}
          </div>
          <p className="settings-note">
            {status.canManage
              ? "Opening a message marks it as read in Outlook."
              : "Read-status sync needs Microsoft Mail.ReadWrite permission. Sending permission is kept when you enable it."}
          </p>
        </>
      ) : (
        <>
          <p>
            Read your recent inbox with a personal Microsoft account. Sign-in
            opens in your normal browser.
          </p>
          <label className="outlook-client-id">
            Application (client) ID
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="From your Microsoft app registration"
              spellCheck={false}
              autoComplete="off"
              disabled={!!busy || !nativeDesktop}
            />
          </label>
          <div className="outlook-actions">
            <button
              className="primary-button"
              disabled={!nativeDesktop || !!busy || !clientId.trim()}
              onClick={() => void connect()}
            >
              {busy === "connecting"
                ? "Waiting for Microsoft…"
                : busy === "checking"
                  ? "Checking sign-in…"
                  : busy === "disconnecting"
                    ? "Disconnecting…"
                    : "Connect Outlook"}
            </button>
            {busy === "connecting" && (
              <button className="text-button" onClick={() => void cancel()}>
                Cancel sign-in
              </button>
            )}
          </div>
          {!nativeDesktop && (
            <p className="settings-note">
              Account connections are available in the Linux desktop app.
            </p>
          )}
          <details className="outlook-help">
            <summary>Set up Outlook sign-in</summary>
            <p>
              App registration requires access to a Microsoft Entra directory. A
              personal Outlook mailbox alone is not sufficient.
            </p>
            <ol>
              <li>
                In Microsoft Entra, register an app for{" "}
                <strong>personal Microsoft accounts</strong>.
              </li>
              <li>
                Add the <strong>Mobile and desktop applications</strong>{" "}
                platform with return address{" "}
                <code>http://localhost/oauth/callback</code>.
              </li>
              <li>
                Add Microsoft Graph delegated permissions <code>User.Read</code>{" "}
                and <code>Mail.Read</code>. Keep this a public desktop app; no
                client secret is needed.
              </li>
              <li>
                Copy its Application (client) ID into the field above, then
                connect.
              </li>
            </ol>
            <p>
              Approve read access on Microsoft’s page. Mail also requests
              permission to stay signed in. Once connected, use Enable sending
              to separately approve Mail.Send for new messages and replies.
            </p>
          </details>
        </>
      )}
      {error && (
        <div className="outlook-error" role="alert">
          <p>{error}</p>
          <div className="outlook-actions">
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => void check()}
            >
              Check again
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => void disconnect()}
            >
              Forget saved sign-in
            </button>
          </div>
        </div>
      )}
      <p className="outlook-privacy">
        <LockKeyhole size={12} />
        No AI is connected. Your Microsoft password stays with Microsoft.
      </p>
    </section>
  );
}
