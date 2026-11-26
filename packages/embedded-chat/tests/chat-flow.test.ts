import { expect, it } from "vitest";
import { visibleChatRequests, reconcileChatMessages } from "../src/chatFlow";
import type { ChatApproval, WorkspaceMessage } from "../src/workspaceChat";
const question = (
  id: string,
  other: Partial<ChatApproval> = {},
): ChatApproval => ({
  id,
  taskId: "chat",
  kind: "question",
  state: "open",
  headline: "May I check?",
  details: "May I check?",
  ...other,
});
it("collapses old prose questions without hiding native requests or errors", () => {
  const items = [
    question("old"),
    question("approval", { kind: "approval", providerRequestId: "native-1" }),
    question("native-question", { providerRequestId: "native-2" }),
    question("error", { kind: "error" }),
    question("new"),
    question("done", { kind: "completion" }),
    question("resolved", { state: "resolved" }),
  ];
  expect(visibleChatRequests(items).map((item) => item.id)).toEqual([
    "approval",
    "native-question",
    "error",
    "new",
  ]);
  expect(items).toHaveLength(7);
});
it("keeps a still-open conversational ask when newer questions have been resolved", () => {
  expect(
    visibleChatRequests([
      question("waiting"),
      question("resolved", { state: "resolved" }),
    ]).map((item) => item.id),
  ).toEqual(["waiting"]);
  expect(visibleChatRequests([])).toEqual([]);
});
it("reuses unchanged polling messages but shows streaming, tool and decision updates", () => {
  const previous: WorkspaceMessage[] = [
    { id: "user", role: "user", text: "Run the fixture", at: "now" },
    {
      id: "reply",
      role: "assistant",
      text: "Checking",
      at: "now",
      streaming: true,
    },
    {
      id: "tool",
      role: "tool",
      text: "",
      at: "now",
      toolStatus: "running",
      tool: { command: "fixture" },
    },
  ];
  expect(reconcileChatMessages(previous, structuredClone(previous))).toBe(
    previous,
  );
  const next = structuredClone(previous);
  next[1].text = "Checked";
  next[1].streaming = false;
  next[2].toolStatus = "completed";
  next[2].tool = { command: "fixture", exitCode: 0 };
  const updated = reconcileChatMessages(previous, next);
  expect(updated[0]).toBe(previous[0]);
  expect(updated[1]).toBe(next[1]);
  expect(updated[2]).toBe(next[2]);
  next[0] = { ...next[0], decision: { kind: "decided", label: "Denied" } };
  expect(reconcileChatMessages(previous, next)[0]).toBe(next[0]);
});
it("preserves incoming order and removals without resurrecting old messages", () => {
  const old: WorkspaceMessage[] = [
    { id: "a", role: "user", text: "a", at: "now" },
    { id: "b", role: "assistant", text: "b", at: "now" },
  ];
  expect(reconcileChatMessages(old, [{ ...old[1] }, { ...old[0] }])).toEqual([
    old[1],
    old[0],
  ]);
  expect(reconcileChatMessages(old, [])).toEqual([]);
  const first = [{ ...old[0] }];
  expect(reconcileChatMessages(undefined, first)).toBe(first);
});
