import { SideChatPanel, type SideQuestion } from "./SideChatPanel";
import { ChatTaskMap, ChatTaskMiniMap } from "./ChatTaskMap";
import { ChatFilePreview } from "./ChatFilePreview";
import { ChatMarkdown, ChatPreviewContext } from "./ChatMarkdown";
import { ChatContextNote } from "./ChatContextNote";
import {
  isChatOnlyProject,
  nativeChatRequest,
  blocksChatInput,
  chatPermissionModes,
  defaultChatPermission,
  type ChatProject,
  type ConversationDetail,
  type ChatApproval,
  type WorkspaceMessage,
  type ChatPermissionMode,
} from "./workspaceChat";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DirectoryTarget, ChatSettings as Settings } from "./contracts";
import { useChatHost, Icon } from "./host";
import { visibleChatRequests, reconcileChatMessages } from "./chatFlow";
function ToolPreview({ value }: { value: unknown }) {
  const { tx } = useChatHost();
  if (!value) return null;
  if (Array.isArray(value))
    return (
      <>
        {value.map((v, i) => (
          <ToolPreview key={i} value={v} />
        ))}
      </>
    );
  if (typeof value === "object") {
    const v = value as any;
    if (v.type === "diff" && v.diff) {
      const d = v.diff;
      return (
        <div className="chat-file-diff">
          <div>
            {d.path}{" "}
            <span>
              +{d.added || 0} −{d.removed || 0}
            </span>
          </div>
          <pre>
            {d.hunks
              ?.flatMap((h: any) => h.lines || [])
              .map((line: string, i: number) => (
                <span
                  key={i}
                  className={
                    line.startsWith("+")
                      ? "diff-added"
                      : line.startsWith("-")
                        ? "diff-removed"
                        : ""
                  }
                >
                  {line}
                  {"\n"}
                </span>
              ))}
          </pre>
        </div>
      );
    }
    if (v.type === "terminal")
      return (
        <div className="chat-command-preview">
          {v.cwd && <small>{v.cwd}</small>}
          {v.command && <pre>$ {v.command}</pre>}
          {v.output && <pre>{v.output}</pre>}
          {v.exitCode !== undefined && (
            <small>
              {tx("Exit code")}: {v.exitCode}
            </small>
          )}
        </div>
      );
    if (v.type === "content" && v.content?.text)
      return <pre className="chat-tool-preview">{v.content.text}</pre>;
    if (v.type === "text" || v.text)
      return <pre className="chat-tool-preview">{v.text}</pre>;
    if (v.content) return <ToolPreview value={v.content} />;
  }
  return (
    <pre className="chat-tool-preview">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
function ApprovalCard({
  item,
  onRespond,
  disabled,
  onReply,
}: {
  item: ChatApproval;
  onRespond: (decision?: string, answers?: Record<string, string>) => void;
  disabled: boolean;
  onReply: () => void;
}) {
  const { tx } = useChatHost();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const formId = useId();
  if (!nativeChatRequest(item))
    return (
      <section
        className="chat-question"
        role="group"
        aria-label={item.headline}
      >
        <div className="row">
          <Icon name="chat" size={17} />
          <strong>
            {item.kind === "question"
              ? tx("Waiting for your reply")
              : item.headline}
          </strong>
        </div>
        {item.kind !== "question" && item.details && (
          <ChatMarkdown>{item.details}</ChatMarkdown>
        )}
        <div className="row">
          <button onClick={onReply} disabled={disabled}>
            {tx("Reply")}
          </button>
        </div>
      </section>
    );
  return (
    <section
      className={"chat-approval " + (item.highRisk ? "high-risk" : "")}
      role="group"
      aria-label={item.headline}
    >
      <div className="chat-request-heading">
        <Icon
          name={
            item.highRisk
              ? "alert"
              : item.kind === "question"
                ? "chat"
                : "shield"
          }
          size={17}
        />
        <div>
          <small>
            {tx(
              item.kind === "question"
                ? "Answer required"
                : "Approval required",
            )}
          </small>
          <strong>{item.headline}</strong>
        </div>
      </div>
      <div
        className="chat-request-body"
        tabIndex={0}
        aria-label={tx("Request details")}
      >
        {item.highRisk && (
          <p>{tx("Review this action carefully before approving.")}</p>
        )}
        {item.details && !item.preview?.length && <pre>{item.details}</pre>}
        <ToolPreview value={item.preview} />
        {!!item.questions?.length && (
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              onRespond(undefined, answers);
            }}
          >
            {item.questions.map((q) => (
              <label key={q.id}>
                {q.question}
                {q.options.length > 0 && !q.multiSelect && (
                  <select
                    value={answers[q.id] || ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                  >
                    <option value="">{tx("Choose an answer")}</option>
                    {q.options.map((o) => (
                      <option key={o.id} value={o.label}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {(q.allowOther || !q.options.length || q.multiSelect) && (
                  <input
                    value={answers[q.id] || ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                    aria-label={q.question}
                  />
                )}
              </label>
            ))}
          </form>
        )}
      </div>
      <div className="chat-approval-options">
        {item.questions?.length ? (
          <button
            type="submit"
            form={formId}
            disabled={
              disabled || item.questions.some((q) => !answers[q.id]?.trim())
            }
          >
            {tx("Submit answers")}
          </button>
        ) : (
          <>
            {item.options?.map((o) => (
              <button
                key={o.id}
                disabled={disabled}
                title={o.description}
                className={o.kind?.startsWith("reject") ? "" : "primary"}
                onClick={() => onRespond(o.id)}
              >
                {o.label}
              </button>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
const Message = memo(function Message({ m }: { m: WorkspaceMessage }) {
  const { tx } = useChatHost();
  const [copied, setCopied] = useState(false);
  return (
    <article
      id={"chat-message-" + m.id}
      className={
        "chat-message chat-role-" +
        m.role +
        (m.contextNotes?.length ? " chat-has-context" : "")
      }
    >
      {["tool", "thought", "system", "plan"].includes(m.role) ? (
        <details className="chat-activity">
          <summary>
            <Icon
              name={
                m.role === "tool"
                  ? "code"
                  : m.role === "plan"
                    ? "outline"
                    : "info"
              }
              size={15}
            />
            {m.toolLabel ||
              tx(
                m.role === "thought"
                  ? "Thinking"
                  : m.role === "tool"
                    ? "Tool activity"
                    : m.role === "plan"
                      ? "Plan"
                      : "Session note",
              )}
            {m.toolStatus && <small>{m.toolStatus}</small>}
          </summary>
          <div className="chat-activity-body">
            <ToolPreview value={m.text} />
            <ToolPreview value={m.tool} />
          </div>
        </details>
      ) : (
        <>
          {!!m.contextNotes?.length && (
            <ChatContextNote notes={m.contextNotes} />
          )}
          <div className="chat-message-body">
            <ChatMarkdown>{m.text}</ChatMarkdown>
            {m.attachments?.map((a: any, i) => (
              <span className="chat-file-label" key={a.id || i}>
                <Icon name="paperclip" size={13} />
                {a.name || "Attached image"}
              </span>
            ))}
            {m.streaming && <span className="chat-stream-caret" />}
          </div>
          {["assistant", "user"].includes(m.role) && m.text && (
            <button
              className="chat-copy quiet"
              aria-label={tx("Copy")}
              title={tx("Copy")}
              onClick={() =>
                void navigator.clipboard.writeText(m.text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Icon name={copied ? "check" : "paper"} size={14} />
            </button>
          )}
        </>
      )}
    </article>
  );
});
const ConversationMessages = memo(function ConversationMessages({
  messages,
}: {
  messages: WorkspaceMessage[];
}) {
  const { tx } = useChatHost();
  const groups: { messages: WorkspaceMessage[]; work: boolean }[] = [];
  for (const message of messages) {
    const work = !["user", "assistant"].includes(message.role);
    const previous = groups.at(-1);
    if (work && previous?.work) previous.messages.push(message);
    else groups.push({ messages: [message], work });
  }
  return (
    <>
      {groups.map((group) =>
        group.work ? (
          <details
            className="chat-work-details"
            key={group.messages[0].id}
            open={
              group.messages.some(
                (m) => m.streaming || m.toolStatus === "running",
              )
                ? true
                : undefined
            }
          >
            <summary>
              {tx("Work details")} <Icon name="chevron" size={12} />
              <span>
                {group.messages.filter((m) => m.role === "tool").length || ""}
              </span>
            </summary>
            <div>
              {group.messages.map((m) => (
                <Message key={m.id} m={m} />
              ))}
            </div>
          </details>
        ) : (
          <Message key={group.messages[0].id} m={group.messages[0]} />
        ),
      )}
    </>
  );
});
export function ChatPage({ pid, id }: { pid?: string; id?: string }) {
  const {
    api,
    tx,
    navigate,
    copyText,
    hideAssistant,
    chatChanged,
    newChatProject,
    importChat,
    renameChatProject,
    renameConversation,
    archiveConversation,
    openContextMenu,
    toggleSidebar,
    useSidebarVisible,
    usePromptAI,
    draftKey,
    transientKey,
    events,
    Header: WorkspacePageHeader,
    Composer: PromptComposer,
    AIControls: PromptAIControls,
    DirectoryPicker,
    SidebarPaneControls,
  } = useChatHost();
  const ai = usePromptAI(),
    input = useRef<HTMLTextAreaElement>(null),
    controlsMenu = useRef<HTMLDetailsElement>(null),
    requestsPane = useRef<HTMLElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    jumpedAt = useRef(0),
    lock = useRef(false);
  const [detail, setDetail] = useState<ConversationDetail>(),
    [settings, setSettings] = useState<Settings>(),
    [provider, setProvider] = useState(""),
    [permissionMode, setPermissionMode] = useState<ChatPermissionMode>("auto"),
    [project, setProject] = useState(pid || ""),
    [projects, setProjects] = useState<ChatProject[]>([]),
    [directory, setDirectory] = useState<DirectoryTarget>(),
    [editDirectory, setEditDirectory] = useState(false),
    [message, setMessage] = useState(
      () => localStorage.getItem(draftKey(id, pid)) || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(!!id),
    [limit, setLimit] = useState(80),
    [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState(""),
    [currentTask, setCurrentTask] = useState<number | null>(null);
  const [previewHref, setPreviewHref] = useState<string>();
  const openPreview = useCallback((href: string) => {
    hideAssistant();
    setSideChat(false);
    setPreviewHref(href);
    toggleSidebar("right", true);
  }, []);
  const [sideBusy, setSideBusy] = useState(false);
  const [sideChat, setSideChat] = useState(false),
    [sideQuestion, setSideQuestion] = useState<SideQuestion>();
  useEffect(() => {
    setSideChat(false);
    setPreviewHref(undefined);
    setSideQuestion(undefined);
  }, [id]);
  const openSideChat = (text: string) => {
    if (!id || detail?.origin !== "managed") return;
    hideAssistant();
    setSideChat(true);
    setPreviewHref(undefined);
    toggleSidebar("right", true);
    if (text.trim()) {
      setSideQuestion({ id: Date.now(), text: text.trim() });
      setMessage("");
    } else setSideQuestion(undefined);
  };
  const rightVisible = useSidebarVisible("right");
  useEffect(() => {
    const frame = requestAnimationFrame(() => toggleSidebar("right", true));
    return () => cancelAnimationFrame(frame);
  }, [id]);
  useEffect(() => {
    const archived = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v.id === id && v.archived)
        void navigate(project || undefined, "chat");
    };
    window.addEventListener(events.archived, archived);
    return () => window.removeEventListener(events.archived, archived);
  }, [id, project]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (
        controlsMenu.current?.open &&
        !controlsMenu.current.contains(e.target as Node)
      )
        controlsMenu.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && controlsMenu.current?.open) {
        controlsMenu.current.open = false;
        controlsMenu.current.querySelector("summary")?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem(draftKey(id, pid), message);
  }, [message, id, pid]);
  useEffect(() => {
    let alive = true;
    void api<Settings>(
      project ? `/chat/projects/${project}/settings` : "/settings?scope=global",
    )
      .then((s) => {
        if (alive) {
          setSettings(s);
          if (!id || !initialised.current) {
            setProvider(
              s.taskProfiles?.chat?.providerId || s.defaultProviderId || "",
            );
            if (!id)
              setPermissionMode(
                defaultChatPermission(
                  s.providers.find(
                    (p) =>
                      p.id ===
                      (s.taskProfiles?.chat?.providerId || s.defaultProviderId),
                  )?.engine,
                ),
              );
          }
        }
      })
      .catch((e) => setError(e.message));
    const loadProjects = () =>
      void api("/chat")
        .then((d) => {
          if (alive) setProjects(d.projects);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    loadProjects();
    window.addEventListener(events.chatsUpdated, loadProjects);
    return () => {
      alive = false;
      window.removeEventListener(events.chatsUpdated, loadProjects);
    };
  }, [project]);
  useEffect(() => {
    if (!id) return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const d = await api<ConversationDetail>("/chat/" + id);
        if (alive) {
          setDetail((previous) => ({
            ...d,
            messages: reconcileChatMessages(
              previous?.id === d.id ? previous.messages : undefined,
              d.messages,
            ),
          }));
          setProject(d.projectId || "");
          setLoading(false);
        }
      } catch (e: any) {
        if (alive) {
          setError(e.message);
          setLoading(false);
        }
      }
      if (alive) timer = setTimeout(load, 2000);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (detail && !renaming) setTitle(detail.title);
  }, [detail?.title, renaming]);
  useEffect(() => {
    setPermissionMode(
      detail?.origin === "managed"
        ? detail.permissionMode || "ask"
        : defaultChatPermission(
            settings?.providers.find((p) => p.id === provider)?.engine,
          ),
    );
  }, [detail?.id, detail?.permissionMode]);
  const initialised = useRef(false);
  useEffect(() => {
    if (!detail || !settings || initialised.current) return;
    initialised.current = true;
    const p = settings.providers.find(
      (p) => p.engine === detail.provider || p.id === detail.provider,
    );
    if (p && ["claude", "codex", "gemini", "antigravity"].includes(p.engine))
      setProvider(p.id);
    if (detail.origin !== "managed")
      setPermissionMode(defaultChatPermission(p?.engine));
    ai.controls.onChange(
      p && ["claude", "codex", "gemini", "antigravity"].includes(p.engine)
        ? { model: detail.model, effort: detail.effort || "default" }
        : {},
    );
  }, [detail, settings]);
  const last = detail?.messages.at(-1);
  const displayedMessages = useMemo(
    () => detail?.messages.slice(-limit) || [],
    [detail?.messages, limit],
  );
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [last?.id, last?.text, detail?.attention.length]);
  useEffect(() => {
    const pane = scroll.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(pane);
    if (pane.firstElementChild) observer.observe(pane.firstElementChild);
    return () => observer.disconnect();
  }, [id]);
  const live = detail?.origin === "managed",
    running = !!detail && ["starting", "running"].includes(detail.status),
    pending = !!detail?.attention.some(blocksChatInput),
    selected = settings?.providers.find((p) => p.id === provider),
    changing = !!detail && live && selected?.engine !== detail.provider;
  const requests = visibleChatRequests(detail?.attention || []);
  const requestIds = requests.map((item) => item.id).join("|");
  useLayoutEffect(() => {
    if (requestsPane.current) requestsPane.current.scrollTop = 0;
  }, [requestIds]);
  const focusComposer = () => {
    const element = input.current;
    if (!element) return;
    element
      .closest(".chat-composer-region")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    element.focus({ preventScroll: true });
  };
  const action = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (id) setDetail(await api("/chat/" + id));
      chatChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = () => {
    if (!message.trim() || !ai.ready || lock.current || pending) return;
    if ((!id || !live || changing) && !project) {
      setError(tx("Choose a project before starting a conversation."));
      return;
    }
    const text = message;
    void action(async () => {
      const fresh = !id || !live || changing;
      if (fresh) {
        const result = await api("/chat", "POST", {
          text,
          projectId: project || undefined,
          directory: directory || detail?.directory,
          continueFrom: id,
          providerId: provider,
          permissionMode,
          ...ai.options,
        });
        setMessage("");
        localStorage.removeItem(draftKey(id, pid));
        ai.controls.onChange({});
        chatChanged();
        if (result.sendError) {
          sessionStorage.setItem(
            transientKey("error", result.id),
            result.sendError,
          );
          sessionStorage.setItem(transientKey("retry", result.id), text);
        }
        await navigate(project || undefined, "chat", result.id);
      } else {
        await api("/chat/" + id + "/send", "POST", {
          text,
          providerId: provider,
          ...ai.options,
        });
        setMessage("");
        ai.controls.onChange({ ...ai.options, attachmentIds: [] });
        follow.current = true;
      }
    });
  };
  useEffect(() => {
    if (id) {
      const e = sessionStorage.getItem(transientKey("error", id));
      if (e) {
        setError(e);
        sessionStorage.removeItem(transientKey("error", id));
        const draft = sessionStorage.getItem(transientKey("retry", id));
        if (draft) {
          setMessage(draft);
          sessionStorage.removeItem(transientKey("retry", id));
        }
      }
    }
  }, [id]);
  const trackCurrentTask = () => {
    const box = scroll.current;
    if (!box || !detail?.taskMap?.length) return;
    if (Date.now() - jumpedAt.current < 900) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 40) {
      setCurrentTask(detail.taskMap.at(-1)!.start);
      return;
    }
    const top = box.getBoundingClientRect().top + box.clientHeight * 0.4;
    const users = detail.messages.filter((m) => m.role === "user");
    let turn = 0;
    users.forEach((user, i) => {
      const node = document.getElementById("chat-message-" + user.id);
      if (node && node.getBoundingClientRect().top <= top) turn = i;
    });
    // The transcript renders only its tail until earlier messages are requested.
    const first = users.findIndex((user) =>
      document.getElementById("chat-message-" + user.id),
    );
    turn = Math.max(turn, first);
    setCurrentTask(
      [...detail.taskMap].reverse().find((t) => t.start <= turn)?.start ?? null,
    );
  };
  useEffect(() => {
    const frame = requestAnimationFrame(trackCurrentTask);
    return () => cancelAnimationFrame(frame);
  }, [detail?.messages.length, limit, detail?.taskMap?.length]);
  const jump = (turn: number) => {
    const user = detail?.messages.filter((m) => m.role === "user")[turn];
    if (!user) return;
    jumpedAt.current = Date.now();
    setCurrentTask(
      [...(detail!.taskMap || [])].reverse().find((t) => t.start <= turn)
        ?.start ?? null,
    );
    setLimit(detail!.messages.length);
    follow.current = false;
    requestAnimationFrame(() =>
      document
        .getElementById("chat-message-" + user.id)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };
  const update = async (change: Record<string, unknown>) => {
    await api("/chat/" + id, "PATCH", change);
    chatChanged();
    if (change.archived) await navigate(project || undefined, "chat");
    else if ("projectId" in change)
      await navigate(
        typeof change.projectId === "string" ? change.projectId : undefined,
        "chat",
        id,
      );
  };
  return (
    <main
      className="chat-page"
      onContextMenu={(e) => {
        if (
          (e.target as Element).closest(
            'input,textarea,[contenteditable="true"]',
          )
        )
          return;
        const currentProject = projects.find((p) => p.id === project),
          selection = window.getSelection()?.toString();
        openContextMenu(e, [
          ...(selection
            ? [{ label: tx("Copy selection"), run: () => copyText(selection) }]
            : []),
          {
            label: tx("New chat"),
            run: () => navigate(project || undefined, "chat"),
          },
          {
            label: tx("New chat project"),
            run: () => {
              newChatProject();
            },
          },
          {
            label: tx("Import conversation"),
            run: () => {
              importChat(project || undefined);
            },
          },
          ...(detail
            ? [
                {
                  label: tx("Rename conversation"),
                  run: () => renameConversation(detail),
                },
                {
                  label: tx(detail.archived ? "Unarchive" : "Archive chat"),
                  run: () => archiveConversation(detail),
                },
              ]
            : []),
          ...(currentProject
            ? [
                {
                  label: tx("Rename project"),
                  run: () => renameChatProject(currentProject),
                },
              ]
            : []),
        ]);
      }}
    >
      <WorkspacePageHeader className="chat-page-header">
        <div className="chat-header-title">
          <h1>{detail?.title || tx("New chat")}</h1>
          {detail && (
            <span
              className={"chat-status status-" + detail.status}
              title={detail.status}
            />
          )}
        </div>
        <details className="writing-options chat-options" ref={controlsMenu}>
          <summary title={tx("Conversation options")}>
            <Icon name="more" />
          </summary>
          <div className="writing-menu">
            {detail && (
              <p className="chat-control-meta">
                {[
                  detail.provider,
                  detail.model,
                  detail.origin === "managed"
                    ? detail.status
                    : tx("Saved history"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {id && (
              <button onClick={() => setRenaming(true)}>{tx("Rename")}</button>
            )}
            <label>
              {tx("Project")}
              <select
                value={project}
                onChange={(e) =>
                  id
                    ? void action(() =>
                        update({ projectId: e.target.value || null }),
                      )
                    : setProject(e.target.value)
                }
              >
                <option value="">
                  {tx(id ? "Unassigned" : "Choose a project")}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ·{" "}
                    {tx(
                      p.kind === "research"
                        ? "Research project"
                        : "Chat project",
                    )}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => setEditDirectory((v) => !v)}
              disabled={live}
              title={directory?.path || detail?.directory?.path}
            >
              <Icon name="folder" size={14} />
              {directory?.path ||
                detail?.directory?.path ||
                tx("Local project files")}
            </button>
            {editDirectory && !live && (
              <DirectoryPicker
                label={tx("Agent working directory")}
                value={
                  directory ||
                  detail?.directory || { location: "local", path: "~" }
                }
                onChange={setDirectory}
              />
            )}
            {id && (
              <button
                onClick={() =>
                  void action(() => update({ archived: !detail?.archived }))
                }
              >
                {tx(detail?.archived ? "Unarchive" : "Archive chat")}
              </button>
            )}
          </div>
        </details>
        <button
          className="chat-task-toggle"
          onClick={() => {
            setPreviewHref(undefined);
            setSideChat(false);
            toggleSidebar(
              "right",
              previewHref || sideChat ? true : !rightVisible,
            );
          }}
          title={tx("Task index")}
          aria-label={tx("Task index")}
          aria-expanded={rightVisible}
        >
          <Icon name="outline" />
        </button>
      </WorkspacePageHeader>
      {renaming && (
        <form
          className="chat-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await update({ title });
              setRenaming(false);
            });
          }}
        >
          <input
            autoFocus
            aria-label={tx("Conversation title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button disabled={busy || !title.trim()}>{tx("Save")}</button>
          <button type="button" onClick={() => setRenaming(false)}>
            {tx("Cancel")}
          </button>
        </form>
      )}
      <ChatPreviewContext.Provider value={id ? openPreview : null}>
        <div className="chat-workspace">
          <section className="chat-center">
            {!rightVisible && (detail?.taskMap?.length || 0) > 1 && (
              <ChatTaskMiniMap
                tasks={detail!.taskMap!}
                current={currentTask}
                onOpen={() => toggleSidebar("right", true)}
              />
            )}
            <div
              ref={scroll}
              className="chat-transcript"
              onScroll={() => {
                const e = scroll.current!;
                follow.current =
                  e.scrollHeight - e.scrollTop - e.clientHeight < 120;
                trackCurrentTask();
              }}
            >
              <div className="chat-readable">
                {loading ? (
                  <div className="empty">{tx("Loading conversation…")}</div>
                ) : !id ? (
                  <div className="chat-welcome">
                    <div className="chat-welcome-mark">
                      <Icon name="spark" size={32} />
                    </div>
                    <h2>{tx("What would you like to work on?")}</h2>
                    <p>
                      {tx(
                        "Your projects, literature, and results are available as research context.",
                      )}
                    </p>
                    <div className="chat-starters">
                      {[
                        "Review the next steps for this project",
                        "Compare the experiment results",
                        "Help me improve a draft",
                      ].map((text) => (
                        <button
                          key={text}
                          onClick={() => {
                            setMessage(tx(text));
                            input.current?.focus();
                          }}
                        >
                          {tx(text)}
                          <Icon name="arrow" size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {detail && detail.messages.length > limit && (
                      <button
                        className="quiet"
                        onClick={() => setLimit((l) => l + 120)}
                      >
                        {tx("Load earlier messages")}
                      </button>
                    )}
                    <ConversationMessages messages={displayedMessages} />
                    {running && (
                      <div className="chat-running" role="status">
                        <span className="chat-stream-caret" />
                        {tx("Agent is working…")}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {requests.length > 0 && (
              <section
                ref={requestsPane}
                className="chat-attention-region"
                aria-label={tx("Pending requests")}
              >
                <div className="chat-readable">
                  {requests.map((item) => (
                    <ApprovalCard
                      key={item.id}
                      item={item}
                      disabled={busy || !live}
                      onReply={focusComposer}
                      onRespond={(decision, answers) =>
                        void action(() =>
                          api("/chat/" + id + "/respond", "POST", {
                            attentionId: item.id,
                            decision,
                            answers,
                          }),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}
            <div className="chat-composer-region">
              <div className="chat-readable">
                {detail?.error && (
                  <p className="error small" role="alert">
                    {detail.error}
                    {detail.retryText && (
                      <button
                        className="quiet"
                        onClick={() => setMessage(detail.retryText!)}
                      >
                        {tx("Restore unsent prompt")}
                      </button>
                    )}
                  </p>
                )}
                {error && (
                  <p className="error chat-notice" role="alert">
                    {error}
                    <button
                      className="quiet"
                      onClick={() => setError("")}
                      aria-label={tx("Dismiss")}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </p>
                )}
                {notice && (
                  <p className="muted small" role="status">
                    {notice}
                  </p>
                )}
                {detail && !live && (
                  <p className="chat-history-notice">
                    {tx(
                      "This is saved history. Sending a message creates a separate session with this context.",
                    )}
                  </p>
                )}
                {changing && (
                  <p className="chat-history-notice">
                    {tx(
                      "Changing agents continues this conversation in a new session.",
                    )}
                  </p>
                )}
                {(!id || !live || changing) && (
                  <div className="chat-project-choice">
                    <Icon
                      name={
                        projects.find((p) => p.id === project)?.kind ===
                        "research"
                          ? "research-folder"
                          : "folder"
                      }
                      size={16}
                    />
                    <label htmlFor="new-chat-project">{tx("Project")}</label>
                    <select
                      id="new-chat-project"
                      aria-label={tx("Conversation project")}
                      required
                      value={project}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (id)
                          void action(() =>
                            update({ projectId: value || null }),
                          );
                        else setProject(value);
                        setDirectory(undefined);
                      }}
                      disabled={busy || running}
                    >
                      <option value="">{tx("Choose a project")}</option>
                      {projects.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} ·{" "}
                          {tx(
                            p.kind === "research"
                              ? "Research project"
                              : "Chat project",
                          )}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={newChatProject}
                      title={tx("New chat project")}
                      aria-label={tx("New chat project")}
                    >
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                )}
                <PromptComposer
                  minInputHeight={44}
                  voiceOptions={settings?.voice}
                  onSideChat={openSideChat}
                  sideChatDisabled={
                    !live ||
                    loading ||
                    sideBusy ||
                    ["gemini", "antigravity"].includes(detail?.provider || "")
                  }
                  sideChatHint={
                    !live
                      ? "Start or continue a conversation to use side chat."
                      : ["gemini", "antigravity"].includes(
                            detail?.provider || "",
                          )
                        ? "This provider adapter does not expose read-only side questions."
                        : "Side chat · ⌥Enter"
                  }
                  value={message}
                  onChange={setMessage}
                  onSend={send}
                  onStop={() => {
                    if (id)
                      void api("/chat/" + id + "/interrupt", "POST")
                        .then(() => chatChanged())
                        .catch((e) => setError(e.message));
                  }}
                  busy={busy || running}
                  ready={
                    ai.ready &&
                    !pending &&
                    !!selected &&
                    !loading &&
                    (!!project || (!!id && live && !changing))
                  }
                  placeholder={tx(
                    pending
                      ? "Respond to the request above to continue"
                      : "Message your agent",
                  )}
                  label={tx("Message")}
                  inputRef={input}
                  controls={
                    <PromptAIControls
                      pid={
                        isChatOnlyProject(project)
                          ? undefined
                          : project || undefined
                      }
                      toolbarStart={
                        <label
                          className="chat-native-permissions"
                          title={tx(
                            running || pending
                              ? "Wait for the agent or stop it before changing permissions."
                              : chatPermissionModes.find(
                                  (m) => m.id === permissionMode,
                                )!.detail,
                          )}
                        >
                          <Icon name="shield" size={14} />
                          <select
                            aria-label={tx("Permission mode")}
                            value={permissionMode}
                            disabled={busy || running || pending || loading}
                            onChange={(e) => {
                              const mode = e.target.value as ChatPermissionMode;
                              if (id && live && !changing)
                                void action(async () => {
                                  await api(
                                    "/chat/" + id + "/permissions",
                                    "PUT",
                                    { mode },
                                  );
                                  setPermissionMode(mode);
                                });
                              else setPermissionMode(mode);
                            }}
                          >
                            {chatPermissionModes.map((mode) => (
                              <option
                                key={mode.id}
                                value={mode.id}
                                disabled={
                                  selected?.engine === "gemini" &&
                                  mode.id === "auto"
                                }
                                title={tx(
                                  selected?.engine === "gemini" &&
                                    mode.id === "auto"
                                    ? "Gemini does not expose native automatic risk review."
                                    : mode.detail,
                                )}
                              >
                                {tx(mode.label)}
                              </option>
                            ))}
                          </select>
                        </label>
                      }
                      providerId={provider}
                      onProviderChange={(value) => {
                        setProvider(value);
                        const engine = settings?.providers.find(
                          (p) => p.id === value,
                        )?.engine;
                        setPermissionMode(
                          live && engine === detail?.provider
                            ? detail.permissionMode || "ask"
                            : defaultChatPermission(engine),
                        );
                      }}
                      {...ai.controls}
                      disabled={busy || running || pending}
                      catalogLoader={() =>
                        api("/chat/catalog", "POST", {
                          projectId: project || undefined,
                          providerId: provider,
                          directory: directory || detail?.directory,
                        })
                      }
                      providers={settings?.providers.filter((p) =>
                        ["codex", "claude", "gemini", "antigravity"].includes(
                          p.engine,
                        ),
                      )}
                    />
                  }
                />
              </div>
            </div>
          </section>
          <aside className="chat-task-index" data-sidebar="right">
            {!sideChat && (
              <SidebarPaneControls
                side="right"
                title={previewHref ? "File preview" : "Task index"}
              />
            )}
            {previewHref && id ? (
              <ChatFilePreview
                key={id + previewHref}
                id={id}
                href={previewHref}
                onClose={() => setPreviewHref(undefined)}
              />
            ) : sideChat && id ? (
              <SideChatPanel
                key={id}
                id={id}
                question={sideQuestion}
                onBusy={setSideBusy}
                onBring={(text) => {
                  setMessage((v) => v + text);
                  input.current?.focus();
                }}
                onIndex={() => setSideChat(false)}
                voiceOptions={settings?.voice}
              />
            ) : (
              <>
                <div className="chat-index-scroll">
                  <p className="muted small">
                    {tx(
                      detail?.indexSource === "agent-workspace"
                        ? "Agent Workspace task grouping"
                        : "Conversation turns · generate a task summary for grouped tasks",
                    )}
                  </p>
                  {detail?.taskMap && (
                    <ChatTaskMap
                      tasks={detail.taskMap}
                      current={currentTask}
                      origin={detail.mapOrigin}
                      onJump={jump}
                      onOpen={(conversation) =>
                        void navigate(pid, "chat", conversation)
                      }
                    />
                  )}
                  {!detail?.index.length && (
                    <div className="empty small">
                      {tx(
                        "Tasks and decisions appear here as your conversation grows.",
                      )}
                    </div>
                  )}
                </div>
                {live && (
                  <button
                    className="chat-index-refresh"
                    disabled={busy || running || pending}
                    onClick={() =>
                      void action(async () => {
                        setNotice(tx("Generating task summary…"));
                        try {
                          await api("/chat/" + id + "/index", "POST");
                          setNotice("");
                        } catch (e) {
                          setNotice("");
                          throw e;
                        }
                      })
                    }
                  >
                    <Icon name="refresh" size={15} />
                    {tx("Summarize tasks")}
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      </ChatPreviewContext.Provider>
    </main>
  );
}
