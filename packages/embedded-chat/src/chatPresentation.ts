import type { WorkspaceMessage } from "./workspaceChat";

const memoryHeader = "## Workspace memory update (provided by Agent Workspace)";
const memoryEnvelope =
  /^## Workspace memory update \(provided by Agent Workspace\)\r?\nThe user changed their saved notes since this session began\. Follow them from now on; no need to reply to this part\.\r?\n(?:- \[(?:(?:user preference|project convention|task note)(?:, updated)?|no longer applies)\] [^\r\n]*(?:\r?\n|$))+/;
const historyHeader =
  "Continue this conversation from a different saved session. The original is unchanged. Earlier conversation (may be abbreviated):";
const attachedHistory = /^<deimos-conversation-history length="(\d{1,7})">\n/;
const historyEnd = "\n</deimos-conversation-history>\n\nCurrent request:\n";

export function attachChatHistory(history: string, request: string) {
  return `<deimos-conversation-history length="${history.length}">\n${history}${historyEnd}${request}`;
}

/** Presentation only: preserve every prefix byte for inspection and continuation. */
export function presentChatMessage(
  message: WorkspaceMessage,
): WorkspaceMessage {
  if (message.role !== "user" || message.contextNotes?.length) return message;
  let text = message.text;
  const notes: NonNullable<WorkspaceMessage["contextNotes"]> = [];
  for (let i = 0; i < 8; i++) {
    const attached = attachedHistory.exec(text);
    if (attached) {
      const end = attached[0].length + Number(attached[1]);
      if (!text.slice(end).startsWith(historyEnd)) break;
      const boundary = end + historyEnd.length;
      notes.push({ kind: "history", text: text.slice(0, boundary) });
      text = text.slice(boundary);
      continue;
    }
    const memory = memoryEnvelope.exec(text);
    if (memory) {
      let end = memory[0].length;
      if (text.slice(end).startsWith("\r\n")) end += 2;
      else if (text[end] === "\n") end++;
      else if (end !== text.length) break;
      notes.push({ kind: "memory", text: text.slice(0, end) });
      text = text.slice(end);
      continue;
    }
    if (
      text.startsWith(historyHeader + "\n") ||
      text.startsWith(historyHeader + "\r\n")
    ) {
      // Legacy handoffs can themselves contain an earlier handoff. The final
      // boundary precedes the current request; the full prefix stays inspectable.
      const marker = /\r?\n\r?\nCurrent request:\r?\n/g;
      let boundary: RegExpExecArray | null,
        end = 0;
      while ((boundary = marker.exec(text)))
        end = boundary.index + boundary[0].length;
      if (!end) break;
      notes.push({ kind: "history", text: text.slice(0, end) });
      text = text.slice(end);
      continue;
    }
    break;
  }
  return notes.length ? { ...message, text, contextNotes: notes } : message;
}

export function originalChatText(message: WorkspaceMessage) {
  return (
    (message.contextNotes || []).map((note) => note.text).join("") +
    message.text
  );
}

export function isContextHeading(title: string) {
  if (typeof title !== "string") return false;
  return (
    title.startsWith('<deimos-conversation-history length="') ||
    title.startsWith(memoryHeader) ||
    title.startsWith(historyHeader.slice(0, 80))
  );
}
