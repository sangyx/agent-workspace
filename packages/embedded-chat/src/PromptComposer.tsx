import type { VoiceSettings } from "./contracts";
import type { ComposerCommand } from "./workspaceChat";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type ComponentType,
} from "react";
/** The "/" menu's entries for what is typed so far: prefix matches first, then other matches. */
export function matchCommands(
  commands: ComposerCommand[],
  value: string,
): ComposerCommand[] {
  const typed = /^\/(\S*)$/.exec(value);
  if (!typed) return [];
  const q = typed[1].toLowerCase();
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const inner = commands.filter(
    (c) =>
      !c.name.toLowerCase().startsWith(q) &&
      (c.name.toLowerCase().includes(q) ||
        !!c.description?.toLowerCase().includes(q)),
  );
  return [...prefix, ...inner];
}
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
  commands = [],
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
  commands?: ComposerCommand[];
}) {
  const fallback = useRef<HTMLTextAreaElement>(null),
    input = inputRef || fallback;
  const dictation = voicePhase;
  const recording = ["starting", "listening", "finishing"].includes(dictation);
  const menuId = useId();
  const [active, setActive] = useState(0);
  // Escape hides the menu for what is typed now; typing something else shows it again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const matches = useMemo(
    () => matchCommands(commands, value),
    [commands, value],
  );
  const menuOpen = matches.length > 0 && dismissed !== value && !recording;
  useEffect(() => setActive(0), [value]);
  const activeItem = useRef<HTMLLIElement | null>(null);
  useEffect(() => activeItem.current?.scrollIntoView({ block: "nearest" }), [
    active,
  ]);
  const choose = (command: ComposerCommand) => {
    onChange("/" + command.name + " ");
    setDismissed(null);
    input.current?.focus();
  };
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
      {menuOpen && (
        <ul
          className="composer-commands"
          id={menuId}
          role="listbox"
          aria-label={tx("Commands")}
        >
          {matches.map((command, i) => (
            <li
              key={command.name}
              id={`${menuId}-${i}`}
              ref={i === active ? activeItem : undefined}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(command)}
            >
              <span className="composer-command-name">
                /{command.name}
                {command.hint && (
                  <span className="composer-command-hint">
                    {" "}
                    {command.hint}
                  </span>
                )}
              </span>
              {command.description && (
                <span className="composer-command-description">
                  {command.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={input}
        data-composer-input
        aria-label={label}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-autocomplete={commands.length ? "list" : undefined}
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={commands.length ? menuOpen : undefined}
        aria-activedescendant={menuOpen ? `${menuId}-${active}` : undefined}
        onKeyDown={(e) => {
          if (menuOpen && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (i + step + matches.length) % matches.length);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(value);
              return;
            }
            const command = matches[active];
            // Enter on a fully typed command sends it; otherwise Enter/Tab complete the name first.
            if (
              command &&
              (e.key === "Tab" ||
                (e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.altKey &&
                  value !== "/" + command.name))
            ) {
              e.preventDefault();
              choose(command);
              return;
            }
          }
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
