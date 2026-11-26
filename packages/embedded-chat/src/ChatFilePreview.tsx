import { useEffect, useState } from "react";
import type { ChatFilePreview as Preview } from "./chatPreview";
import { Icon, useChatHost } from "./host";
export function ChatFilePreview({
  id,
  href,
  onClose,
}: {
  id: string;
  href: string;
  onClose: () => void;
}) {
  const { api, tx, PDFPreview: LocalPDFPreview } = useChatHost();
  const [file, setFile] = useState<Preview>(),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [scripts, setScripts] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFile(undefined);
    setError("");
    setScripts(false);
    api<Preview>(`/chat/${id}/preview`, "POST", { href }, controller.signal)
      .then(setFile)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, href, revision]);
  return (
    <section className="chat-file-preview" aria-label={tx("File preview")}>
      <div className="chat-preview-tools">
        <button
          className="quiet"
          onClick={onClose}
          title={tx("Back to task index")}
          aria-label={tx("Back to task index")}
        >
          <Icon name="back" size={16} />
        </button>
        <strong>{(file?.path || href).split("/").at(-1)}</strong>
        <button
          className="quiet"
          onClick={() => setRevision((n) => n + 1)}
          title={tx("Refresh preview")}
          aria-label={tx("Refresh preview")}
        >
          <Icon name="refresh" size={16} />
        </button>
        <button
          className="quiet"
          onClick={onClose}
          title={tx("Close preview")}
          aria-label={tx("Close preview")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="chat-preview-path" title={file?.path || href}>
        {file?.path || href}
      </div>
      {error ? (
        <div className="error chat-preview-error" role="alert">
          {error}
        </div>
      ) : !file ? (
        <p className="muted">{tx("Loading preview…")}</p>
      ) : file.kind === "pdf" ? (
        <LocalPDFPreview url={file.url} onJump={() => {}} />
      ) : (
        <>
          <div className="chat-preview-html-tools">
            <label>
              <input
                type="checkbox"
                checked={scripts}
                onChange={(e) => setScripts(e.target.checked)}
              />
              {tx("Allow scripts")}
            </label>
            <span className="small muted">
              {tx("Self-contained HTML. External resources are blocked.")}
            </span>
          </div>
          <iframe
            key={file.url + scripts}
            src={file.url}
            title={file.path}
            sandbox={scripts ? "allow-scripts" : ""}
            referrerPolicy="no-referrer"
          />
        </>
      )}
    </section>
  );
}
