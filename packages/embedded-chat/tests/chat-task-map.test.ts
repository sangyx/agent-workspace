import { expect, it } from "vitest";
import { chatTaskMap } from "../src/taskMap";
import type { WorkspaceMessage } from "../src/workspaceChat";
const m = (
  id: string,
  role: WorkspaceMessage["role"],
  extra: Partial<WorkspaceMessage> = {},
): WorkspaceMessage => ({
  id,
  role,
  text: id,
  at: "2026-11-25T10:00:00Z",
  ...extra,
});
it("retains grouped task outcomes and structured decision branches, tools and fork destinations", () => {
  const messages = [
    m("u0", "user"),
    m("cmd", "tool", { tool: { kind: "execute" } }),
    m("edit", "tool", {
      tool: {
        content: [
          { type: "diff", diff: { operation: "modify", path: "paper.tex" } },
          { type: "diff", diff: { operation: "delete", path: "old.tex" } },
        ],
      },
    }),
    m("ask", "system", {
      decision: {
        kind: "answer",
        label: "Use local",
        options: [
          { label: "Local", chosen: true },
          { label: "Remote", chosen: false },
        ],
      },
    }),
    m("agent", "tool", {
      tool: { name: "Agent", title: "Inspect citations" },
      toolStatus: "completed",
    }),
    m("u1", "user", { delivery: "interrupt" }),
    m("u2", "user"),
  ];
  const tasks = chatTaskMap(
    messages,
    [
      {
        start: 0,
        title: "Writing",
        status: "done",
        outcome: "Updated intro",
        decisions: [
          { turn: 0, decision: "Keep structure", rejected: "Full rewrite" },
          { turn: 2, decision: "Invalid outside task" },
        ],
        attempts: [{ turn: 1, tried: "Long draft", why: "Too verbose" }],
      },
      { start: 2, title: "Evaluate", status: "in_progress" },
    ],
    [
      {
        id: "fork-chat",
        title: "Evaluation branch",
        at: "2026-11-25T10:00:00Z",
      },
    ],
  );
  expect(tasks).toHaveLength(2);
  expect(tasks[0]).toMatchObject({
    title: "Writing",
    turns: 2,
    files: ["paper.tex"],
    commands: 1,
    status: "done",
    outcome: "Updated intro",
  });
  expect(tasks[0].decisions.map((d) => d.kind)).toEqual([
    "decided",
    "answer",
    "redirect",
  ]);
  expect(tasks[0].decisions[1].options?.[1]).toEqual({
    label: "Remote",
    chosen: false,
  });
  expect(tasks[0].attempts[0].why).toBe("Too verbose");
  expect(tasks[0].subagents[0]).toMatchObject({
    id: "agent",
    title: "Inspect citations",
    turn: 0,
    status: "done",
  });
  expect(tasks[1].branches[0].id).toBe("fork-chat");
});
it("uses structural task boundaries without inventing outcomes and rejects invalid grouping", () => {
  const messages = [
    m("u0", "user"),
    m("plan", "plan"),
    m("u1", "user"),
    m("u2", "user"),
    m("plan2", "plan"),
    m("u3", "user", { at: "2026-11-25T11:00:00Z" }),
  ];
  const tasks = chatTaskMap(messages, [
    { start: 3, title: "Bad first boundary" },
  ]);
  expect(tasks.map((t) => [t.start, t.turns])).toEqual([
    [0, 2],
    [2, 1],
    [3, 1],
  ]);
  expect(tasks.every((t) => !t.status && !t.outcome)).toBe(true);
  expect(chatTaskMap([])).toEqual([]);
});
