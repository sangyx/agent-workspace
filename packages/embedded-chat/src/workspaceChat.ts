import type { DirectoryTarget, ReasoningEffort } from "./contracts";
export type ChatPermissionMode = "ask" | "edits" | "auto";
export const defaultChatPermission = (engine?: string): ChatPermissionMode =>
  engine === "gemini" ? "ask" : "auto";
export const chatPermissionModes: {
  id: ChatPermissionMode;
  label: string;
  detail: string;
}[] = [
  {
    id: "ask",
    label: "Ask every time",
    detail: "Changes require approval; trusted reads may proceed.",
  },
  {
    id: "edits",
    label: "Allow file edits",
    detail: "Allow workspace edits; commands use native approval checks.",
  },
  {
    id: "auto",
    label: "Decide automatically",
    detail:
      "Native review handles routine actions and escalates risk when needed.",
  },
];
export interface WorkspaceMessage {
  /** Lossless source for a message whose transport envelope is presented as a human reply. */
  originalText?: string;
  questionReplies?: Array<{ question: string; answer: string }>;
  contextNotes?: { kind: "memory" | "history"; text: string }[];
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "thought" | "plan";
  text: string;
  at: string;
  streaming?: boolean;
  toolStatus?: string;
  toolLabel?: string;
  tool?: unknown;
  attachments?: unknown[];
  delivery?: string;
  decision?: {
    kind: "approval" | "answer" | "redirect" | "decided";
    label: string;
    about?: string;
    options?: { label: string; chosen: boolean }[];
  };
}
export interface ChatMapBranch {
  id: string;
  title: string;
  at: string;
}
export interface ChatMapTask {
  start: number;
  title: string;
  outcome?: string;
  status?: string;
  turns: number;
  files: string[];
  commands: number;
  decisions: {
    turn: number;
    kind: string;
    label: string;
    about?: string;
    options?: { label: string; chosen: boolean }[];
  }[];
  attempts: { turn: number; tried: string; why?: string }[];
  subagents: { turn: number; id: string; title: string; status: string }[];
  branches: ChatMapBranch[];
}
export interface ChatIndexTask {
  start: number;
  title: string;
  outcome?: string;
  status?: string;
  decisions?: { turn: number; decision: string; rejected?: string }[];
  attempts?: { turn: number; tried: string; why?: string }[];
}
export interface ConversationSummary {
  permissionMode?: ChatPermissionMode;
  id: string;
  title: string;
  projectId?: string;
  origin: "managed" | "agent-workspace" | "chat" | "assistant" | "imported";
  provider?: string;
  model?: string;
  effort?: ReasoningEffort;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  archived?: boolean;
  directory?: DirectoryTarget;
  nativeId?: string;
  automated?: boolean;
}
export interface ChatApproval {
  native?: boolean;
  providerRequestId?: string;
  id: string;
  taskId: string;
  kind: string;
  state: string;
  headline: string;
  details: string;
  options?: {
    id: string;
    label: string;
    description?: string;
    kind?: string;
  }[];
  questions?: {
    id: string;
    question: string;
    options: { id: string; label: string }[];
    multiSelect?: boolean;
    allowOther?: boolean;
  }[];
  preview?: unknown[];
  highRisk?: boolean;
}
export interface ConversationDetail extends ConversationSummary {
  messages: WorkspaceMessage[];
  index: ChatIndexTask[];
  indexSource: "agent-workspace" | "conversation";
  taskMap?: ChatMapTask[];
  mapOrigin?: ChatMapBranch;
  attention: ChatApproval[];
  usage?: Record<string, unknown>;
  error?: string;
  retryText?: string;
}
export interface UsageWindow {
  key: string;
  mins?: number;
  usedPercent: number;
  resetsAt?: number;
  overage?: boolean;
}
export interface ChatUsage {
  account: string;
  provider: string;
  host?: string;
  windows: UsageWindow[];
  at: string;
  plan?: string;
  source: "agent-workspace" | "deimos";
}
export interface WorkspaceChatSettings {
  sourceDirectory?: string;
  dataDirectory?: string;
  nodePath?: string;
}
export interface DirectoryChatRoot extends DirectoryTarget {
  projectId: string;
  canonicalPath: string;
  machine: string;
}
export interface ImportedConversation extends ConversationSummary {
  origin: "imported";
  projectId: string;
  nativeId: string;
  machine: string;
  sourceFile: string;
  parserVersion?: number;
  canonicalCwd: string;
  signature: string;
  importedAt: string;
  snapshot: string;
  automated?: boolean;
  warnings?: string[];
}
export interface DirectoryImportProject {
  id: string;
  name: string;
  matched: number;
  imported: number;
  updated: number;
  unchanged: number;
  empty: number;
  failed: number;
}
export interface DirectoryImportJob {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  projects: DirectoryImportProject[];
  warnings: string[];
  error?: string;
  processed: number;
  total: number;
  host?: string;
}
export interface DirectoryImportCatalog {
  version: 1;
  roots: DirectoryChatRoot[];
  sessions: Record<string, ImportedConversation>;
  lastJob?: DirectoryImportJob;
}

export interface ChatProject {
  id: string;
  name: string;
  kind: "research" | "chat";
  directory?: DirectoryTarget;
  source?: "local" | "agent-workspace";
}
export const isChatOnlyProject = (id?: string) => !!id?.startsWith("chat_");
export interface ManualChatImportCandidate {
  id: string;
  title: string;
  provider: string;
  updatedAt: string;
  automated?: boolean;
}

// Provider request identity, not the question's prose, determines whether a
// native approval/answer form must block ordinary chat input.
export function nativeChatRequest(
  item: Pick<ChatApproval, "native" | "providerRequestId">,
) {
  return !!(item.native || item.providerRequestId);
}
export function blocksChatInput(item: ChatApproval) {
  return (
    item.state === "open" &&
    nativeChatRequest(item) &&
    ["approval", "question"].includes(item.kind)
  );
}

export interface SideChatEntry {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  askedAt: string;
  answeredAt?: string;
}
