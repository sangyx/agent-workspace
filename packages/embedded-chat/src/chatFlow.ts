import { nativeChatRequest, type ChatApproval } from "./workspaceChat";
import type { WorkspaceMessage } from "./workspaceChat";

// Polling produces fresh JSON objects even when nothing changed. Retain old
// identities so only new/changed transcript rows are rendered again.
export function reconcileChatMessages(
  previous: WorkspaceMessage[] | undefined,
  incoming: WorkspaceMessage[],
) {
  if (!previous) return incoming;
  const byId = new Map(previous.map((item) => [item.id, item]));
  const next = incoming.map((item) => {
    const old = byId.get(item.id);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  return previous.length === next.length &&
    next.every((item, i) => item === previous[i])
    ? previous
    : next;
}

// The agent's own prose already contains its question. Show only its latest
// unanswered follow-up; retain every native request and error for review.
export function visibleChatRequests(items: ChatApproval[]) {
  const open = items.filter(
    (item) => item.state === "open" && item.kind !== "completion",
  );
  const ordinary = (item: ChatApproval) =>
    item.kind === "question" && !nativeChatRequest(item);
  const latest = open.filter(ordinary).at(-1);
  return open.filter((item) => !ordinary(item) || item === latest);
}
