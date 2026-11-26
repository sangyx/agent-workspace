import type {
  ChatIndexTask,
  ChatMapBranch,
  ChatMapTask,
  WorkspaceMessage,
} from "./workspaceChat";

// Preserve the workspace map's visual semantics using recorded structure only.
// Semantic task names/outcomes come from the existing cached grouping.
export function chatTaskMap(
  messages: WorkspaceMessage[],
  grouping: ChatIndexTask[] = [],
  forks: ChatMapBranch[] = [],
): ChatMapTask[] {
  const turns: { user: WorkspaceMessage; items: WorkspaceMessage[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ user: m, items: [m] });
    else turns.at(-1)?.items.push(m);
  }
  if (!turns.length) return [];
  const planned = (i: number) =>
    turns[i].items.some(
      (m) =>
        m.role === "plan" ||
        ["TodoWrite", "update_plan", "ExitPlanMode"].includes(
          (m.tool as any)?.name,
        ),
    );
  const valid =
    grouping.length &&
    grouping[0].start === 0 &&
    grouping.every(
      (g, i) =>
        Number.isInteger(g.start) &&
        g.start >= 0 &&
        g.start < turns.length &&
        (!i || g.start > grouping[i - 1].start),
    );
  const starts = valid ? grouping.map((g) => g.start) : [0];
  if (!valid) {
    let plan = planned(0);
    for (let i = 1; i < turns.length; i++) {
      const pause =
        Date.parse(turns[i].user.at) -
          Date.parse(turns[i - 1].items.at(-1)!.at) >=
        45 * 60000;
      if (pause || (plan && planned(i))) {
        starts.push(i);
        plan = planned(i);
      } else plan ||= planned(i);
    }
  }
  const tasks = starts.map((start, k): ChatMapTask => {
    const end = starts[k + 1] ?? turns.length;
    const g = valid ? grouping[k] : undefined;
    const task: ChatMapTask = {
      start,
      title:
        g?.title ||
        turns[start].user.text.split("\n")[0].slice(0, 110) ||
        "Attached files",
      outcome: g?.outcome,
      status: g?.status,
      turns: end - start,
      files: [],
      commands: 0,
      decisions: [],
      attempts: [],
      subagents: [],
      branches: [],
    };
    for (const d of g?.decisions || [])
      if (Number.isInteger(d.turn) && d.turn >= start && d.turn < end)
        task.decisions.push({
          turn: d.turn,
          kind: "decided",
          label: d.decision,
          about: d.rejected,
        });
    for (const a of g?.attempts || [])
      if (Number.isInteger(a.turn) && a.turn >= start && a.turn < end)
        task.attempts.push(a);
    for (let i = start; i < end; i++) {
      if (turns[i].user.delivery === "interrupt")
        task.decisions.push({
          turn: i,
          kind: "redirect",
          label: turns[i].user.text,
        });
      for (const m of turns[i].items) {
        if (m.decision) task.decisions.push({ turn: i, ...m.decision });
        const tool = m.role === "tool" ? (m.tool as any) : undefined;
        if (!tool) continue;
        if (tool.kind === "execute") task.commands++;
        for (const c of Array.isArray(tool.content) ? tool.content : [])
          if (
            c.type === "diff" &&
            c.diff?.operation !== "delete" &&
            c.diff?.path &&
            !task.files.includes(c.diff.path)
          )
            task.files.push(c.diff.path);
        if (
          ["Task", "Agent", "collabAgentToolCall", "spawn_agent"].includes(
            tool.name,
          )
        )
          task.subagents.push({
            turn: i,
            id: m.id,
            title: tool.title || m.toolLabel || tool.name,
            status:
              m.toolStatus === "failed"
                ? "failed"
                : ["completed", "done"].includes(m.toolStatus || "")
                  ? "done"
                  : "running",
          });
      }
    }
    return task;
  });
  for (const f of forks) {
    const task =
      [...tasks]
        .reverse()
        .find((t) => Date.parse(turns[t.start].user.at) <= Date.parse(f.at)) ||
      tasks[0];
    task.branches.push(f);
  }
  return tasks;
}
