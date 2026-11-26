import type { ComponentType, ReactNode, RefObject } from "react";
import type { ChatProject, ConversationSummary } from "./workspaceChat";
export type ReasoningEffort =
  "default" | "low" | "medium" | "high" | "xhigh" | "max";
export interface DirectoryTarget {
  location: "local" | "ssh";
  path: string;
  sshHost?: string;
  cliPath?: string;
  cliPaths?: Partial<Record<Provider["engine"], string>>;
}
export interface Provider {
  id: string;
  name: string;
  engine: "claude" | "codex" | "gemini" | "antigravity";
  location: "local" | "ssh";
  sshHost?: string;
  binPath?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}
export interface VoiceSettings {
  engine: "apple" | "whisper" | "openai";
  locale: "auto" | "zh-CN" | "en-US";
  binPath?: string;
  modelPath?: string;
  openaiModel?: string;
}
export interface ChatSettings {
  providers: Provider[];
  defaultProviderId?: string;
  taskProfiles?: {
    chat?: { providerId?: string; model?: string; effort?: ReasoningEffort };
  };
  voice?: VoiceSettings;
}
export interface PromptOptions {
  model?: string;
  effort?: ReasoningEffort;
  attachmentIds?: string[];
}
export interface PromptState {
  options: PromptOptions;
  ready: boolean;
  controls: {
    value: PromptOptions;
    onChange: (value: PromptOptions) => void;
    onUploading?: (busy: boolean) => void;
  };
}
export interface ModelCatalog {
  engine: Provider["engine"];
  models: { id: string; label: string; efforts?: ReasoningEffort[] }[];
  source: "cli-cache" | "presets" | "native-cli";
  defaultModel?: string;
  note: string;
}
export interface ComposerProps {
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
  onSideChat?: (text: string) => void;
  sideChatDisabled?: boolean;
  sideChatHint?: string;
}
export interface AIControlsProps {
  pid?: string;
  providerId: string;
  onProviderChange: (id: string) => void;
  value: PromptOptions;
  onChange: (value: PromptOptions) => void;
  onUploading?: (busy: boolean) => void;
  disabled?: boolean;
  providers?: Provider[];
  toolbarStart?: ReactNode;
  catalogLoader?: (engine: string) => Promise<ModelCatalog>;
}
export interface MenuAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<unknown>;
}
export interface MenuEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
}
/** A host supplies infrastructure. Conversation rendering and state belong to this package. */
export interface ChatHost {
  language: string;
  tx: (text: string) => string;
  api: <T = any>(
    url: string,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<T>;
  navigate: (
    project?: string,
    page?: "chat",
    conversation?: string,
  ) => void | Promise<unknown>;
  copyText: (text: string) => void | Promise<unknown>;
  hideAssistant: () => void;
  chatChanged: () => void;
  newChatProject: () => void;
  importChat: (project?: string) => void;
  renameChatProject: (project: ChatProject) => void | Promise<unknown>;
  renameConversation: (
    chat: Pick<ConversationSummary, "id" | "title">,
  ) => void | Promise<unknown>;
  archiveConversation: (
    chat: Pick<ConversationSummary, "id" | "archived">,
  ) => void | Promise<unknown>;
  openContextMenu: (event: MenuEvent, items: MenuAction[]) => void;
  toggleSidebar: (side: "left" | "right", visible?: boolean) => void;
  useSidebarVisible: (side: "left" | "right") => boolean;
  usePromptAI: () => PromptState;
  draftKey: (conversation?: string, project?: string) => string;
  transientKey: (kind: "error" | "retry", conversation: string) => string;
  events: { archived: string; chatsUpdated: string };
  Icon: ComponentType<{ name: string; size?: number }>;
  Header: ComponentType<{ children: ReactNode; className?: string }>;
  Composer: ComponentType<ComposerProps>;
  AIControls: ComponentType<AIControlsProps>;
  DirectoryPicker: ComponentType<{
    label: string;
    value: DirectoryTarget;
    onChange: (value: DirectoryTarget) => void;
  }>;
  SidebarPaneControls: ComponentType<{ side: "left" | "right"; title: string }>;
  PDFPreview: ComponentType<{
    url: string;
    onJump: (page: number, x: number, y: number) => void;
  }>;
}
