import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  activeChatCSS,
  importChatStyle,
  maxChatStyleBytes,
  type ChatAppearance,
} from "../../shared/chat-appearance";
import type { Settings } from "../../shared/types";
import { call, errorText } from "../api";
import { t } from "../i18n";

export function ChatAppearanceSettings({ settings }: { settings: Settings }) {
  const [value, setValue] = useState<ChatAppearance>(
    () => settings.chatAppearance ?? { interfaceStyle: "claude" },
  );
  useEffect(
    () => setValue(settings.chatAppearance ?? { interfaceStyle: "claude" }),
    [settings.chatAppearance],
  );
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (appearance: ChatAppearance) => {
    setBusy(true);
    setError("");
    setValue(appearance);
    const switching = appearance.interfaceStyle !== value.interfaceStyle;
    if (switching) sessionStorage.setItem("amw.appearanceReturn", "1");
    try {
      await call("settings:update", { chatAppearance: appearance });
    } catch (e) {
      setValue(settings.chatAppearance ?? { interfaceStyle: "claude" });
      setError(errorText(e));
      if (switching) sessionStorage.removeItem("amw.appearanceReturn");
    } finally {
      setBusy(false);
    }
  };
  const style = value.customStyle;
  return (
    <div data-testid="chat-appearance-settings">
      <div className="settings-row">
        <label className="settings-row-main" htmlFor="chat-interface">
          <strong>{t("Chat style")}</strong>
        </label>
        <select
          id="chat-interface"
          className="input"
          aria-label={t("Chat style")}
          data-testid="chat-interface"
          disabled={busy}
          value={value.interfaceStyle}
          onChange={(e) =>
            void save({
              ...value,
              interfaceStyle: e.target
                .value as ChatAppearance["interfaceStyle"],
            })
          }
        >
          <option value="claude">Claude</option>
          <option value="chatgpt">ChatGPT</option>
        </select>
      </div>
      <div className="settings-row">
        <div className="settings-row-main">
          <strong>{t("Custom style")}</strong>
          {style ? (
            <span className="muted small" title={style.name}>
              {style.name}
            </span>
          ) : null}
        </div>
        <div className="row">
          {style ? (
            <>
              <label className="row">
                <input
                  type="checkbox"
                  checked={style.enabled}
                  disabled={busy}
                  aria-label={t("Enable custom style")}
                  onChange={(e) =>
                    void save({
                      ...value,
                      customStyle: { ...style, enabled: e.target.checked },
                    })
                  }
                />
                {t("Enabled")}
              </label>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void save({ ...value, customStyle: null })}
              >
                {t("Remove")}
              </button>
            </>
          ) : null}
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {style ? t("Replace CSS…") : t("Import CSS…")}
          </button>
          <input
            ref={input}
            type="file"
            accept=".css,text/css"
            hidden
            data-testid="chat-style-file"
            aria-label={t("Import Chat style file")}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > maxChatStyleBytes)
                  throw new Error(
                    "Choose a CSS text file smaller than 128 KB.",
                  );
                await save({
                  ...value,
                  customStyle: importChatStyle(file.name, await file.text()),
                });
              } catch (e) {
                setError(errorText(e));
              }
            }}
          />
        </div>
      </div>
      <p className="muted small">
        {t(
          "Changes apply immediately. Custom CSS applies only to conversations; Settings keeps its standard appearance.",
        )}
      </p>
      {error ? (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/** Appearance belongs to Workspace, including when its renderer is embedded in another app. */
export function useChatAppearance(
  settings: Settings | undefined,
  settingsOpen: boolean,
  focusId: string | null,
  renderer: "claude" | "chatgpt",
) {
  const css = activeChatCSS(settings?.chatAppearance?.customStyle);
  useLayoutEffect(() => {
    document.documentElement.dataset.chatInterface = renderer;
    if (focusId) sessionStorage.setItem("amw.appearanceTask", focusId);
    let style = document.getElementById(
      "amw-chat-custom-style",
    ) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "amw-chat-custom-style";
      document.head.append(style);
    }
    style.textContent = css;
    style.media =
      settingsOpen || document.documentElement.dataset.hostPage === "settings"
        ? "not all"
        : "all";
  }, [css, settingsOpen, focusId, renderer]);
}
