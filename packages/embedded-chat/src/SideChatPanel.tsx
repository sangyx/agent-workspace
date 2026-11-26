import { useEffect, useRef, useState } from "react";
import type { SideChatEntry } from "./workspaceChat";
import type { VoiceSettings } from "./contracts";
import { ChatMarkdown } from "./ChatMarkdown";
import { Icon, useChatHost } from "./host";
export interface SideQuestion {
  id: number;
  text: string;
}
export function SideChatPanel({
  id,
  question,
  onBring,
  onIndex,
  voiceOptions,
  onBusy,
}: {
  id: string;
  question?: SideQuestion;
  onBring: (text: string) => void;
  onIndex: () => void;
  voiceOptions?: VoiceSettings;
  onBusy: (busy: boolean) => void;
}) {
  const {
    api,
    tx,
    toggleSidebar,
    copyText,
    Composer: PromptComposer,
  } = useChatHost();
  const [entries, setEntries] = useState<SideChatEntry[]>([]),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    lock = useRef(false),
    seen = useRef(0),
    input = useRef<HTMLTextAreaElement>(null),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    api<SideChatEntry[]>(`/chat/${id}/side-chat`)
      .then((v) => {
        if (alive.current && !lock.current) setEntries(v);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, [id]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const ask = async (text: string) => {
    if (lock.current) return;
    if (!text.trim()) {
      input.current?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setDraft("");
    const pending: SideChatEntry = {
      id: crypto.randomUUID(),
      question: text,
      askedAt: new Date().toISOString(),
    };
    setEntries((v) => [...v, pending]);
    try {
      const reply = await api<SideChatEntry>(`/chat/${id}/side-chat`, "POST", {
        question: text,
      });
      if (alive.current)
        setEntries((v) => v.map((e) => (e.id === pending.id ? reply : e)));
      const history = await api<SideChatEntry[]>(`/chat/${id}/side-chat`).catch(
        () => undefined,
      );
      if (alive.current && history) setEntries(history);
    } catch (e: any) {
      if (alive.current) {
        setError(e.message);
        setEntries((v) =>
          v.map((x) => (x.id === pending.id ? { ...x, error: e.message } : x)),
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (question && question.id !== seen.current) {
      seen.current = question.id;
      void ask(question.text);
    }
  }, [question]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [entries]);
  const waiting = busy || entries.some((e) => !e.answer && !e.error);
  useEffect(() => {
    onBusy(waiting);
    return () => onBusy(false);
  }, [waiting, onBusy]);
  useEffect(() => {
    if (!waiting || busy) return;
    const timer = setInterval(() => {
      void api<SideChatEntry[]>(`/chat/${id}/side-chat`)
        .then((v) => {
          if (alive.current && !lock.current) setEntries(v);
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [waiting, busy, id]);
  return (
    <>
      <div className="side-chat-heading">
        <strong
          title={tx(
            "Answers use this conversation without interrupting or adding a turn.",
          )}
        >
          {tx("Side chat")}
        </strong>
        <button
          type="button"
          aria-label={tx("Task index")}
          title={tx("Task index")}
          onClick={onIndex}
        >
          <Icon name="graph" size={16} />
        </button>
        <button
          type="button"
          disabled={waiting || !entries.length}
          aria-label={tx("Clear side chat")}
          title={tx("Clear side chat")}
          onClick={() => {
            void api(`/chat/${id}/side-chat`, "DELETE")
              .then(() => setEntries([]))
              .catch((e) => setError(e.message));
          }}
        >
          <Icon name="trash" size={16} />
        </button>
        <button
          type="button"
          aria-label={tx("Hide right sidebar")}
          onClick={() => toggleSidebar("right", false)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="side-chat-history">
        {!entries.length && (
          <p className="muted small">
            {tx(
              "Ask a side question about this conversation. The main agent continues working.",
            )}
          </p>
        )}
        {entries.map((e) => (
          <article className="side-chat-exchange" key={e.id}>
            <p className="side-chat-question">{e.question}</p>
            {e.answer ? (
              <>
                <ChatMarkdown>{e.answer}</ChatMarkdown>
                <div className="row">
                  <button
                    className="quiet"
                    onClick={() => void copyText(e.answer!)}
                  >
                    {tx("Copy")}
                  </button>
                  <button
                    className="quiet"
                    onClick={() =>
                      onBring(
                        `About my side question “${e.question}”:\n> ${e.answer!.replace(/\n/g, "\n> ")}\n\n`,
                      )
                    }
                  >
                    {tx("Bring into the conversation")}
                  </button>
                </div>
              </>
            ) : e.error ? (
              <p className="error" role="alert">
                {e.error}
              </p>
            ) : (
              <p role="status" className="muted small">
                {tx("Answering…")}
              </p>
            )}
          </article>
        ))}
        <div ref={end} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="side-chat-composer">
        <PromptComposer
          value={draft}
          onChange={setDraft}
          onSend={() => void ask(draft)}
          onStop={() => {}}
          busy={false}
          ready={!waiting}
          voiceOptions={voiceOptions}
          inputRef={input}
          placeholder={tx("Ask a side question…")}
          label={tx("Side question")}
          controls={null}
          minInputHeight={40}
        />
      </div>
    </>
  );
}
