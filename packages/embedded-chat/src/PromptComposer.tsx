import type { VoiceSettings } from "./contracts";
import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type ComponentType,
} from "react";
export function PromptComposer({
  tx,
  Icon,
  voicePhase,
  onDictate,
  value,
  onChange,
  onSend,
  onStop,
  busy,
  ready = true,
  placeholder,
  label,
  inputRef,
  controls,
  minInputHeight = 64,
  voiceOptions,
  onSideChat,
  sideChatDisabled = false,
  sideChatHint,
}: {
  tx: (text: string) => string;
  Icon: ComponentType<{ name: string; size?: number }>;
  voicePhase: string;
  onDictate: (input: HTMLTextAreaElement) => void;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  ready?: boolean;
  placeholder: string;
  label: string;
  inputRef?: { current: HTMLTextAreaElement | null };
  controls: ReactNode;
  minInputHeight?: number;
  voiceOptions?: VoiceSettings;
  onSideChat?: (question: string) => void;
  sideChatDisabled?: boolean;
  sideChatHint?: string;
}) {
  const fallback = useRef<HTMLTextAreaElement>(null),
    input = inputRef || fallback;
  const dictation = voicePhase;
  const recording = ["starting", "listening", "finishing"].includes(dictation);
  const send = () => {
    if (onSideChat && /^\/btw\b/i.test(value.trim())) {
      if (!sideChatDisabled)
        onSideChat(value.trim().replace(/^\/btw\b\s*/i, ""));
    } else if (!busy && ready && !recording && value.trim()) onSend();
  };
  useLayoutEffect(() => {
    const e = input.current;
    if (!e) return;
    e.style.height = "0px";
    e.style.height =
      Math.max(minInputHeight, Math.min(160, e.scrollHeight)) + "px";
  }, [value, minInputHeight]);
  return (
    <form
      className={`prompt-composer ${onSideChat ? "has-side-chat" : ""}`}
      data-voice-options={
        voiceOptions ? JSON.stringify(voiceOptions) : undefined
      }
      aria-label={tx("Message composer")}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        data-composer-input
        aria-label={label}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            e.altKey &&
            !e.nativeEvent.isComposing &&
            onSideChat
          ) {
            e.preventDefault();
            if (!sideChatDisabled && !recording)
              onSideChat(value.trim().replace(/^\/btw\b\s*/i, ""));
            return;
          }
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault();
            send();
          }
        }}
      />
      {controls}
      <button
        className="composer-voice"
        type="button"
        data-voice-ui
        aria-label={tx(recording ? "Finish voice input" : "语音输入")}
        title={tx(recording ? "Finish voice input" : "语音输入")}
        aria-pressed={recording}
        disabled={dictation === "starting" || dictation === "finishing"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const element = input.current;
          if (!element) return;
          element.focus();
          onDictate(element);
        }}
      >
        <Icon name={recording ? "stop" : "mic"} size={19} />
      </button>
      {onSideChat && (
        <button
          type="button"
          className="composer-side-chat"
          aria-label={tx("Side chat")}
          title={tx(sideChatHint || "Side chat · ⌥Enter")}
          disabled={sideChatDisabled || recording}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSideChat(value.trim().replace(/^\/btw\b\s*/i, ""))}
        >
          <Icon name="chat" size={18} />
        </button>
      )}
      {busy ? (
        <button
          className="composer-submit composer-stop"
          type="button"
          aria-label={tx("Stop generation")}
          title={tx("Stop generation")}
          onClick={onStop}
        >
          <Icon name="stop" size={17} />
        </button>
      ) : (
        <button
          className="composer-submit assistant-send"
          type="submit"
          aria-label={tx("发送")}
          title={tx("发送")}
          disabled={!value.trim() || !ready || recording}
        >
          <Icon name="up" size={20} />
        </button>
      )}
    </form>
  );
}
