import { QuestionReplyMessage } from '../../renderer/QuestionReplyMessage';
import { useHistoryRefresh } from '../../renderer/state';
import {presentTranscriptItem} from '../../shared/presentation';
import {ContextNotes} from '../../renderer/ContextNotes';
import { Fragment, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SideSlot } from '../side-slot';
import { accountKey } from '../../shared/types';
import type { AttentionItem, MemoryRecord, PermissionMode, SessionRecord, Task, TranscriptItem, WorkspaceSnapshot, BtwEntry } from '../../shared/types';
import { PERMISSION_MODES } from './Settings';
import { call, errorText } from '../api';
import { AttentionView } from './AttentionView';
import { foldsTurn, OPEN_TURNS, groupTranscript, PlanChecklist, PreviewContext, splitTurns, ToolCallRow, ToolGroup, turnSummary } from './Content';
import { FilePreviewPanel } from './FilePreview';
import { AgentName, Alias, displayName, Icon, isMainAgent, PROVIDER_LABEL, StatusDot, systemText, warningText } from './bits';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';
import { AgentMemoryPanel, MemoryChip, RememberButton, RememberDialog } from './SessionMemory';
import { menuAt, menuKey, useContextMenu, type MenuItem } from './ContextMenu';
import { useConversationActions } from '../../renderer/components/ConversationActions';
import { agentMenuItems, canFork, EditableAgentName, type AgentField } from './AgentMenu';
import { RetryNotice } from './Retry';
import { UsageChips } from './SessionUsage';
import { FindBar } from './FindBar';
import { ConfirmDialog, ForkDialog, Modal } from './Dialogs';
import { RemoteControlButton } from './RemoteControl';
import { BtwPanel } from './Btw';
import { SidePanel } from './SidePanel';
import { SessionMap } from './SessionMap';
import { MainLanes } from './MainLanes';
import { mainLanes } from '../../shared/main-lanes';
import { chapters } from '../../shared/chapters';
import { sessionMap, type MapGrouping } from '../../shared/session-map';
import { turnChanges } from '../turn-changes';
import { resolvePosix } from '../../shared/preview';
import { t, language } from '../i18n';
import { OpenInApp } from './OpenInApp';
import { AttachButton, AttachmentStrip, MessageImages, useAttachments } from './Attachments';
import { dropMentions, MentionHighlight, MentionMenu, useMentions } from './Mentions';
import { savedPreview, savePreview, type PreviewState } from '../preview-store';
import { useDraft, setDraftText, setDraftImages } from '../drafts';
import { RewindButton, RewindDialog } from '../../renderer/components/Rewind';
import { nextListItem } from '../numbered-list';

export function FocusView({ snapshot, task, transcript, now, onOpen, onVoiceSlot }: { snapshot: WorkspaceSnapshot; task: Task; transcript: TranscriptItem[]; now: number; onOpen?: (taskId: string) => void; onVoiceSlot: (slot: HTMLSpanElement | null) => void }) {
  const directoryWarning = warningText(task.sharedCwdWarning || '');
  // Completion reports duplicate the last transcript message here; only show what needs a decision.
  const open = snapshot.attention.filter((a) => a.taskId === task.taskId && a.state === 'open' && a.kind !== 'completion');
  // A question the agent asked in its own words is its message right above: only the newest
  // shows here, as one line (older ones are earlier in the conversation). Native requests
  // (approvals, structured questions) and errors show in full, each.
  const asked = (a: AttentionItem) => a.kind === 'question' && !a.providerRequestId;
  const lastAsked = open.filter(asked).at(-1);
  const items = open.filter((a) => !asked(a) || a === lastAsked);
  const connected = snapshot.connectedTaskIds.includes(task.taskId);
  const session = snapshot.sessions.find((s) => s.localId === task.sessionLocalId);
  const project = snapshot.projects.find((p) => p.projectId === task.projectId);
  // Closed by default; once opened it stays open for every agent.
  const [showMemory, setShowMemoryState] = useState(() => localStorage.getItem('amw.showMemory') === '1');
  const setShowMemory = (on: boolean) => {
    localStorage.setItem('amw.showMemory', on ? '1' : '0');
    setShowMemoryState(on);
  };
  // The files the agent changed in its latest turn; their list shares the side column (closing a
  // file previewed from it brings the list back). Follow: each file it changes opens as it changes.
  const changes = useMemo(() => turnChanges(transcript), [transcript]);
  // Side questions ("btw"): asked from the reply box, read in the side column (which they open).
  const [showBtw, setShowBtw] = useState(false);
  const [btw, setBtw] = useState<BtwEntry[]>([]);
  const btwTaskId = useRef(task.taskId);
  btwTaskId.current = task.taskId;
  const [inject, setInject] = useState({ text: '', n: 0 });
  // Main agent: the request the user unfolded in "waiting on you"; what they write is likely about it.
  const [aboutId, setAboutId] = useState<string | null>(null);
  useEffect(() => setAboutId(null), [task.taskId]);
  // Keep externally continued native sessions current without claiming their writer lock.
  useHistoryRefresh(task.taskId, task.host);

  const aboutItem = aboutId ? snapshot.attention.find((a) => a.id === aboutId && a.state === 'open') : undefined;
  const aboutTask = aboutItem ? snapshot.tasks.find((x) => x.taskId === aboutItem.taskId) : undefined;
  const about = aboutItem && aboutTask ? { id: aboutItem.id, headline: aboutItem.headline } : undefined;
  useEffect(() => {
    let live = true;
    setShowBtw(false);
    setBtw([]);
    void call('btw:list', { taskId: task.taskId })
      .then((list) => live && setBtw(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [task.taskId]);
  const askBtw = (question: string) => {
    setShowBtw(true);
    setShowMap(false);
    setPreview(null);
    if (!question) return;
    const taskId = task.taskId;
    // Shown at once, answered when the agent answers; the main conversation is not touched.
    setBtw((list) => [...list, { id: `pending-${Date.now()}`, question, askedAt: new Date().toISOString() }]);
    void call('btw:ask', { taskId, question })
      .catch(() => undefined)
      .then(() => call('btw:list', { taskId }))
      .then((list) => { if (btwTaskId.current === taskId) setBtw(list); })
      .catch(() => {});
  };
  // The session map: its turns as tasks (a model's grouping, cached; structure until then), beside the
  // conversation when the window leaves room, else in the side column.
  const threadRef = useRef<HTMLDivElement>(null);
  const turnCount = useMemo(() => transcript.filter((i) => i.role === 'user').length, [transcript]);
  const [grouping, setGrouping] = useState<MapGrouping | null>(null);
  const settled = task.status !== 'running' && task.status !== 'starting';
  useEffect(() => setGrouping(null), [task.taskId]);
  useEffect(() => {
    if (turnCount < 2 || !settled) return;
    let live = true;
    void call('session:map', { taskId: task.taskId })
      .then((g) => live && setGrouping(g))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [task.taskId, turnCount, settled]);
  const forks = useMemo(() => snapshot.tasks.filter((x) => x.forkedFrom?.taskId === task.taskId), [snapshot.tasks, task.taskId]);
  const mapTasks = useMemo(() => (turnCount >= 2 ? sessionMap(transcript, forks, grouping) : []), [transcript, forks, grouping, turnCount]);
  // The header's line: what the agent is on, the last task of its map (as drawn here, else as cached for
  // the sidebar). Never its latest message, and nothing until a map exists.
  const workTitle = (grouping ? mapTasks.at(-1)?.title : undefined) ?? snapshot.workTitles?.[task.taskId];
  // The main agent's map: lanes, one per agent it handed work to (instead of one trunk of tasks).
  const main = isMainAgent(task);
  // By chapter: the map draws the current one; earlier chapters fold to a line each.
  const parts = useMemo(() => (main ? chapters(transcript) : []), [main, transcript]);
  const current = parts.at(-1)?.items ?? [];
  const lanes = useMemo(() => (main ? mainLanes(current, snapshot.tasks, snapshot.projects) : null), [main, current, snapshot.tasks, snapshot.projects]);
  const earlier = useMemo(
    () => parts.slice(0, -1).map((c) => ({ key: c.items[0]?.id ?? String(c.start), at: c.at || c.items[0]?.createdAt || '', items: c.items })),
    [parts],
  );
  const hasMap = main ? !!lanes?.lanes.length || earlier.length > 0 : mapTasks.length > 0;
  // Where each lane ends: how that agent is doing now.
  const outcomes = useMemo(() => Object.fromEntries(snapshot.tasks.map((x) => [x.taskId, { status: x.status, summary: x.summary }])), [snapshot.tasks]);
  // Forked from another agent: where this trunk came in.
  const mapOrigin = useMemo(() => {
    const from = task.forkedFrom;
    if (!from) return undefined;
    const parent = snapshot.tasks.find((x) => x.taskId === from.taskId);
    return { taskId: from.taskId, alias: parent?.alias ?? from.alias, name: parent?.name ?? from.alias };
  }, [task.forkedFrom, snapshot.tasks]);
  const [showMap, setShowMap] = useState(true);
  const [chatControls, setChatControls] = useState(false);
  const [bodyW, setBodyW] = useState(0);
  useEffect(() => {
    setShowMap(true);
    setChatControls(false);
  }, [task.taskId]);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  useEffect(() => {
    const thread = threadRef.current;
    const scroller = thread?.querySelector<HTMLElement>('.transcript');
    const inner = thread?.querySelector<HTMLElement>('.transcript-inner');
    if (!thread || !scroller || !inner) return;
    const track = () => {
      // Right after a jump from the map, its choice stands (the jump's own scrolling does not overrule it).
      if (Date.now() - jumpedAt.current < 900) return;
      // The last turn starting above 40% of the view is the one being read.
      const top = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.4;
      let turn: string | null = null;
      for (const el of scroller.querySelectorAll<HTMLElement>('.msg.user[data-item-id]')) {
        if (el.getBoundingClientRect().top <= top) turn = el.dataset.itemId ?? null;
        else break;
      }
      // At the end of the conversation, the latest task is the one in view (however short it is).
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
      const owner = atEnd ? mapTasks.at(-1) : (mapTasks.find((x) => turn && x.turnIds.includes(turn)) ?? mapTasks[0]);
      setCurrentTask(owner?.startItemId ?? null);
    };
    track();
    const ro = new ResizeObserver(track);
    ro.observe(scroller);
    scroller.addEventListener('scroll', track, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener('scroll', track);
    };
  }, [mapTasks]);
  const jumpedAt = useRef(0);
  const jumpTo = (turnId: string) => {
    // The task jumped to is the one being read, whether or not the conversation can scroll to it.
    jumpedAt.current = Date.now();
    setCurrentTask(mapTasks.find((x) => x.turnIds.includes(turnId))?.startItemId ?? null);
    const el = threadRef.current?.querySelector<HTMLElement>(`.msg.user[data-item-id="${turnId}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // A file preview takes the Memory column while open; closing it brings Memory back if it was on.
  // Kept per agent: back on this agent, its file is shown again. `nonce` marks each request, so
  // asking for the file already shown jumps to the line and flashes instead of reloading it.
  const [preview, setPreviewState] = useState<ShownPreview | null>(() => restored(task.taskId));
  const setPreview = (path: string | null, opts: { line?: number; diff?: boolean } = {}) =>
    setPreviewState((cur) => {
      if (!path) {
        savePreview(task.taskId, null);
        return null;
      }
      savePreview(task.taskId, { path, ...(opts.line ? { line: opts.line } : {}), ...(opts.diff ? { diff: true } : {}) });
      return { path, line: opts.line, diff: opts.diff, nonce: (cur?.nonce ?? 0) + 1, again: cur?.path === path };
    });
  // The side panels go in the stage's full-height right column; the stage's width is the room the
  // conversation and the preview share, and decides the preview's width and whether it covers.
  const side = useContext(SideSlot);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = side?.parentElement ?? bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBodyW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [side]);
  // The side column's width as its share of the room, so it grows and shrinks with the window like the
  // conversation does; dragged by the user, kept for next time. A width kept by an earlier version becomes
  // its share of the first room measured.
  const [previewShare, setPreviewShare] = useState<number | null>(() => Number(localStorage.getItem('amw.previewShare')) || (localStorage.getItem('amw.previewWidth') ? null : PREVIEW_SHARE));
  useEffect(() => {
    if (previewShare === null && bodyW > 0) setPreviewShare(Number(localStorage.getItem('amw.previewWidth')) / bodyW || PREVIEW_SHARE);
  }, [bodyW, previewShare]);
  // Maximized: the preview takes the whole conversation area until restored (Esc) or closed.
  // Maximized: the side panel (any kind) takes the whole conversation area until restored (Esc) or closed.
  const [previewMax, setPreviewMax] = useState(false);
  useEffect(() => {
    if (!previewMax) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPreviewMax(false);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [previewMax]);
  const setPreviewWidth = (w: number) => {
    if (!bodyW) return;
    setPreviewShare(w / bodyW);
    localStorage.setItem('amw.previewShare', (w / bodyW).toFixed(4));
  };
  useEffect(() => setPreviewState(restored(task.taskId)), [task.taskId]);
  // Too narrow for both (the conversation keeps 400px, a side panel 300px): the panel covers it.
  const narrow = bodyW > 0 && bodyW < PREVIEW_MIN + CONVERSATION_MIN;
  // Which panel the side column shows: one at a time, the preview first.
  const sideKind: 'preview' | 'map' | 'btw' | 'memory' | null = preview ? 'preview' : showMap ? 'map' : showBtw ? 'btw' : showMemory ? 'memory' : null;
  useEffect(() => {
    setPreviewMax(false);
  }, [sideKind]);
  // Every panel alike: beside the conversation when both fit, else (or maximized) in its place.
  const covering = !!sideKind && (previewMax || narrow);
  const shownWidth = Math.min(Math.max((previewShare ?? PREVIEW_SHARE) * bodyW, PREVIEW_MIN), previewMaxWidth(bodyW));
  const [forking, setForking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Conversations on this computer can be forked once saved, when their provider supports it.
  const forkable = canFork(snapshot, task);
  const [error, setError] = useState('');
  const run = (fn: () => Promise<unknown>) => {
    setError('');
    fn().catch((e) => setError(errorText(e)));
  };
  // "Open in default app" only for files on this computer.
  const openExternal = task.host ? undefined : (path: string) => run(() => call('file:open', { taskId: task.taskId, path }));

  // A file previewed while it has changes in the latest turn can show them (File / Changes).
  const previewDiffs = preview ? changes.files.find((f) => f.path === preview.path || resolvePosix(task.cwd, f.path) === resolvePosix(task.cwd, preview.path))?.diffs : undefined;
  /** The frame every side panel shares: one width, maximize (unless it already covers), close. */
  const frame = (onClose: () => void) => ({ width: shownWidth, maximized: covering, onToggleMax: narrow ? undefined : () => setPreviewMax(!previewMax), onClose });
  /** In the conversation's place, acting on the conversation closes the panel first, so it is seen. */
  const thenConversation = (fn: () => void) => {
    if (!covering) return fn();
    setShowMap(false);
    setShowBtw(false);
    setTimeout(fn, 50);
  };
  const previewPanel = preview ? (
    <FilePreviewPanel
                task={task}
                path={preview.path}
                line={preview.line}
                nonce={preview.nonce}
                again={preview.again}
                transcript={transcript}
                width={shownWidth}
                maximized={covering}
                onToggleMax={narrow ? undefined : () => setPreviewMax(!previewMax)}
                onClose={() => setPreview(null)}
                onOpenExternal={openExternal && (() => openExternal(preview.path))}
                diffs={previewDiffs}
                showDiff={!!preview.diff && !!previewDiffs?.length}
                onToggleDiff={(on) => {
                  savePreview(task.taskId, { path: preview.path, ...(preview.line ? { line: preview.line } : {}), ...(on ? { diff: true } : {}) });
                  setPreviewState((cur) => (cur ? { ...cur, diff: on } : cur));
                }}
              />
  ) : null;
  const sidePanel =
    sideKind === 'preview' ? (
      previewPanel
    ) : sideKind === 'map' ? (
      <SidePanel title={t('Task index')} label={t('Task index')} testId="session-map-panel" frame={frame(() => setShowMap(false))}>
        {!hasMap ? <p className="muted pad-x">{t('Tasks will appear here as the chat progresses.')}</p> : lanes ? (
          <MainLanes earlier={earlier} tasks={snapshot.tasks} projects={snapshot.projects} lanes={lanes.lanes} rows={lanes.rows} outcomes={outcomes} onJump={(id) => thenConversation(() => jumpTo(id))} onOpenAgent={(id) => onOpen?.(id)} />
        ) : (
          <SessionMap tasks={mapTasks} current={currentTask} onJump={(id) => thenConversation(() => jumpTo(id))} onOpenAgent={(id) => onOpen?.(id)} origin={mapOrigin} />
        )}
      </SidePanel>
    ) : sideKind === 'btw' ? (
      <BtwPanel
        key={task.taskId}
        task={task}
        onAsk={askBtw}
        entries={btw}
        frame={frame(() => setShowBtw(false))}
        onClear={() => {
          setBtw([]);
          setShowBtw(false);
          void call('btw:clear', { taskId: task.taskId }).catch(() => {});
        }}
        onBring={(text) => thenConversation(() => setInject((cur) => ({ text, n: cur.n + 1 })))}
      />
    ) : sideKind === 'memory' ? (
      <AgentMemoryPanel snapshot={snapshot} task={task} frame={frame(() => setShowMemory(false))} />
    ) : null;
  return (
    <div className="focus workspace-chat">
      <section className="focus-main">
        <header className="focus-head drag">
          <div className="focus-name">
            <TaskName key={task.taskId} task={task} tasks={snapshot.tasks} onFork={forkable ? () => setForking(true) : undefined} onControls={() => setChatControls(true)} />
          </div>
          <button
            className="icon-btn task-index-toggle"
            type="button"
            aria-label={t('Task index')}
            title={t('Task index')}
            aria-expanded={sideKind === 'map'}
            data-testid="task-index-toggle"
            onClick={() => {
              const opening = sideKind !== 'map';
              setShowMap(opening);
              if (opening) {
                setShowBtw(false);
                setPreview(null);
              }
            }}
          >
            <Icon name="list" size={18} />
          </button>
        </header>
        {chatControls ? (
          <Modal title={t('Chat controls')} onClose={() => setChatControls(false)}>
            <div className="chat-control-meta">
              <StatusDot status={task.status} connected={connected} />
              <MemoryChip
                snapshot={snapshot}
                task={task}
                open={showMemory && !preview && !showBtw}
                onToggle={() => {
                  const on = preview || showBtw || showMap ? true : !showMemory;
                  setShowMemory(on);
                  setChatControls(false);
                  setShowMap(false);
                  setShowBtw(false);
                  setPreview(null);
                }}
              />
              <UsageChips task={task} limits={snapshot.limits?.[accountKey(task)]} now={now} only={['tokens']} />
              {workTitle ? (
                <span className="truncate" title={workTitle} data-testid="focus-work">
                  {workTitle}
                </span>
              ) : null}
              <span title={task.host ? `${task.host}:${task.cwd}` : task.cwd}>
                <Icon name="folder" size={12} /> {task.host ? `${task.host}:` : ''}
                {project?.name}
              </span>
              {task.worktree ? (
                <span title={task.worktree.path}>
                  <Icon name="branch" size={12} /> {task.worktree.branch}
                </span>
              ) : null}
              {task.forkedFrom ? (
                <span>
                  <Icon name="branch" size={12} /> {t('Forked chat')}
                </span>
              ) : null}
            </div>

            <div className="focus-actions chat-control-actions">
              {/* In order of use: running it, opening its folder, its session, putting it away (remove last). */}
              {task.status === 'running' && connected ? (
                <button className="btn btn-icon" data-tip={t('Interrupt')} aria-label={t('Interrupt')} onClick={() => run(() => call('task:interrupt', { taskId: task.taskId }))}>
                  <Icon name="pause" />
                </button>
              ) : null}
              {!connected ? (
                <button
                  className="btn btn-icon"
                  onClick={() => run(() => call('task:resume', { taskId: task.taskId }))}
                  aria-label={session?.nativeSessionId ? t('Resume session') : t('Start session')}
                  data-tip={session?.nativeSessionId ? t('Resume') : t('Start')}
                >
                  <Icon name="play" />
                </button>
              ) : (
                <button className="btn btn-icon" data-tip={t('Stop')} aria-label={t('Stop')} onClick={() => run(() => call('task:stop', { taskId: task.taskId }))}>
                  <Icon name="power" />
                </button>
              )}
              {/* The agent's folder (its worktree) in the user's own editor, Git app, terminal or Finder. */}
              {!task.host ? <OpenInApp taskId={task.taskId} iconOnly /> : null}
              {/* Sync: after going on with this session elsewhere (the terminal, a desktop or editor app), pick that up here. */}
              {!isMainAgent(task) && session?.nativeSessionId ? (
                <button
                  className={`btn btn-icon${syncing ? ' busy' : ''}`}
                  disabled={syncing || task.status === 'running' || task.status === 'starting' || open.some((a) => !!a.providerRequestId)}
                  aria-label={t('Sync')}
                  data-tip={t('Sync')}
                  data-testid="sync-session"
                  onClick={() => {
                    setSyncing(true);
                    run(() => call('task:sync', { taskId: task.taskId }).finally(() => setSyncing(false)));
                  }}
                >
                  <Icon name="refresh" />
                </button>
              ) : null}
              {forkable ? (
                <button
                  className="btn btn-icon"
                  aria-label={t('Fork')}
                  data-testid="fork-task"
                  disabled={task.status === 'running' || task.status === 'starting'}
                  onClick={() => { setChatControls(false); setForking(true); }}
                  data-tip={task.status === 'running' || task.status === 'starting' ? t('Fork after this turn') : t('Fork')}
                >
                  <Icon name="branch" />
                </button>
              ) : null}
              {/* Claude Code's Remote Control: this agent in the Claude app on a phone, still running here. */}
              {(task.provider === 'claude' || task.provider === 'mock' || (task.provider === 'codex' && snapshot.capabilities.find(c => c.provider === 'codex')?.remoteControl)) && !task.host && !isMainAgent(task) ? <RemoteControlButton task={task} url={snapshot.remoteControl?.[task.taskId]} codex={snapshot.codexRemote?.[task.taskId]} /> : null}
              {/* The main agent: start a new chapter (a fresh session, handed over what is going on now). */}
              {isMainAgent(task) ? (
                <button className="btn btn-icon" data-tip={t('New chapter')} aria-label={t('New chapter')} data-testid="new-chapter" onClick={() => run(() => call('main:newChapter', {}))}>
                  <Icon name="plus" />
                </button>
              ) : null}
              {/* Set aside: out of the Overview, folded into its team's idle row, until it works, asks or is messaged. */}
              {isMainAgent(task) ? null : (
                <button
                  className={`btn btn-icon${task.setAside ? ' btn-pressed' : ''}`}
                  aria-pressed={!!task.setAside}
                  aria-label={task.setAside ? t('Set aside (click to bring back)') : t('Set aside')}
                  data-tip={task.setAside ? t('Bring back') : t('Set aside')}
                  data-testid="set-aside"
                  onClick={() => run(() => call('task:setAside', { taskId: task.taskId, on: !task.setAside }))}
                >
                  <Icon name="moon" />
                </button>
              )}
              {isMainAgent(task) ? null : (
                <button
                  className="btn btn-icon"
                  data-testid="remove-task"
                  aria-label={t('Remove')}
                  data-tip={t('Remove')}
                  onClick={() => {
                    setChatControls(false);
                    setRemoving(true);
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          </Modal>
        ) : null}
        {directoryWarning ? (
          <div className="warn-text pad">
            <Icon name="alert" size={12} /> {directoryWarning}
          </div>
        ) : null}
        {error ? <div className="error-text pad">{error}</div> : null}
        {removing ? (
          <ConfirmDialog
            title={t('Remove {name}?', { name: displayName(task) })}
            message={
              task.worktree
                ? t('Stops the agent and removes it from the workspace. Its worktree is deleted if nothing in it is uncommitted, and then its conversation cannot be continued; otherwise the worktree is kept on disk.')
                : snapshot.capabilities.find((c) => c.provider === task.provider)?.importHistory === false
                  ? t('Stops the agent and removes it from the workspace. Its conversation stays in {provider}.', { provider: PROVIDER_LABEL[task.provider] ?? task.provider })
                  : t('Stops the agent and removes it from the workspace. Its conversation stays in {provider}: bring it back any time with Continue a session… (the history button next to + in the sidebar)', { provider: PROVIDER_LABEL[task.provider] ?? task.provider })
            }
            confirmLabel={t('Remove')}
            danger
            onConfirm={() => run(() => call('task:remove', { taskId: task.taskId }))}
            onClose={() => setRemoving(false)}
          />
        ) : null}
        {forking ? <ForkDialog snapshot={snapshot} task={task} onClose={() => setForking(false)} onForked={(id) => onOpen?.(id)} /> : null}

        <div className="focus-body" ref={bodyRef}>
          {/* Kept mounted while the preview is maximized, so the conversation keeps its place. */}
          <div className="focus-thread" hidden={covering} ref={threadRef}>
            <PreviewContext.Provider value={{ preview: setPreview, openExternal }}>
              <Transcript items={transcript} main={isMainAgent(task)} task={task} snapshot={snapshot} onOpen={onOpen} />
            </PreviewContext.Provider>
            {/* Requests wait at the end of the conversation, where the agent asked, above the reply box. */}
            {items.length || task.retry ? (
              <div className="focus-attention" data-testid="focus-attention">
                {task.retry ? <RetryNotice retry={task.retry} /> : null}
                {items.map((i) => (
                  <AttentionView key={i.id} item={i} task={task} now={now} compact shown={asked(i)} />
                ))}
              </div>
            ) : null}
            {task.plan ? (
              <div className="pinned-plan">
                {settled ? (
                  <details className="turn-fold">
                    <summary>
                      <span>{t('Plan {done}/{total}', { done: task.plan.entries.filter((entry) => entry.status === 'completed').length, total: task.plan.entries.length })}</span>
                      <Icon name="chevron" size={11} />
                    </summary>
                    <PlanChecklist plan={task.plan} />
                  </details>
                ) : <PlanChecklist plan={task.plan} />}
              </div>
            ) : null}
            {/* What the agents wait on: one line right above the reply box, unfolding to answer them here. */}
            {isMainAgent(task) ? <WaitingOnYou snapshot={snapshot} now={now} onOpen={onOpen} bar onPick={setAboutId} /> : null}
            <Composer
              key={task.taskId}
              task={task}
              session={session}
              onVoiceSlot={onVoiceSlot}
              onBtw={task.provider === 'antigravity' ? undefined : askBtw}
              inject={inject}
              about={about}
              onClearAbout={() => setAboutId(null)}
              permissionMode={isMainAgent(task) ? undefined : task.permissionMode ?? snapshot.settings.permissionMode ?? 'auto'}
              context={<UsageChips task={task} now={now} only={['context']} compactContext />}
              under={<UsageChips task={task} limits={snapshot.limits?.[accountKey(task)]} now={now} only={['limits-if-hot']} />}
            />
          </div>
          {/* Maximized or too narrow, the preview takes the conversation's place under the header;
              beside it, it is a full-height column on the right (the side slot). */}
          {covering ? sidePanel : null}
        </div>
      </section>
      {(() => {
        if (!sidePanel || covering) return null;
        const panel = (
          <>
            <PanelResizer width={shownWidth} room={bodyW} onChange={setPreviewWidth} />
            {sidePanel}
          </>
        );
        return side ? createPortal(panel, side) : panel;
      })()}
    </div>
  );
}

/** The side column's default share of the room it and the conversation split (about 460px in a laptop window). */
const PREVIEW_SHARE = 0.4;
const PREVIEW_WIDTH = 460;
/** The preview never narrower than this; the conversation keeps at least CONVERSATION_MIN. */
const PREVIEW_MIN = 300;
const CONVERSATION_MIN = 400;
/** Widest the preview may be beside the conversation: 70% of the room, leaving the conversation its minimum. */
const previewMaxWidth = (room: number) => (room ? Math.max(PREVIEW_MIN, Math.min(room * 0.7, room - CONVERSATION_MIN)) : Infinity);

interface ShownPreview extends PreviewState {
  nonce: number;
  /** Asked for while already shown: jump and flash rather than reload. */
  again: boolean;
}

function restored(taskId: string): ShownPreview | null {
  const saved = savedPreview(taskId);
  return saved ? { ...saved, nonce: 1, again: false } : null;
}

/** The bar between the conversation and the preview: drag to resize, double-click for the default width. */
function PanelResizer({ width, room, onChange }: { width: number; room: number; onChange: (w: number) => void }) {
  // A drag in progress ends with the bar too: if the panel goes while dragging, the pointer is not left as a resize cursor.
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize the side column')}
      title={t('Drag to resize; double-click to reset')}
      data-testid="panel-resizer"
      onDoubleClick={() => onChange(room ? room * PREVIEW_SHARE : PREVIEW_WIDTH)}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        document.body.classList.add('resizing');
        // On the window, so a fast drag that outruns the thin bar (or outlives it) still ends.
        const move = (ev: PointerEvent) => {
          // Room for the conversation stays; the preview never gets too narrow to read.
          onChange(Math.min(previewMaxWidth(room), Math.max(PREVIEW_MIN, startW + (startX - ev.clientX))));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          document.body.classList.remove('resizing');
          stop.current = null;
        };
        stop.current = up;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }}
    />
  );
}

/**
 * Everything the agents are waiting on, answerable right here (same buttons as on their cards),
 * or by telling the main agent. In the main agent's view (`bar`): one line above the reply box,
 * "N waiting", that unfolds into the list; nothing at all when nothing waits.
 */
export function WaitingOnYou({
  snapshot,
  now,
  onOpen,
  compact,
  limit,
  bar,
  onPick,
}: {
  snapshot: WorkspaceSnapshot;
  now: number;
  onOpen?: (taskId: string) => void;
  compact?: boolean;
  limit?: number;
  bar?: boolean;
  /** The row the user unfolded themselves (not one opened by itself), or null. */
  onPick?: (attentionId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  // The bar's open row: undefined = automatic (the only one, when there is one), null = none.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const open = snapshot.attention.filter((a) => a.state === 'open' && a.kind !== 'completion' && snapshot.tasks.some((t) => t.taskId === a.taskId));
  // Folds again once everything is answered, so the next request arrives as one line.
  useEffect(() => {
    if (!open.length) setUnfolded(false);
    setPicked((p) => (p && !open.some((a) => a.id === p) ? undefined : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.length]);
  if (!open.length) return null;
  // With several waiting, one line each (expand one to answer) so the list stays short.
  const rows = open.length > 2;
  const list = open.slice(0, limit ?? open.length).map((a) => {
    const worker = snapshot.tasks.find((x) => x.taskId === a.taskId)!;
    if (rows && expanded !== a.id)
      return (
        <div key={a.id} className={`waiting-row kind-${a.kind}`} data-testid="waiting-row">
          <button className="waiting-row-main" onClick={() => setExpanded(a.id)} title={t('Show the request')}>
            <Alias alias={worker.alias} size="sm" />
            <span className="waiting-row-name">
              <AgentName task={worker} />
            </span>
            <span className="waiting-row-text">{a.headline}</span>
          </button>
          {onOpen ? (
            <button className="link small" onClick={() => onOpen(worker.taskId)}>
              {t('Open')}
            </button>
          ) : null}
        </div>
      );
    return (
      <div key={a.id} className="waiting-item" data-testid="waiting-item">
        <div className="waiting-from">
          <Alias alias={worker.alias} size="sm" /> <AgentName task={worker} />
          {onOpen ? (
            <button className="link small" onClick={() => onOpen(worker.taskId)}>
              {t('Open')}
            </button>
          ) : null}
          {rows ? (
            <button className="link small" onClick={() => setExpanded(null)}>
              {t('Show less')}
            </button>
          ) : null}
        </div>
        <AttentionView item={a} task={worker} compact now={now} />
      </div>
    );
  });
  const more = limit && open.length > limit ? <div className="muted small">{t('+{n} more', { n: open.length - limit })}</div> : null;
  if (bar) {
    // Who is waiting, once each, for the folded line.
    const who = [...new Map(open.map((a) => [a.taskId, snapshot.tasks.find((x) => x.taskId === a.taskId)!])).values()];
    return (
      <div className={`waiting waiting-bar${unfolded ? ' open' : ''}`} data-testid="waiting-on-you">
        <div className="waiting-bar-box">
          <button
            className="waiting-bar-head"
            aria-expanded={unfolded}
            onClick={() => {
              // Folded, nothing is unfolded any more: messages are no longer taken as about a request.
              if (unfolded) {
                setPicked(undefined);
                onPick?.(null);
              }
              setUnfolded(!unfolded);
            }}
            data-testid="waiting-bar-toggle"
          >
            <span className="waiting-bar-dot" aria-hidden />
            <span className="waiting-bar-count">{t('{n} waiting on you', { n: open.length })}</span>
            <span className="waiting-bar-who" aria-hidden>
              {who.slice(0, 3).map((w) => (
                <Alias key={w.taskId} alias={w.alias} size="sm" />
              ))}
            </span>
            {!unfolded ? <span className="waiting-bar-peek">{open[0].headline}</span> : <span className="waiting-bar-peek" />}
            <span className="waiting-bar-chevron" aria-hidden>
              <Icon name="chevron" size={12} />
            </span>
          </button>
          {unfolded ? (
            <div className="waiting-bar-list" data-testid="waiting-bar-list">
              {open.map((a) => {
                const worker = snapshot.tasks.find((x) => x.taskId === a.taskId)!;
                // One at a time; a lone request opens by itself.
                const isOpen = picked === undefined ? open.length === 1 : picked === a.id;
                const toggle = () => {
                  setPicked(isOpen ? null : a.id);
                  onPick?.(isOpen ? null : a.id);
                };
                return <WaitingBarRow key={a.id} item={a} task={worker} now={now} open={isOpen} onToggle={toggle} onOpen={onOpen} />;
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={`waiting${compact ? ' compact' : ''}`} data-testid="waiting-on-you">
      <div className="section-label">{t('Waiting on you · {n}', { n: open.length })}</div>
      {list}
      {more}
    </div>
  );
}

/** Short kind tags for the bar's rows. */
const KIND_TAG: Record<AttentionItem['kind'], string> = { approval: 'Permission', question: 'Question', error: 'Error', review: 'Review', completion: 'Report' };

/** The decisions a permission request can take right on its row: allow (once, if offered) and deny. */
function quickOptions(item: AttentionItem): NonNullable<AttentionItem['options']> {
  if (item.kind !== 'approval' || !item.providerRequestId) return [];
  const opts = item.options ?? [];
  const rejects = (o: (typeof opts)[number]) => (o.kind ? o.kind.startsWith('reject') : /deny|decline|reject/.test(o.id));
  const allow = opts.find((o) => o.kind === 'allow_once') ?? opts.find((o) => !rejects(o) && o.kind !== 'allow_always') ?? opts.find((o) => !rejects(o));
  const deny = opts.find(rejects);
  return [allow, deny].filter((o): o is (typeof opts)[number] => !!o);
}

/**
 * One request in the bar: who, what kind, what; a permission is allowed or denied right here, anything
 * else unfolds below the row (flat, not a card inside the bar) to answer or dismiss it.
 */
function WaitingBarRow({ item, task, now, open, onToggle, onOpen }: { item: AttentionItem; task: Task; now: number; open: boolean; onToggle: () => void; onOpen?: (taskId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const quick = quickOptions(item);
  const respond = async (decision: string) => {
    setBusy(true);
    setError('');
    try {
      await call('attention:respond', { attentionId: item.id, decision });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const rejects = (o: (typeof quick)[number]) => (o.kind ? o.kind.startsWith('reject') : /deny|decline|reject/.test(o.id));
  return (
    <div className={`wb-row kind-${item.kind}${open ? ' open' : ''}${item.highRisk ? ' high-risk' : ''}`} data-testid="waiting-row" data-kind={item.kind}>
      <div className="wb-line">
        <button className="wb-main" onClick={onToggle} aria-expanded={open} title={open ? t('Show less') : t('Show the request')}>
          <Alias alias={task.alias} size="sm" />
          <span className="wb-name">
            <AgentName task={task} />
          </span>
          <span className="wb-kind">{t(KIND_TAG[item.kind])}</span>
          {item.highRisk ? <span className="wb-risk">{t('high risk')}</span> : null}
          <span className="wb-text">{item.headline}</span>
        </button>
        {quick.map((o) => (
          <button key={o.id} className={`btn btn-sm${rejects(o) ? '' : ' btn-primary'}`} disabled={busy} title={o.description} onClick={() => respond(o.id)}>
            {t(o.label)}
          </button>
        ))}
        {!quick.length && item.kind === 'question' && item.providerRequestId && !open ? (
          <button className="btn btn-sm btn-primary" onClick={onToggle}>
            {t('Answer')}
          </button>
        ) : null}
        <button className="wb-chevron" onClick={onToggle} aria-label={open ? t('Show less') : t('Show the request')} tabIndex={-1}>
          <Icon name="chevron" size={12} />
        </button>
      </div>
      {error ? <div className="error-text wb-error">{error}</div> : null}
      {open ? (
        <div className="wb-detail" data-testid="waiting-detail">
          {/* Unfolded is asking to read it: all of it, no "Show more" (the list scrolls when it is long). */}
          <AttentionView item={item} task={task} now={now} flat skipOptions={quick.map((o) => o.id)} />
          {onOpen ? (
            <button className="link small wb-open" onClick={() => onOpen(task.taskId)}>
              {t('Open {name}', { name: displayName(task) })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The title keeps rename and additional controls available in its context menu. */
function TaskName({ task, tasks, onFork, onControls }: { task: Task; tasks: Task[]; onFork?: () => void; onControls: () => void }) {
  const conversations = useConversationActions();
  const [editing, setEditing] = useState<AgentField | null>(null);
  const menu = useContextMenu();
  const items = (): Array<MenuItem | '-'> => [
    ...agentMenuItems(task, { onRename: setEditing, onArchive: conversations.archive, onDelete: conversations.remove }),
    ...(onFork ? [{ id: 'fork-chat', label: t('Fork chat…'), icon: 'branch' as const, onSelect: onFork, disabled: task.status === 'running' || task.status === 'starting' }] : []),
    { id: 'chat-controls', label: t('Chat controls…'), icon: 'gear', onSelect: onControls },
  ];
  return (
    <>
      <span
        className={`task-name${editing ? ' editing' : ''}`}
        data-testid="focus-title"
        tabIndex={editing ? undefined : 0}
        onDoubleClick={() => { if (!editing && !isMainAgent(task)) setEditing('name'); }}
        onContextMenu={(e) => { if (!editing) menu.open(menuAt(e, items())); }}
        onKeyDown={(e) => {
          if (editing) return;
          const context = menuKey(e, items);
          if (context) menu.open(context);
        }}
        title={editing ? undefined : t('Right-click for chat controls')}
      >
        <EditableAgentName task={task} tasks={tasks} editing={editing} onDone={() => setEditing(null)} />
      </span>
      {menu.element}
      {conversations.element}
    </>
  );
}

// Memoized: resizing the window (or the side column) re-renders the view on every frame; the
// conversation itself only when what it shows changes.
const Transcript = memo(function Transcript({ items, main, task, snapshot, onOpen }: { items: TranscriptItem[]; main?: boolean; task: Task; snapshot: WorkspaceSnapshot; onOpen?: (taskId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // "Keep as memory" on one of the user's messages: the dialog, and the right-click menu that opens it.
  const [remember, setRemember] = useState<string | null>(null);
  const [rewind, setRewind] = useState<string | null>(null);
  const canRewind = !main && !!onOpen;
  const rewindBusy = ['running', 'starting'].includes(task.status);
  useEffect(() => setRewind(null), [task.taskId]);
  // Right-click on a message: Copy, and on what the user said themselves, Keep as memory.
  const menu = useContextMenu();
  const stick = useRef(true);
  // ⌘F: find in this conversation (folded turns included).
  const inner = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setFinding(true);
      window.dispatchEvent(new CustomEvent('amw:find-again'));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // Another agent opened in this same view: it starts at its end (where the reader was in the last one,
  // scrolled up or not, says nothing about this one).
  useLayoutEffect(() => {
    stick.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [task.taskId]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  // Also when the size changes (the preview opens or is resized, the window, images loading):
  // a conversation that was at its end stays at its end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const keep = () => stick.current && (el.scrollTop = el.scrollHeight);
    const ro = new ResizeObserver(keep);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  const shown = items.filter((i) => i.tool?.name !== 'ToolSearch').map(presentTranscriptItem);
  const order = new Map(shown.map((x, n) => [x.id, n]));
  const turns = splitTurns(shown);
  const renderEntry = (entry: TranscriptItem | TranscriptItem[] | { notices: TranscriptItem[] }) => {
          if (Array.isArray(entry)) return <ToolGroup key={entry[0].id} items={entry} main={main} />;
          if ('notices' in entry) return <NoticeGroup key={entry.notices[0].id} notices={entry.notices} />;
          const item = entry;
          if (item.role === 'tool') return <ToolCallRow key={item.id} item={item} />;
          if (item.role === 'thought')
            return (
              <details key={item.id} className="msg thought">
                <summary>
                  <Icon name="bulb" size={13} /> {t('Thinking')}{item.streaming ? '…' : ''}
                </summary>
                <Markdown text={item.text} />
              </details>
            );
          if (item.role === 'system' && item.chapter)
            return (
              <div key={item.id} className="chapter-divider" data-testid="chapter-divider">
                <span>
                  {t('A new chapter')} · {new Date(item.createdAt).toLocaleString(language() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {item.chapter.reason === 'idle' ? ` · ${t('after a long pause')}` : item.chapter.reason === 'long' ? ` · ${t('after a long stretch')}` : ''}
                </span>
              </div>
            );
          if (item.role === 'plan')
            return (
              <div key={item.id} className="msg plan-proposal" data-testid="plan-proposal">
                <div className="section-label">
                  <Icon name="list" size={12} /> {t('Proposed plan')}
                </div>
                <Markdown text={item.text} />
              </div>
            );
          return (
            <div
              key={item.id}
              className={`msg ${item.role}${item.role === 'user' && item.via === 'main' ? ' from-main' : ''}`}
              data-role={item.role}
              data-item-id={item.id}
              onContextMenu={
                item.role === 'user' || item.role === 'assistant'
                  ? (e) => {
                      // Copy takes the text selected in this message, else the whole message.
                      const sel = window.getSelection();
                      const picked = sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode) ? sel.toString() : '';
                      const text = picked || item.text;
                      menu.open(
                        menuAt(
                          e,
                          [
                            item.role === 'user' && item.via !== 'main' && canRewind && { id: 'rewind', label: t('Rewind to this message'), icon: 'history' as const, disabled: rewindBusy, onSelect: () => setRewind(item.id) },
                            item.role === 'user' && item.via !== 'main' && { id: 'remember', label: t('Keep as memory…'), icon: 'remember' as const, onSelect: () => setRemember(item.id) },
                            !!text.trim() && { id: 'copy', label: picked ? t('Copy selection') : t('Copy'), icon: 'copy' as const, onSelect: () => void navigator.clipboard.writeText(text).catch(() => {}) },
                          ],
                          'message-menu',
                        ),
                      );
                    }
                  : undefined
              }
            >
              {item.role === 'user' && item.contextNotes?.length ? <ContextNotes notes={item.contextNotes}/> : null}
              {item.role === 'user' ? <>
                  {item.delivery === 'steer' ? <span className="delivery-tag">{t('added mid-turn')}</span> : null}
                  {item.delivery === 'interrupt' ? <span className="delivery-tag interrupt">{t('stopped the turn')}</span> : null}
                </> : null}
              {item.role === 'user' && item.images?.length ? <MessageImages images={item.images} /> : null}
              {item.role === 'user' && item.questionReplies?.length ? <QuestionReplyMessage replies={item.questionReplies} originalText={item.originalText} /> : item.role === 'user' && !item.text.trim() && item.images?.length ? null : item.role === 'system' && item.memoryUpdate?.length ? (
                <details className="msg-system memory-sent" data-testid="memory-sent">
                  <summary>
                    <Icon name="spark" size={11} /> {t('Memory sent with this message: {n}', { n: item.memoryUpdate.length })}
                  </summary>
                  <ul>
                    {item.memoryUpdate.map((b, i) => (
                      <li key={i} className={b.startsWith('✕ ') ? 'gone' : ''}>
                        {b.startsWith('✕ ') ? `${t('No longer applies')}: ${b.slice(2)}` : b}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : item.role === 'system' ? (
                <div className="msg-system">{systemText(item.text)}</div>
              ) : (
                <Markdown text={item.text} streaming={item.streaming} mentions={item.role === 'user'} />
              )}
              {item.streaming ? <span className="cursor" aria-hidden /> : null}
              {item.role === 'user' || (item.role === 'assistant' && !item.streaming) ? (
                <div className="message-actions">
                  {item.role === 'user' && item.via !== 'main' && canRewind ? <RewindButton disabled={rewindBusy} onClick={() => setRewind(item.id)} /> : null}
                  {item.role === 'user' && item.via !== 'main' ? <RememberButton onClick={() => setRemember(item.id)} /> : null}
                  {item.text.trim() ? <MessageCopyButton text={item.text} /> : null}
                </div>
              ) : null}
            </div>
          );
          };
  return (
    <>
    {finding ? <FindBar scope={inner} version={items} onClose={() => setFinding(false)} onJump={() => (stick.current = false)} /> : null}
    <div
      className="transcript"
      ref={ref}
      data-testid="transcript"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      <div className="transcript-inner" ref={inner}>
        {items.length === 0 ? <div className="muted pad">{t('No messages yet.')}</div> : null}
        {turns.map((turn, i) => {
          const entries = (list: TranscriptItem[]) => groupNotices(groupTranscript(list, main), main).map(renderEntry);
          const visibleStep = (item: TranscriptItem) => item.role === 'assistant' || item.role === 'user'
            || (item.role === 'system' && !item.memoryUpdate?.length)
            || (!!item.toolStatus && item.toolStatus !== 'completed');
          const settled = i < turns.length - 1 || !['starting', 'running', 'waiting_for_user'].includes(task.status);
          const fold = settled && !turn.live && !turn.steps.some(visibleStep)
            && (foldsTurn(turn, i, turns.length) || (!!turn.final && turn.steps.length > 0));
          if (!fold) {
            const ordered = [turn.user, ...turn.steps, turn.final].filter((item): item is TranscriptItem => !!item)
              .sort((x, y) => order.get(x.id)! - order.get(y.id)!);
            const groups: Array<{ quiet: boolean; items: TranscriptItem[] }> = [];
            for (const item of ordered) {
              const quiet = item.role === 'thought' || (item.role === 'tool' && (!item.toolStatus || item.toolStatus === 'completed'));
              const last = groups.at(-1);
              if (last?.quiet === quiet) last.items.push(item);
              else groups.push({ quiet, items: [item] });
            }
            return <Fragment key={turn.user?.id ?? `t${i}`}>{groups.map(({ quiet, items }) => (
              quiet
                ? <WorkActivity key={items[0].id} label={t('Work details')} detail={turnSummary({ steps: items, live: false })}>{entries(items)}</WorkActivity>
                : <Fragment key={items[0].id}>{entries(items)}</Fragment>
            ))}</Fragment>;
          }
          const end = turn.final ?? turn.steps.at(-1);
          const seconds = turn.user && end ? Math.floor((Date.parse(end.createdAt) - Date.parse(turn.user.createdAt)) / 1000) : 0;
          const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
          return (
            <Fragment key={turn.user?.id ?? `t${i}`}>
              {turn.user ? renderEntry(turn.user) : null}
              <WorkActivity label={seconds >= 1 ? t('Worked for {duration}', { duration }) : t('Work details')} detail={turnSummary(turn)}>{entries(turn.steps)}</WorkActivity>
              {turn.final ? renderEntry(turn.final) : null}
            </Fragment>
          );
        })}
      </div>
      {menu.element}
      {rewind ? <RewindDialog task={task} messageId={rewind} onClose={() => setRewind(null)} onRewound={(taskId, text, images) => {
        setDraftImages(taskId, images); setDraftText(taskId, text); onOpen?.(taskId);
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus());
      }} /> : null}
      {remember ? <RememberDialog task={task} itemId={remember} snapshot={snapshot} onClose={() => setRemember(null)} /> : null}
    </div>
    </>
  );
});

function WorkActivity({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return (
    <details className="turn-fold" data-testid="turn-fold">
      <summary title={detail}><span>{label}</span><Icon name="chevron" size={11} /></summary>
      <div className="turn-steps">{children}</div>
    </details>
  );
}

function MessageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="icon-btn" aria-label={t('Copy message')} title={t(copied ? 'Copied' : 'Copy message')} data-testid="copy-message" onClick={() => {
      void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {});
    }} onMouseLeave={() => setCopied(false)} onBlur={() => setCopied(false)}>
      <Icon name={copied ? 'check' : 'copy'} size={13} />
    </button>
  );
}

/** A worker's "waiting on you" / "request is settled" note in the main agent's conversation. */
const NOTICE_RE = /^(.+?)(?: is waiting on you \((?:permission|question)\): |'s request is settled: )/;

/**
 * In the main agent's conversation, consecutive worker notes fold into one line: with
 * many agents waiting they would otherwise fill the conversation, repeating the list above.
 */
function groupNotices(entries: Array<TranscriptItem | TranscriptItem[]>, main?: boolean): Array<TranscriptItem | TranscriptItem[] | { notices: TranscriptItem[] }> {
  if (!main) return entries;
  const out: Array<TranscriptItem | TranscriptItem[] | { notices: TranscriptItem[] }> = [];
  let run: TranscriptItem[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ notices: run });
    else out.push(...run);
    run = [];
  };
  for (const e of entries) {
    if (!Array.isArray(e) && e.role === 'system' && NOTICE_RE.test(e.text)) run.push(e);
    else {
      flush();
      out.push(e);
    }
  }
  flush();
  return out;
}

function NoticeGroup({ notices }: { notices: TranscriptItem[] }) {
  const waiting = notices.filter((n) => / is waiting on you \(/.test(n.text)).length;
  const settled = notices.length - waiting;
  const names = [...new Set(notices.map((n) => NOTICE_RE.exec(n.text)?.[1] ?? ''))].filter(Boolean);
  const parts = [waiting ? t('{n} requests from agents', { n: waiting }) : '', settled ? t('{n} settled', { n: settled }) : ''].filter(Boolean).join(' · ');
  return (
    <details className="msg notices" data-testid="notice-group">
      <summary className="msg-system">
        <Icon name="chevron" size={10} />
        {parts} — {names.slice(0, 4).join(', ')}
        {names.length > 4 ? ` +${names.length - 4}` : ''}
      </summary>
      {notices.map((n) => (
        <div key={n.id} className="msg-system">
          {systemText(n.text)}
        </div>
      ))}
    </details>
  );
}

function Composer({
  task,
  session,
  onVoiceSlot,
  onBtw,
  inject,
  about,
  onClearAbout,
  permissionMode,
  context,
  under,
}: {
  task: Task;
  session?: SessionRecord;
  onVoiceSlot: (slot: HTMLSpanElement | null) => void;
  permissionMode?: PermissionMode;
  context: ReactNode;
  /** Shown under the box, on the right (the account's limits, when close). */
  under?: ReactNode;
  onBtw?: (question: string) => void;
  inject?: { text: string; n: number };
  /** The request the message is likely about (unfolded above): sent along as a hint, shown here. */
  about?: { id: string; headline: string };
  onClearAbout?: () => void;
}) {
  // The unsent message is the agent's, not the box's: it is still there after the Overview or another
  // agent, and the agent's Overview tile shows the same text.
  const [draft, setDraft] = useDraft(task.taskId);
  const box = useRef<HTMLTextAreaElement>(null);
  // Back to a message left half-written: ready to go on where it ended.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !el.value) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Text handed back from elsewhere (a side answer brought into the conversation): into the box to edit.
  // Only text handed back while this box is shown: the box is made anew for each agent, and an
  // answer brought into one agent's conversation earlier must not land in the next agent's box.
  const injected = useRef(inject?.n ?? 0);
  useEffect(() => {
    if (!inject?.text || inject.n === injected.current) return;
    injected.current = inject.n;
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${inject.text}` : inject.text));
  }, [inject?.n]);
  // What is being said on this page shows here as it is transcribed (the voice bar has no box of
  // its own on an agent's page). `base` is what was typed before; the spoken part follows it.
  const [voice, setVoiceState] = useState<string | null>(null);
  const voiceRef = useRef<string | null>(null);
  const setVoice = (v: string | null) => {
    voiceRef.current = v;
    setVoiceState(v);
  };
  const base = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const join = (a: string, b: string) => (a.trim() && b ? `${a.trimEnd()} ${b}` : a || b);
    const onDraft = (ev: Event) => {
      const { taskId, text, phase } = (ev as CustomEvent<{ taskId: string; text: string; phase: 'listening' | 'keep' | 'drop' }>).detail;
      if (taskId !== task.taskId) return;
      // A new spoken draft starts after whatever is in the box now.
      if (voiceRef.current === null) base.current = draftRef.current;
      if (phase === 'listening') {
        setVoice(text);
        setDraft(join(base.current, text));
        return;
      }
      // Kept: it is part of the message now, to check and send. Dropped: back to what was typed.
      setVoice(null);
      setDraft(phase === 'keep' ? join(base.current, text) : base.current);
      if (phase === 'keep') box.current?.focus();
    };
    window.addEventListener('amw:voice-draft', onDraft);
    return () => window.removeEventListener('amw:voice-draft', onDraft);
  }, [task.taskId]);
  /** Typing into, or sending, a box that holds a spoken draft takes it over: it is not sent again. */
  const takeVoice = () => {
    if (voiceRef.current === null) return;
    setVoice(null);
    window.dispatchEvent(new CustomEvent('amw:voice-taken', { detail: { taskId: task.taskId } }));
  };
  const [error, setError] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [savingPermission, setSavingPermission] = useState(false);
  const [sending, setSending] = useState(false);
  // Images pasted, dropped or picked go with the next message (the main agent passes them on when the work is about them).
  // @ lists the files in the agent's folder (the main agent has none: only @~/ and @/ browse there).
  const mention = useMentions(task.taskId, box, draft, setDraft, { browseOnly: isMainAgent(task) });
  // Other files dropped here are mentioned with @, as if picked from the list.
  const attach = useAttachments(async (files) => {
    const text = await dropMentions(task.taskId, files);
    if (text) mention.insert(text);
    box.current?.focus();
  }, task.taskId);
  // While the agent works, Enter adds to what it is doing (read at its next step);
  // ⌘Enter stops the current turn and starts over with this message.
  const working = task.status === 'running' || task.status === 'starting';
  // `!command` runs a command in the agent's folder, as in the CLIs.
  const shell = draft.trimStart().startsWith('!') && !isMainAgent(task);
  const needsTurn = task.provider === 'antigravity' && working && !shell;
  const suggestion = !draft && task.suggestion ? task.suggestion : '';
  /**
   * A side question ("btw"): the same box, another way to send (⌥↵, the bubble button, or a message
   * starting /btw). It goes to the side column, never into the conversation, and interrupts nothing.
   * The button with nothing typed just opens the side questions.
   */
  const btw = () => {
    if (!onBtw) return;
    const text = draft.trim().replace(/^\/btw\b\s*/i, '');
    onBtw(text);
    if (text) setDraft('');
  };
  const send = async (interrupt = false) => {
    const text = draft.trim();
    const images = shell ? [] : attach.refs;
    if ((!text && !images.length) || sending || attach.busy || (needsTurn && !interrupt)) return;
    takeVoice();
    if (onBtw && /^\/btw\b/i.test(text)) return btw();
    setSending(true);
    setError('');
    try {
      const command = text.slice(1).trim();
      if (shell && !command) return;
      // A command can run for a while (its row shows it running): the box is free at once, and
      // gets the command back if it could not run.
      if (shell) setDraft('');
      const r = shell
        ? await call('task:shell', { taskId: task.taskId, command })
        : await call('task:send', { taskId: task.taskId, text, via: 'text', interrupt, ...(images.length ? { images } : {}), ...(about ? { about: about.id } : {}) });
      if (r.ok) {
        if (!shell) {
          setDraft('');
          attach.clear();
        }
      } else {
        if (shell) setDraft((d) => d || text);
        setError(r.error ?? t('Not delivered'));
      }
    } catch (e) {
      if (shell) setDraft((d) => d || text);
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="composer">
      {about ? (
        <div className="composer-about" data-testid="composer-about">
          <span className="composer-about-label">{t('About this request')}</span>
          <span className="composer-about-text">{about.headline}</span>
          <button className="composer-about-clear" onClick={onClearAbout} aria-label={t('Not about this request')} title={t('Not about this request')} data-testid="composer-about-clear">
            <Icon name="x" size={11} />
          </button>
        </div>
      ) : null}
      <MentionMenu m={mention} />
      <div
        className={`composer-box${shell ? ' shell-mode' : ''}${suggestion ? ' has-suggestion' : ''}${voice !== null ? ' voice-live' : ''}${attach.dragging ? ' dropping' : ''}`}
        data-voice={voice !== null || undefined}
        {...attach.dropProps}
      >
        <AttachmentStrip items={attach.items} busy={attach.busy} onRemove={attach.remove} />
        <div className="composer-field">
        <MentionHighlight text={draft} box={box} />
        <textarea
          ref={box}
          className="composer-input"
          rows={2}
          aria-label={t('Message')}
          // A new agent with nothing asked yet: ready for its first message.
          autoFocus={!task.title.trim()}
          value={draft}
          placeholder={suggestion || t('Write a message…')}
          onChange={(e) => {
            takeVoice();
            setDraft(e.target.value);
          }}
          data-testid="composer-input"
          data-suggestion={suggestion || undefined}
          onPaste={attach.onPaste}
          onSelect={mention.update}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (mention.onKeyDown(e) || mention.onBackspace(e)) return;
            // → or Tab takes the suggested reply into the box (edit it, or Enter to send).
            if (suggestion && (e.key === 'ArrowRight' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey) {
              e.preventDefault();
              setDraft(suggestion);
              return;
            }
            if (e.key === 'Enter' && e.altKey && !e.nativeEvent.isComposing && onBtw) {
              e.preventDefault();
              if (draft.trim()) btw();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const field = e.currentTarget;
              if (!e.metaKey && !e.ctrlKey && !e.altKey && !shell && field.selectionStart === field.selectionEnd) {
                const insert = nextListItem(field.value, field.selectionStart);
                if (insert !== null) {
                  takeVoice();
                  field.setRangeText(insert, field.selectionStart, field.selectionEnd, 'end');
                  setDraft(field.value);
                  return;
                }
              }
              void send(e.metaKey || e.ctrlKey);
            }
          }}
        />
        </div>
        <div className="composer-foot" role="group" aria-label={t('Message settings')}>
          {!shell ? <AttachButton kind="plus" onFiles={(files) => void attach.add(files)} /> : null}
          {!shell && permissionMode ? (
              <label className="composer-permissions" title={t('Permissions')}>
                <Icon name="shield" size={13} />
                <select
                  value={permissionMode}
                  disabled={savingPermission}
                  aria-label={t('Permissions')}
                  data-testid="task-permission"
                  onChange={async (event) => {
                    setPermissionError('');
                    setSavingPermission(true);
                    try {
                      await call('task:setPermissionMode', { taskId: task.taskId, mode: event.target.value as PermissionMode });
                    } catch (error) {
                      setPermissionError(errorText(error));
                    } finally {
                      setSavingPermission(false);
                    }
                  }}
                >
                  {PERMISSION_MODES.map((mode) => <option key={mode.id} value={mode.id} title={t(mode.detail)}>{t(mode.label)}</option>)}
                </select>
              </label>
          ) : null}
          {shell ? <span className="to-label" data-testid="composer-target">{t('Command')} · {task.host ?? t('this Mac')}</span> : null}
          <span className="composer-spacer" />
          {!shell ? <>
            <span className="composer-context">{context}</span>
            <ModelPicker task={task} session={session} />
          </> : null}
          <span ref={onVoiceSlot} className="composer-voice" />
          {working && !shell ? (
            <button className="btn btn-icon composer-interrupt" disabled={(!draft.trim() && !attach.items.length) || sending || attach.busy} onClick={() => void send(true)} aria-label={t('Stop & send')} title={t('Stop the current turn and start over with this message')} data-testid="send-interrupt">
              <Icon name="interrupt-send" />
            </button>
          ) : null}
          {onBtw && !shell ? (
            <button className="btw-btn" aria-label={t('Side chat')} data-tip={t('Side chat')} onClick={btw} data-testid="btw-send">
              <Icon name="btw" />
            </button>
          ) : null}
          <button className="send-btn" aria-label={t('Send')} title={t('Send')} disabled={(!draft.trim() && !(attach.items.length && !shell)) || sending || attach.busy || needsTurn} onClick={() => void send()}>
            <Icon name="send" />
          </button>
        </div>
      </div>
      {under ? <div className="composer-under">{under}</div> : null}
      {permissionError ? <div className="error-text" role="alert">{permissionError}</div> : null}
      {error || attach.error ? <div className="error-text">{error || attach.error}</div> : null}
    </div>
  );
}
