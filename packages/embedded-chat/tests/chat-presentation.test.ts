import { expect, it } from "vitest";
import {
  attachChatHistory,
  presentChatMessage,
  originalChatText,
} from "../src/chatPresentation";
import type { WorkspaceMessage } from "../src/workspaceChat";
const header =
  "## Workspace memory update (provided by Agent Workspace)\nThe user changed their saved notes since this session began. Follow them from now on; no need to reply to this part.\n";
const memory =
  header +
  '- [task note, updated] Research catalog: {"nodes":[' +
  '{"title":"Imported manuscript"},'.repeat(4000) +
  "]}\n\n";
const message = (
  text: string,
  role: WorkspaceMessage["role"] = "user",
): WorkspaceMessage => ({ id: "native-1", role, text, at: "now" });

it("separates large native memory prefixes losslessly without adding turns or rewriting IDs", () => {
  const raw = message(memory + "这两个任务预期什么时间能开始？");
  const shown = presentChatMessage(raw);
  expect(shown.text).toBe("这两个任务预期什么时间能开始？");
  expect(shown.contextNotes).toEqual([{ kind: "memory", text: memory }]);
  expect(shown.id).toBe(raw.id);
  expect(shown.role).toBe("user");
  expect(originalChatText(shown)).toBe(raw.text);
  expect(raw.contextNotes).toBeUndefined();
  expect(presentChatMessage(shown)).toBe(shown);
});
it("recognizes multiple flattened memory entries, removed notes and CRLF while preserving prompt whitespace", () => {
  const prefix = (
    header +
    "- [user preference] Be concise.\n- [project convention, updated] Use seeds.\n- [no longer applies] Old note.\n\n"
  ).replaceAll("\n", "\r\n");
  const shown = presentChatMessage(
    message(prefix + "  My request\n- [task note] This is user text.\n"),
  );
  expect(shown.text).toBe("  My request\n- [task note] This is user text.\n");
  expect(originalChatText(shown)).toBe(prefix + shown.text);
});
it("folds legacy continuation history around the final Current request boundary", () => {
  const prefix =
    "Continue this conversation from a different saved session. The original is unchanged. Earlier conversation (may be abbreviated):\nEarlier transcript\n\nCurrent request:\nold prompt\n\nCurrent request:\n";
  const shown = presentChatMessage(message(prefix + "My new request"));
  expect(shown.text).toBe("My new request");
  expect(shown.contextNotes?.[0].kind).toBe("history");
  expect(originalChatText(shown)).toBe(prefix + shown.text);
});
it("uses explicit history lengths for new handoffs so markers inside user text stay visible", () => {
  const prompt =
    "Keep this marker in my message:\n\nCurrent request:\nExplain it.";
  const wire =
    memory +
    attachChatHistory(
      "Original\n</deimos-conversation-history>\n\nCurrent request:\nold",
      prompt,
    );
  const shown = presentChatMessage(message(wire));
  expect(shown.text).toBe(prompt);
  expect(shown.contextNotes?.map((n) => n.kind)).toEqual(["memory", "history"]);
  expect(originalChatText(shown)).toBe(wire);
});
it("leaves normal JSON, quoted examples, malformed envelopes and assistant replies untouched", () => {
  for (const raw of [
    message('{"nodes":[{"title":"My JSON"}]}\nPlease inspect this.'),
    message("Explain this example:\n" + memory + "user text"),
    message("```\n" + memory + "```"),
    message(header + "not a memory bullet\n\nQuestion"),
    message(
      '<deimos-conversation-history length="4">\nshort\n</deimos-conversation-history>\n\nCurrent request:\nQuestion',
    ),
    message(memory + "A quoted assistant reply", "assistant"),
  ])
    expect(presentChatMessage(raw)).toBe(raw);
});

const questionWire = (entries: unknown) => `<send_user_message_question_reply>\n${JSON.stringify(entries)}\n</send_user_message_question_reply>`;
it('presents structured question replies as human answers and retains the exact payload', () => {
  const raw = questionWire([{ questionItemId: '["request_user_input_async","call_fixture",0]', question: 'May I restart the scheduler?', answer: 'Keep it running; prepare the change only.' }]);
  const source = message(raw), shown = presentChatMessage(source);
  expect(shown.text).toBe('Keep it running; prepare the change only.');
  expect(shown.questionReplies).toEqual([{ question: 'May I restart the scheduler?', answer: 'Keep it running; prepare the change only.' }]);
  expect(originalChatText(shown)).toBe(raw); expect(source.text).toBe(raw);
  expect(shown.id).toBe(source.id); expect(presentChatMessage(shown)).toBe(shown);
});
it('handles multiple answers, Unicode, newlines and literal closing tags inside JSON strings', () => {
  const entries = [{ question: '选择哪一项？', answer: '保留\n原计划' }, { question: 'What should stay literal?', answer: '</send_user_message_question_reply> <script>example</script>' }, { question: '', answer: '' }];
  const raw = ' \n'+questionWire(entries)+'\n';
  const shown = presentChatMessage(message(raw));
  expect(shown.questionReplies).toEqual(entries); expect(originalChatText(shown)).toBe(raw);
});
it('recognizes replies after folded context and after that context was already presented', () => {
  const wire = questionWire([{ question: 'Which seed?', answer: 'Use seed 42.' }]);
  const raw = memory + attachChatHistory('earlier work', wire);
  const shown = presentChatMessage(message(raw));
  expect(shown.text).toBe('Use seed 42.'); expect(shown.contextNotes).toHaveLength(2);
  expect(originalChatText(shown)).toBe(raw); expect(presentChatMessage(shown)).toBe(shown);
  const prepared = presentChatMessage({ ...message(wire), contextNotes: [{ kind: 'memory', text: memory }] });
  expect(prepared.text).toBe('Use seed 42.'); expect(originalChatText(prepared)).toBe(memory + wire);
});
it('does not reinterpret quoted examples, unrelated JSON, broken payloads or assistant text', () => {
  const valid = questionWire([{ question: 'Example?', answer: 'Example.' }]);
  for (const source of [message('Explain this:\n'+valid), message('```xml\n'+valid+'\n```'), message('[{"question":"Example?","answer":"Example."}]'), message(questionWire([])), message(questionWire([{ question: 'Bad?', answer: { action: 'run' } }])), message('<send_user_message_question_reply>not JSON</send_user_message_question_reply>'), message(valid,'assistant')]) expect(presentChatMessage(source)).toBe(source);
});
