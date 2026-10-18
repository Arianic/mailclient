import { useState } from "react";
import { Image, Paperclip, Download } from "lucide-react";
import { SafeMessage } from "./SafeMessage";
import {
  outlookApi,
  type OutlookMessage,
  type OutlookAttachment,
  type OutlookImages,
} from "./outlook";
import { sanitizeMailHtml } from "./mail-renderer";
export function htmlText(html: string) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeMailHtml(html);
  template.content
    .querySelectorAll("p,div,br,li,h1,h2,h3,blockquote")
    .forEach((element) => element.append("\n"));
  return template.content.textContent || "";
}
export function MessageContent({
  message,
  dark,
  hasAttachments = true,
}: {
  message: OutlookMessage;
  dark: boolean;
  hasAttachments?: boolean;
}) {
  const [images, setImages] = useState<OutlookImages | null>(null),
    [files, setFiles] = useState<OutlookAttachment[] | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const html =
    message.body.contentType.toLowerCase() === "html"
      ? message.body.content
      : undefined;
  const template = document.createElement("template");
  if (html) template.innerHTML = html;
  const hasImages = Array.from(
    template.content.querySelectorAll("img[src]"),
  ).some(
    (image) => !image.getAttribute("src")?.toLowerCase().startsWith("data:"),
  );
  const media = async (action: () => Promise<string>) => {
    setBusy(true);
    setStatus("");
    try {
      setStatus(await action());
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="message-content">
      <div className="message-media-controls">
        {hasImages && (!images || images.blocked > 0) && (
          <>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void media(async () => {
                  await outlookApi.message(message.id);
                  const next = await outlookApi.images(message.id);
                  setImages(next);
                  return next.blocked
                    ? `${next.blocked} images unavailable or blocked.`
                    : "";
                })
              }
            >
              <Image size={14} />
              {busy
                ? "Loading…"
                : images
                  ? "Retry missing images"
                  : "Load images"}
            </button>
            <span className="subtle">
              Loading remote images can reveal that you opened this email.
            </span>
          </>
        )}
        {hasAttachments && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              files
                ? setFiles(null)
                : void media(async () => {
                    await outlookApi.message(message.id);
                    const next = (
                      await outlookApi.attachments(message.id)
                    ).filter((file) => !file.isInline);
                    setFiles(next);
                    return next.length ? "" : "No file attachments.";
                  })
            }
          >
            <Paperclip size={14} />
            {files ? "Hide attachments" : "Attachments"}
          </button>
        )}
      </div>
      {status && (
        <p className="media-status" role="status">
          {status}
        </p>
      )}
      {!!files?.length && (
        <div className="attachment-downloads">
          {files.map((file) => (
            <button
              className="soft-button"
              key={file.id}
              disabled={busy}
              onClick={() =>
                void media(async () => {
                  await outlookApi.message(message.id);
                  return (await outlookApi.downloadAttachment(
                    message.id,
                    file.id,
                  ))
                    ? "File saved."
                    : "Download canceled.";
                })
              }
            >
              <Download size={13} />
              {file.name}
              <span className="subtle">
                {Math.max(1, Math.round(file.size / 1000))} KB
              </span>
            </button>
          ))}
        </div>
      )}
      <SafeMessage
        html={html}
        text={html ? htmlText(html) : message.body.content}
        dark={dark}
        images={Object.fromEntries(
          images?.images.map((image) => [image.source, image.dataUrl]) || [],
        )}
        quiet
      />
    </div>
  );
}
