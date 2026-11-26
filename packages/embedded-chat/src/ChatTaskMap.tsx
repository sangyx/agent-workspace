import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChatMapBranch, ChatMapTask } from "./workspaceChat";
import { Icon, useChatHost } from "./host";

const colors = [
  "#59616b",
  "#4d6e95",
  "#775b8e",
  "#8b622c",
  "#95576d",
  "#5c7446",
  "#a15543",
  "#5967a0",
  "#337386",
  "#776a46",
  "#7b5767",
  "#5e626f",
];
export function ChatTaskMiniMap({
  tasks,
  current,
  onOpen,
}: {
  tasks: ChatMapTask[];
  current: number | null;
  onOpen: () => void;
}) {
  const { tx } = useChatHost();
  return (
    <button
      className="chat-task-minimap"
      aria-label={tx("Open task index")}
      title={tx("Task index")}
      onClick={onOpen}
    >
      {tasks.map((task, i) => (
        <span
          key={task.start}
          className={
            "chat-mini-task" + (current === task.start ? " current" : "")
          }
          data-status={task.status || "unknown"}
          style={{ "--task-color": colors[i % colors.length] } as CSSProperties}
        >
          <span className="chat-mini-node" />
          {!!task.decisions.length && (
            <span className="chat-mini-decisions">
              {task.decisions.slice(0, 3).map((_, j) => (
                <span key={j} />
              ))}
            </span>
          )}
        </span>
      ))}
    </button>
  );
}
export function ChatTaskMap({
  tasks,
  current,
  origin,
  onJump,
  onOpen,
}: {
  tasks: ChatMapTask[];
  current: number | null;
  origin?: ChatMapBranch;
  onJump: (turn: number) => void;
  onOpen: (id: string) => void;
}) {
  const { tx } = useChatHost();
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const root = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = root.current?.querySelector<HTMLElement>(".current");
    const box = root.current?.parentElement;
    if (!node || !box) return;
    const b = box.getBoundingClientRect(),
      n = node.getBoundingClientRect();
    if (n.top < b.top + 24 || n.top + Math.min(n.height, 80) > b.bottom - 24)
      box.scrollTo({
        top: box.scrollTop + n.top - b.top - box.clientHeight / 3,
        behavior: "smooth",
      });
  }, [current, tasks.length]);
  return (
    <ol className="chat-session-map" aria-label={tx("Task index")} ref={root}>
      {origin && (
        <li className="cmap-origin">
          <button onClick={() => onOpen(origin.id)}>
            <span className="cmap-lane" aria-hidden />
            {tx("Forked from")}: {origin.title}
          </button>
        </li>
      )}
      {tasks.map((task, i) => {
        const active = current === task.start,
          open = !folded.has(task.start);
        const count =
          task.decisions.length +
          task.attempts.length +
          task.subagents.length +
          task.branches.length;
        return (
          <li
            key={task.start}
            className={`cmap-task${active ? " current" : ""}${i === tasks.length - 1 ? " last" : ""}`}
            data-start={task.start}
            data-status={task.status || "unknown"}
            style={
              { "--task-color": colors[i % colors.length] } as CSSProperties
            }
          >
            <span className="cmap-node" aria-hidden>
              {task.status === "done" && <Icon name="check" size={8} />}
            </span>
            <div className="cmap-head">
              <button
                className="cmap-title"
                aria-current={active ? "step" : undefined}
                onClick={() => onJump(task.start)}
              >
                {task.title}
              </button>
              {!!(count || task.outcome) && (
                <button
                  className="cmap-toggle"
                  aria-label={tx(open ? "Fold task" : "Unfold task")}
                  aria-expanded={open}
                  onClick={() =>
                    setFolded((prev) => {
                      const next = new Set(prev);
                      next.has(task.start)
                        ? next.delete(task.start)
                        : next.add(task.start);
                      return next;
                    })
                  }
                >
                  {open ? "⌄" : "›"}
                </button>
              )}
            </div>
            <div className="cmap-meta">
              {task.status === "in_progress" && (
                <span className="cmap-state">{tx("In progress")}</span>
              )}
              {task.status === "abandoned" && <span>{tx("Dropped")} · </span>}
              {task.turns} {tx(task.turns === 1 ? "turn" : "turns")}
              {!!task.files.length && (
                <span title={task.files.join("\n")}>
                  {" "}
                  · {task.files.length}{" "}
                  {tx(task.files.length === 1 ? "file" : "files")}
                </span>
              )}
              {!!task.commands && (
                <span>
                  {" "}
                  · {task.commands}{" "}
                  {tx(task.commands === 1 ? "command" : "commands")}
                </span>
              )}
            </div>
            {open ? (
              <>
                {task.outcome && <p className="cmap-outcome">{task.outcome}</p>}
                {task.decisions.map((d, j) => (
                  <div key={j} className="cmap-decision">
                    <span className="cmap-diamond" aria-hidden />
                    <div>
                      <button onClick={() => onJump(d.turn)} title={d.about}>
                        {d.kind === "approval"
                          ? tx("Allowed") + ": "
                          : d.kind === "redirect"
                            ? tx("Changed course") + ": "
                            : ""}
                        {d.label}
                      </button>
                      {d.kind === "approval" && (
                        <div className="cmap-options">
                          {d.options?.map((o, k) => (
                            <span key={k} className={o.chosen ? "chosen" : ""}>
                              {o.chosen && "✓ "}
                              {o.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {(d.kind === "decided" && d.about
                        ? [d.about]
                        : d.kind === "answer"
                          ? d.options
                              ?.filter((o) => !o.chosen)
                              .map((o) => o.label) || []
                          : []
                      ).map((alt, k) => (
                        <div className="cmap-not-taken" key={k}>
                          <span className="cmap-lane dead" aria-hidden />
                          <span className="cmap-end" aria-hidden />
                          {alt}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {task.subagents.map((a) => (
                  <button
                    className="cmap-branch subagent"
                    data-status={a.status}
                    key={a.id}
                    onClick={() => onJump(a.turn)}
                  >
                    <span className="cmap-lane" aria-hidden />
                    <Icon name="graph" size={12} />
                    <span>{a.title}</span>
                  </button>
                ))}
                {task.attempts.map((a, j) => (
                  <button
                    className="cmap-branch cmap-attempt"
                    key={j}
                    onClick={() => onJump(a.turn)}
                  >
                    <span className="cmap-lane dead" aria-hidden />
                    <span className="cmap-cross" aria-hidden>
                      ×
                    </span>
                    <span>
                      <s>{a.tried}</s>
                      {a.why && <small>{a.why}</small>}
                    </span>
                  </button>
                ))}
                {task.branches.map((b) => (
                  <button
                    className="cmap-branch"
                    key={b.id}
                    onClick={() => onOpen(b.id)}
                  >
                    <span className="cmap-lane" aria-hidden />
                    <Icon name="chat" size={12} />
                    <span>{b.title}</span>
                  </button>
                ))}
              </>
            ) : (
              <div className="cmap-folded">
                {count} {tx("branches")}{" "}
                {task.outcome ? "· " + task.outcome : ""}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
