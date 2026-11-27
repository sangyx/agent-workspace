import { ArchivedConversations } from '../../renderer/components/ArchivedConversations';
import { useConversationActions } from '../../renderer/components/ConversationActions';
import { ProjectConversationActions } from '../../renderer/components/ProjectConversationActions';
import { useState, type MouseEvent } from 'react';
import { needsYou, recentConversations, type Team } from '../../shared/agent-order';
import type { Task, WorkspaceSnapshot } from '../../shared/types';
import { displayName, Icon, liveSubtasks, PROVIDER_LABEL, STATUS_LABEL, SubtaskDots, SubtaskThread } from './bits';
import { AccountLimits } from './SessionUsage';
import { useTick } from '../state';
import { t as tr } from '../i18n';
import { call, errorText } from '../api';
import { InlineEdit, menuAt, menuKey, useContextMenu, type MenuItem } from './ContextMenu';
import { agentMenuItems, EditableAgentName, type AgentField } from './AgentMenu';

/**
 * Always-visible participant list. In Focus it doubles as the rail that keeps
 * every other agent's pending request in view.
 */
/**
 * The row's dot: green only for a result you have not looked at (grey once seen; it stays listed),
 * hollow for an agent you set aside, as for one that is stopped.
 */
function dotStatus(t: Task): string {
  if (t.setAside && (t.status === 'done' || t.status === 'idle')) return 'idle';
  if (t.status === 'done' && !t.unread) return 'seen';
  return t.status;
}

export function Sidebar({
  snapshot,
  focusId,
  onSelect,
  onHome,
  onOverview,
  onNewTask,
  onResume,
  onSettings,
  page,
  teamList,
  expanded,
  toggle,
  onOpenSubtask,
}: {
  snapshot: WorkspaceSnapshot;
  focusId: string | null;
  onSelect: (taskId: string) => void;
  onHome: () => void;
  onOverview: () => void;
  onNewTask: () => void;
  onResume: () => void;
  onSettings: () => void;
  page: 'home' | 'overview' | 'settings';
  /** Opens a sub-agent's read-only view. */
  onOpenSubtask: (taskId: string, subtaskId: string) => void;
  /** Project teams, in order (App computes them so ⌘1–9 match). */
  teamList: Team[];
  expanded: (team: Team) => boolean;
  toggle: (team: Team) => void;
}) {
  const signedOut = snapshot.capabilities.filter((c) => c.provider !== 'mock' && c.available && c.auth?.loggedIn === false);
  const openAll = snapshot.attention.filter((a) => a.state === 'open');
  const open = openAll.filter((a) => a.kind !== 'completion');
  // Agents set aside are not counted: whatever they were waiting on is hidden with them.
  const asideIds = new Set(snapshot.tasks.filter((t) => t.setAside).map((t) => t.taskId));
  const needYou = new Set(open.filter((a) => !asideIds.has(a.taskId)).map((a) => a.taskId)).size;
  const [showIdle, setShowIdle] = useState<Record<string, boolean>>({});
  const [addingProject, setAddingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const addProject = async () => {
    setAddingProject(true);
    setProjectError('');
    try {
      const rootPath = await call('project:pickDirectory', {});
      if (rootPath) {
        const project = await call('project:add', { rootPath });
        setShowProjects(true);
        setEditing({ projectId: project.projectId });
      }
    } catch (error) {
      setProjectError(errorText(error));
    } finally {
      setAddingProject(false);
    }
  };
  // Right-click: one menu at a time; a rename edits the name where it stands.
  const menu = useContextMenu();
  const conversations = useConversationActions();
  const [editing, setEditing] = useState<{ taskId: string; field: AgentField; needs: boolean } | { projectId: string } | null>(null);
  const editingField = (t: Task, needs: boolean) => (editing && 'taskId' in editing && editing.taskId === t.taskId && editing.needs === needs ? editing.field : null);
  const editingProject = (id: string) => !!editing && 'projectId' in editing && editing.projectId === id;
  const projectItems = (projectId: string): MenuItem[] => [{ id: 'rename-project', label: tr('Rename project…'), icon: 'pencil', onSelect: () => setEditing({ projectId }) }];
  const projectMenu = (e: MouseEvent, projectId: string) => menu.open(menuAt(e, projectItems(projectId)));
  const projectNameEdit = (team: Team) => (
    <InlineEdit
      value={team.project.name}
      label={tr('Project name')}
      testId="rename-project-input"
      className="team-name-edit"
      onSave={(v) => call('project:rename', { projectId: team.project.projectId, name: v })}
      onDone={() => setEditing(null)}
    />
  );
  // Agents whose sub-agents are unfolded (folded by default; the marks go when the turn ends).
  const [subOpen, setSubOpen] = useState<Set<string>>(new Set());
  const toggleSub = (id: string, open?: boolean) =>
    setSubOpen((cur) => {
      const next = new Set(cur);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  // Running sub-agents show their elapsed time.
  const now = useTick(snapshot.tasks.some((t) => t.subtasks?.some((x) => x.status === 'running')) ? 1000 : 30_000);
  const waiting = needsYou(snapshot.tasks, openAll);
  const projectName = (id: string) => snapshot.projects.find((p) => p.projectId === id)?.name ?? '';
  // Projects where nothing is going on (every agent idle for days or set aside) fold into one
  // "Archived" row at the end, so the list does not grow with every project ever used. A project
  // comes back by itself as soon as one of its agents does something, or is opened or messaged.
  const live = teamList.filter((team) => team.active);
  const listedProjects = new Set(teamList.map((team) => team.project.projectId));
  for (const project of snapshot.projects) {
    if (!listedProjects.has(project.projectId)) {
      live.push({ project, members: [], idle: [], counts: { waiting: 0, running: 0, failed: 0 }, active: true });
    }
  }
  const hasResearch=snapshot.projects.some(p=>p.kind==='research');
  const [showProjects, setShowProjects] = useState(false);
  const visibleProjects = showProjects ? live : live.filter((team, i) => i < 6 || team.members.some((task) => task.taskId === focusId) || team.idle.some((task) => task.taskId === focusId) || editingProject(team.project.projectId));
  const archived = teamList.filter((team) => !team.active);
  const [archiveOpen, setArchiveOpenState] = useState(() => localStorage.getItem('amw.archiveOpen') === '1');
  const setArchiveOpen = (on: boolean) => {
    localStorage.setItem('amw.archiveOpen', on ? '1' : '0');
    setArchiveOpenState(on);
  };
  // The agent on screen is always visible in the list.
  const archiveShown = archiveOpen || archived.some((team) => snapshot.tasks.some((t) => t.taskId === focusId && t.projectId === team.project.projectId));
  const renderTeam = (team: Team) => {
          const open_ = expanded(team);
          const idleShown = showIdle[team.project.projectId];
          return (
            <div key={team.project.projectId} className={`team${open_ ? ' open' : ''}`} data-testid="team" data-project={team.project.name}>
              {editingProject(team.project.projectId) ? (
                <div className="team-head editing" data-testid="team-head">
                  <span className="project-glyph" aria-hidden>
                    <Icon name={team.project.kind==='research' ? 'research-folder' : 'folder'} size={18} />
                  </span>
                  {projectNameEdit(team)}
                </div>
              ) : (
              <div className="project-heading">
              <button
                className="team-head"
                onClick={() => toggle(team)}
                onContextMenu={(e) => projectMenu(e, team.project.projectId)}
                onKeyDown={(e) => {
                  const m = menuKey(e, () => projectItems(team.project.projectId));
                  if (m) menu.open(m);
                }} aria-expanded={open_} data-testid="team-head">
                <span className="project-glyph" aria-hidden>
                  <Icon name={team.project.kind==='research' ? 'research-folder' : 'folder'} size={18} />
                </span>
                <span className="team-name truncate">{team.project.name}</span>
              </button>
              {projectActions(team.project.projectId)}
              </div>
              )}
              {open_ ? (
                <>
                  {recentConversations(idleShown ? [...team.members, ...team.idle] : team.members).map((t) => row(t))}
                  {team.idle.length ? (
                    <>
                      <button className="team-idle" onClick={() => setShowIdle((cur) => ({ ...cur, [team.project.projectId]: !idleShown }))} data-testid="team-idle">
                        {idleShown ? tr('Show less') : tr('Show more')} · {team.idle.length}
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          );
          };
  function projectActions(projectId: string) {
    return (
      <button
        className="icon-btn project-actions"
        aria-label={tr('Project options')}
        data-testid="project-options"
        onClick={(e) => {
          const bounds = e.currentTarget.getBoundingClientRect();
          menu.open({ x: bounds.left, y: bounds.bottom, items: projectItems(projectId), keyboard: e.detail === 0 });
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
    );
  }
  // In the archive every agent is idle: no second fold per project, nor an idle row; each project is a
  // label over all its agents, so opening the archive shows them.
  const renderArchived = (team: Team) => {
    const agents = recentConversations([...team.members, ...team.idle]);
    return (
      <div key={team.project.projectId} className="team archived open" data-testid="team" data-project={team.project.name}>
        <div className="team-head archived-head" data-testid="team-head" onContextMenu={(e) => projectMenu(e, team.project.projectId)}>
          {editingProject(team.project.projectId) ? projectNameEdit(team) : <span className="team-name truncate">{team.project.name}</span>}
          {!editingProject(team.project.projectId) ? projectActions(team.project.projectId) : null}
        </div>
        {agents.map((t) => row(t))}
      </div>
    );
  };
  const row = (t: Task, opts: { project?: string; needs?: boolean } = {}) => {
    const pending = open.filter((a) => a.taskId === t.taskId);
    const subs = opts.needs ? undefined : liveSubtasks(t);
    const unfolded = !!subs?.length && subOpen.has(t.taskId);
    const field = editingField(t, !!opts.needs);
    const items = () => agentMenuItems(t, { onRename: (f) => setEditing({ taskId: t.taskId, field: f, needs: !!opts.needs }), setAside: true, onArchive: conversations.archive, onDelete: conversations.remove, onOpen: () => onSelect(t.taskId) });
    const cls = `agent-row status-${t.status}${t.taskId === focusId ? ' active' : ''}${pending.length ? ' needs' : ''}${opts.needs ? ' compact' : ''}`;
    const inner = (
      <>
        <span className="agent-row-text">
          <span className="agent-row-name">
            <EditableAgentName task={t} tasks={snapshot.tasks} editing={field} onDone={() => setEditing(null)} />
            <span className={`status status-${dotStatus(t)}`} data-testid="row-dot" data-dot={dotStatus(t)}>
              <span className="dot" aria-label={tr(STATUS_LABEL[t.status])} />
            </span>
          </span>
          {subs?.length || opts.project ? (
            <span className="agent-row-sub">
              <SubtaskDots subtasks={subs} open={unfolded} onToggle={() => toggleSub(t.taskId)} />
              {opts.project ? <span className="row-summary truncate">{opts.project} · {tr('Waiting on you')}</span> : null}
            </span>
          ) : null}
        </span>
      </>
    );
    return (
      // Unfolded, the row and its sub-agents are one card.
      <div key={`${opts.needs ? 'needs-' : ''}${t.taskId}`} className={`agent-item${unfolded ? ' unfolded' : ''}${t.taskId === focusId ? ' active' : ''}`}>
      {field ? (
        // Renamed in place: an input cannot sit in a button, so the row is a plain box meanwhile.
        <div className={`${cls} editing`} data-testid={opts.needs ? 'needs-item' : 'rail-item'} data-alias={t.alias}>
          {inner}
        </div>
      ) : (
      <button
        className={cls}
        onClick={() => onSelect(t.taskId)}
        onContextMenu={(e) => menu.open(menuAt(e, items()))}
        onKeyDown={(e) => {
          const m = menuKey(e, items);
          if (m) return menu.open(m);
          // Like a tree: → unfolds sub-agents, ← folds them.
          if (subs?.length && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
            e.preventDefault();
            toggleSub(t.taskId, e.key === 'ArrowRight');
          }
          // F2 renames, as in a file list.
          if (e.key === 'F2') {
            e.preventDefault();
            setEditing({ taskId: t.taskId, field: 'name', needs: !!opts.needs });
          }
        }}
        data-testid={opts.needs ? 'needs-item' : 'rail-item'}
        data-alias={t.alias}
        title={`${displayName(t)} · ${tr(STATUS_LABEL[t.status])}`}
      >
        {inner}
      </button>
      )}
      {unfolded ? <SubtaskThread subtasks={subs!} now={now} steps={false} onOpen={(id) => onOpenSubtask(t.taskId, id)} /> : null}
      </div>
    );
  };
  return (
    <aside className="sidebar-shell">
      <nav className="workspace-rail" aria-label={tr('Workspace tools')}>
        <button className="rail-button" aria-current={page === 'home' ? 'page' : undefined} onClick={onHome} title={tr('Home')} aria-label={tr('Home')}>
          <Icon name="home" size={18} />
        </button>
        <button className="rail-button" aria-current={page === 'overview' ? 'page' : undefined} onClick={onOverview} title={tr('Overview')} aria-label={tr('Overview')}>
          <Icon name="grid" size={18} />
          {needYou ? <span className="rail-badge" aria-hidden>{needYou}</span> : null}
        </button>
        <div className="workspace-rail-footer">
          <AccountLimits
            rail
            limits={snapshot.limits ?? {}}
            now={now}
            payAsYouGo={snapshot.capabilities.filter((c) => (c.provider === 'claude' || c.provider === 'codex') && c.auth?.loggedIn && /api key/i.test(c.auth.method ?? '')).map((c) => c.provider)}
          />
          <button className="rail-button" aria-current={page === 'settings' ? 'page' : undefined} onClick={onSettings} title={tr('Settings')} aria-label={tr('Settings')} data-testid="open-settings">
            <Icon name="gear" size={18} />
          </button>
        </div>
      </nav>
      <div className="sidebar">
      <div className="sidebar-top drag">
        <span className="brand">
          Agent Workspace
          {snapshot.demo ? <span className="demo-badge" title={tr('Demo entry: mock agents, separate data (npm run demo)')}>{tr('Demo')}</span> : null}
        </span>
      </div>


      {snapshot.main ? <div className="sidebar-section"><span>{tr('Chats')}</span></div> : null}

      {snapshot.main ? (
        <button
          className={`agent-row main-row status-${snapshot.main.status}${snapshot.main.taskId === focusId ? ' active' : ''}`}
          onClick={() => onSelect(snapshot.main!.taskId)}
          data-testid="main-agent-row"
          title={tr('Workspace chat')}
        >
          <span className="agent-row-text">
            <span className="agent-row-name">
              <span className="truncate">{tr('Workspace chat')}</span>
              <span className={`status status-${snapshot.main.status}`}>
                <span className="dot" aria-label={tr(STATUS_LABEL[snapshot.main.status])} />
              </span>
            </span>
          </span>
        </button>
      ) : null}

      {waiting.length ? (
        <div className="needs-strip" data-testid="needs-strip">
          <div className="sidebar-section needs-head">
            <span>
              {tr('Needs you')} <span className="count">{waiting.length}</span>
            </span>
          </div>
          {waiting.map((t) => row(t, { project: projectName(t.projectId), needs: true }))}
        </div>
      ) : null}

      <div className="sidebar-section">
        <span>{tr('Projects')}</span>
        <ProjectConversationActions onNewChat={onNewTask} onContinue={onResume} onAddFolder={() => void addProject()} addingFolder={addingProject} />
      </div>
      {projectError ? <div className="error-text pad-x" role="alert">{projectError}</div> : null}
      <nav className="agent-list" aria-label={tr('Projects')} onScroll={showScrollbarAWhile} data-testid="agent-list">
        {snapshot.projects.length === 0 ? <div className="muted small pad-x">{tr('No projects yet.')}</div> : null}
        {(['research','chat'] as const).map(kind=>{
          const teams=visibleProjects.filter(team=>(team.project.kind||'chat')===kind);
          return teams.length ? <div key={kind} data-project-kind={kind}>{hasResearch?<div className="sidebar-section"><span>{tr(kind==='research'?'Research projects':'Other projects')}</span></div>:null}{teams.map(renderTeam)}</div>:null;
        })}
        {live.length > 6 ? <button className="team-idle" aria-expanded={showProjects} onClick={() => setShowProjects(!showProjects)}>{tr(showProjects ? 'Show less' : 'Show more')}</button> : null}
        <ArchivedConversations tasks={snapshot.tasks} projects={snapshot.projects} renderRow={row} />
        {archived.length ? (
          <div className="team-archive" data-testid="team-archive">
            <button className="team-head team-archive-head" onClick={() => setArchiveOpen(!archiveShown)} aria-expanded={archiveShown} data-testid="team-archive-head" title={tr('Nothing going on for 3 days; a project comes back when one of its agents is used.')}>
              <span className="team-chevron" aria-hidden>
                <Icon name="chevron" size={12} />
              </span>
              <span className="team-name truncate">{tr('Archived')}</span>
              <span className="team-count idle">{tr('{n} projects', { n: archived.length })}</span>
            </button>
            {archiveShown ? archived.map(renderArchived) : null}
          </div>
        ) : null}
      </nav>

      <div className="sidebar-foot">
        {signedOut.length ? (
          // Only a CLI that is installed but signed out is flagged: its agents cannot run. A missing CLI
          // is a choice (one provider is enough), and voice says so where it is used.
          <button className="sidebar-warn" onClick={onSettings} data-testid="provider-warning">
            <Icon name="alert" size={13} /> <span className="truncate">{tr('{names} signed out', { names: signedOut.map((c) => PROVIDER_LABEL[c.provider]).join(', ') })}</span>
          </button>
        ) : null}
      </div>
      {menu.element}
      {conversations.element}
      </div>
    </aside>
  );
}

/** The list's scrollbar shows while it scrolls and fades a moment after (also with "always show" on). */
const scrollTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
function showScrollbarAWhile(e: { currentTarget: Element }) {
  const el = e.currentTarget;
  el.classList.add('scrolling');
  clearTimeout(scrollTimers.get(el));
  scrollTimers.set(
    el,
    setTimeout(() => el.classList.remove('scrolling'), 900),
  );
}
