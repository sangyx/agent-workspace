import {sessionTitle,isApprovalReviewTitle,filterImportCandidates} from '../../shared/presentation';
import {sessionKey} from '../../shared/session-identity';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NATIVE_PROVIDERS, type AgentProvider, type ForkPoint, type ModelOption, type NativeProvider, type NativeSessionInfo, type Task, type WorkspaceSnapshot } from '../../shared/types';
import { call, errorText } from '../api';
import { setDraftText } from '../drafts';
import { timeAgo } from '../state';
import { Icon, labelOf, PROVIDER_LABEL, ProviderTag, shortVersion } from './bits';
import { t } from '../i18n';
import { defaultProject, ProjectChooser } from './ProjectChooser';

/** Open dialogs, innermost last: Esc closes only the one on top (a confirmation over a dialog). */
const openModals: object[] = [];

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    openModals.push(me);
    // Esc closes the dialog and only the dialog: caught first, so the app's own Esc (back to Overview) never sees it.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openModals.at(-1) !== me) return;
      // A list open inside the dialog closes itself first.
      if ((e.target as Element | null)?.closest?.('[data-own-esc]')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('keydown', esc, true);
      openModals.splice(openModals.indexOf(me), 1);
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {/* Only the body scrolls, so the title stays put and the corners stay round. */}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** The app's own "are you sure?" (not the system dialog): Enter confirms, Esc or Cancel backs out. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm" data-testid="confirm-dialog">
        {message ? <p className="confirm-message">{message}</p> : null}
        <div className="modal-foot">
          <button className="btn" onClick={onClose} data-testid="confirm-cancel">
            {t('Cancel')}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => {
              onClose();
              onConfirm();
            }}
            data-testid="confirm-ok"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** `onContinue`: switch to Continue a session… instead, for someone who meant to pick up an existing conversation. */
export function NewTaskDialog({ snapshot, onClose, onCreated, onContinue }: { snapshot: WorkspaceSnapshot; onClose: () => void; onCreated: (taskId: string) => void; onContinue?: () => void }) {
  const providers = snapshot.demo ? ([...NATIVE_PROVIDERS, 'mock'] as const) : NATIVE_PROVIDERS;
  const firstAvailable = providers.find((p) => snapshot.capabilities.find((c) => c.provider === p)?.available) ?? providers[0];
  // The project used most recently (most of the time the right one); the chooser lists the rest.
  const [projectId, setProjectId] = useState(() => defaultProject(snapshot));
  const [provider, setProvider] = useState<AgentProvider>(firstAvailable);
  const [model, setModel] = useState<ModelOption | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [catalog, setCatalog] = useState<{ projectId: string; provider: AgentProvider; models?: ModelOption[]; error?: string } | null>(null);
  // No title, name or instruction here: the agent opens with its reply box focused, and its first message says what it is for.
  const [isolate, setIsolate] = useState(true);
  const [mockScript, setMockScript] = useState('ask:Should I keep backwards compatibility?');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const project = snapshot.projects.find((p) => p.projectId === projectId);
  const remote = project?.host ? snapshot.remoteHosts.find((h) => h.host === project.host) : undefined;
  // On a remote folder, what counts is the CLI installed on that machine.
  const capOf = (p: AgentProvider) => (project?.host ? remote?.capabilities.find((c) => c.provider === p) : snapshot.capabilities.find((c) => c.provider === p));
  const usable = (p: AgentProvider) => !!capOf(p)?.available && (!project?.host || remote?.ssh === 'ok');
  const cap = capOf(provider);
  const providerUsable = usable(provider);
  useEffect(() => {
    if (!usable(provider)) {
      const next = providers.find(usable);
      if (next) {
        setProvider(next);
        setModel(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, remote?.ssh]);
  useEffect(() => {
    if (!modelOpen || !projectId || !providerUsable) return;
    let cancelled = false;
    call('project:models', { projectId, provider }).then(
      (models) => { if (!cancelled) setCatalog({ projectId, provider, models }); },
      (error) => { if (!cancelled) setCatalog({ projectId, provider, error: errorText(error) }); },
    );
    return () => { cancelled = true; };
  }, [modelOpen, projectId, providerUsable, provider]);
  const modelCatalog = catalog?.projectId === projectId && catalog.provider === provider ? catalog : null;

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await call('task:create', {
        projectId,
        provider,
        model: model?.id,
        isolate: isolate && !project?.host,
        mockScript: provider === 'mock' ? mockScript : undefined,
      });
      onCreated(t.taskId);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('New agent')} onClose={onClose}>
      {/* For people who meant to pick up a conversation they already have: first, before choosing anything. */}
      {onContinue ? (
        <div className="hint new-continue" data-testid="new-continue-hint">
          {t('Continuing an existing conversation?')}{' '}
          <button className="link" onClick={onContinue} data-testid="new-continue-session">
            {t('Continue a session…')}
          </button>
        </div>
      ) : null}
      <ProjectChooser snapshot={snapshot} value={projectId} onChange={(id) => {
        if (id !== projectId) setModel(null);
        setProjectId(id);
      }} />
      <div className="field">
        <details className="new-chat-model" data-testid="new-chat-model" onToggle={(e) => setModelOpen(e.currentTarget.open)}>
          <summary><span>{t('Model')}</span><span className="truncate">{model?.label ?? t('Default model')}</span></summary>
          <fieldset>
            <legend>{t('Provider')}</legend>
            <div className="row">
              {providers.map((p) => {
                const c = capOf(p);
                return (
                  <label key={p} className={`radio${usable(p) ? '' : ' disabled'}${provider === p ? ' selected' : ''}`} title={c?.detail}>
                    <input type="radio" name="provider" checked={provider === p} disabled={!usable(p)} onChange={() => {
                      setProvider(p);
                      setModel(null);
                    }} /> {PROVIDER_LABEL[p]}
                    {c?.version ? <span className="muted small"> {shortVersion(c.version)}</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <select className="input select" aria-label={t('Model')} value={model?.id ?? ''} disabled={!modelCatalog?.models?.length} onChange={(e) => {
            setModel(modelCatalog?.models?.find((option) => option.id === e.target.value) ?? null);
          }}>
            <option value="">{t('Default model')}</option>
            {modelCatalog?.models?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          {modelCatalog?.error ? <div className="error-text small" role="alert">{modelCatalog.error}</div> : null}
        </details>
        {project?.host && remote?.ssh !== 'ok' ? (
          <div className="warn-text small">{t('{host} is not connected. Check it in Settings › Remote machines.', { host: project.host })}</div>
        ) : cap && !(cap.available && cap.auth?.loggedIn !== false) ? (
          <div className="muted small">
            {cap.available && cap.auth?.loggedIn === false
              ? project?.host
                ? t('{name} on {host} is not signed in. Sign in there once, then recheck in Settings.', { name: PROVIDER_LABEL[cap.provider], host: project.host })
                : t('{name} is installed but not signed in. Open Settings for how to sign in.', { name: PROVIDER_LABEL[cap.provider] })
              : project?.host
                  ? t('{name} is not installed on {host}.', { name: PROVIDER_LABEL[cap.provider], host: project.host })
                  : t('{name} CLI not found on PATH.', { name: PROVIDER_LABEL[cap.provider] })}
          </div>
        ) : null}
      </div>
      {provider === 'mock' ? (
        <div className="field">
          <label>{t('Mock script')}</label>
          <input className="input" value={mockScript} onChange={(e) => setMockScript(e.target.value)} />
          <div className="muted small">ask:&lt;question&gt; · approval:&lt;command&gt; · choice:&lt;question&gt; · work</div>
        </div>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={isolate && !project?.host} disabled={!project?.isGitRepo || !!project?.host} onChange={(e) => setIsolate(e.target.checked)} />
        {t('Run in its own git worktree')}{' '}
        {project?.host
          ? t('(not on SSH hosts yet — will share the folder)')
          : project && !project.isGitRepo
            ? t('(not a git repo — will share the folder)')
            : null}
      </label>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy || !projectId} onClick={() => void create()} data-testid="create-agent">
          {busy ? t('Starting…') : t('Create agent')}
        </button>
      </div>
    </Modal>
  );
}

/** Recent Claude Code / Codex sessions from any folder on this computer (or one SSH host), newest first. */
export function ImportDialog({ snapshot, onClose, onImported }: { snapshot: WorkspaceSnapshot; onClose: () => void; onImported: (taskId: string) => void }) {
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<'all' | NativeProvider>('all');
  const [importing, setImporting] = useState('');
  const [showAutomated, setShowAutomated] = useState(() => readPref(AUTOMATED_KEY) === '1');
  const [destination, setDestination] = useState('');
  // Sources: this computer plus the machines turned on in Settings › Remote machines.
  const hosts = snapshot.remoteHosts.map((h) => h.host);
  const [source, setSource] = useState<string>(() => {
    const saved = readSource();
    return saved === 'all' || saved === LOCAL || hosts.includes(saved) ? saved : LOCAL;
  });
  /** Per source: its sessions once loaded, or why it failed. */
  const [loaded, setLoaded] = useState<Record<string, NativeSessionInfo[] | { error: string }>>({});
  const now = Date.now();
  const hostKey = hosts.join('\0');
  const wanted = useMemo(() => source === 'all' ? [LOCAL, ...hosts] : [source], [source, hostKey]);
  const project = snapshot.projects.find((p) => p.projectId === destination);

  useEffect(() => {
    writeSource(source);
    let current = true;
    for (const src of wanted) {
      if (loaded[src]) continue;
      (src === LOCAL ? call('sessions:discoverAll', {}) : call('sessions:discoverHost', { host: src }))
        .then((list) => current && setLoaded((l) => ({ ...l, [src]: list })))
        .catch((e) => current && setLoaded((l) => ({ ...l, [src]: { error: errorText(e) } })));
    }
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Raw session titles can contain hundreds of KB of injected context. Format once per scan,
  // not on every search keystroke or unrelated workspace update.
  const sessions = useMemo(() => wanted.map((src) => loaded[src]).flatMap((l) => (Array.isArray(l) ? l : [])).map(s=>({...s,automated:s.automated||isApprovalReviewTitle(s.title),title:sessionTitle(s.title)})).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [loaded, wanted]);
  const pending = wanted.filter((src) => !loaded[src]);
  const failed = wanted.flatMap((src) => {
    const l = loaded[src];
    return l && !Array.isArray(l) ? [{ src, error: l.error }] : [];
  });
  const matching = filterImportCandidates(sessions, query).filter((s) => provider === 'all' || s.provider === provider);
  // Sessions an agent started inside another task (sub-agents) are rarely ones to continue.
  const automatedCount = matching.filter((s) => s.automated).length;
  const shown = showAutomated ? matching : matching.filter((s) => !s.automated);
  const add = (s: NativeSessionInfo) => {
    if (s.provider === 'mock') return;
    if (project && project.host !== s.host) return;
    setImporting(sessionKey(s));
    setError('');
    call('task:importSession', { projectId: destination || undefined, provider: s.provider, nativeSessionId: s.nativeSessionId, cwd: s.cwd, host: s.host, title: s.title.slice(0, 500) || s.nativeSessionId })
      .then((t) => {
        onImported(t.taskId);
        onClose();
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setImporting(''));
  };

  return (
    <Modal title={t('Continue an existing session')} onClose={onClose}>
      <p className="muted small">{t('Continue a saved conversation with its history. Close it in the original app or terminal first.')}</p>
      <label className="settings-row-inline">
        <span>{t('Import into project')}</span>
        <select className="input select" value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="session-project">
          <option value="">{t('Use the session’s original folder')}</option>
          {snapshot.projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}{p.host ? ` · ${p.host}` : ''}</option>)}
        </select>
      </label>
      <p className="muted small">{t('The session keeps its original working folder and machine. An imported session opens in its existing project.')}</p>
      <div className="row">
        {hosts.length ? (
          <select className="input select" value={source} onChange={(e) => setSource(e.target.value)} title={t('Where the sessions are')} data-testid="session-host">
            <option value="all">{t('All machines')}</option>
            <option value={LOCAL}>{t('Local')}</option>
            {hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        ) : null}
        <input className="input grow" autoFocus placeholder={t('Search title, folder, provider or date')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="session-search" />
        <div className="segmented">
          {(['all', ...NATIVE_PROVIDERS] as const).filter((p) => p !== 'antigravity' || wanted.includes(LOCAL)).map((p) => (
            <button key={p} className={provider === p ? 'on' : ''} onClick={() => setProvider(p)}>
              {p === 'all' ? t('All') : PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {automatedCount || showAutomated ? (
        <label className="check small muted" title={t('Started by an agent for itself: claude -p, codex exec, Codex sub-agents.')}>
          <input
            type="checkbox"
            checked={showAutomated}
            onChange={(e) => {
              setShowAutomated(e.target.checked);
              writePref(AUTOMATED_KEY, e.target.checked ? '1' : '0');
            }}
            data-testid="session-automated"
          />
          {t('Also show sub-agent sessions ({n})', { n: automatedCount })}
        </label>
      ) : null}
      {pending.length ? (
        <div className="muted small">{pending.length === 1 && pending[0] === LOCAL ? t('Looking for sessions…') : t('Looking for sessions on {hosts}…', { hosts: pending.map((p) => (p === LOCAL ? t('Local') : p)).join(', ') })}</div>
      ) : null}
      {failed.map((f) => (
        <div key={f.src} className="warn-text small">
          {f.src === LOCAL ? f.error : t('{host}: {error}', { host: f.src, error: f.error })}
        </div>
      ))}
      {error ? <div className="error-text">{error}</div> : null}
      {!pending.length && shown.length === 0 ? <div className="muted">{automatedCount ? t('Only sub-agent sessions match.') : t('No sessions found.')}</div> : null}
      <div className="session-list" data-testid="session-list">
        {shown.map((s) => (
          <div key={sessionKey(s)} className="session-row" data-testid="session-row">
            <div className="session-main">
              <div className="session-title">
                <ProviderTag provider={s.provider} /> <span className="truncate">{s.title}</span>
                {s.automated ? (
                  <span className="badge session-auto" title={t('Started by an agent inside another task')}>
                    {t('sub-agent')}
                  </span>
                ) : null}
              </div>
              <div className="muted small mono session-meta">
                <span className="truncate" title={s.host ? `${s.host}:${s.cwd}` : s.cwd}>
                  <Icon name="folder" size={12} /> {s.host ? `${s.host}:` : ''}
                  {shortPath(s.cwd)}
                </span>
                {s.updatedAt ? <span>{timeAgo(s.updatedAt, now)}</span> : null}
                {s.updatedAt && now - Date.parse(s.updatedAt) < 10 * 60_000 ? (
                  <span className="warn-text" title={t('Active in the last few minutes. If it is still open in a terminal, close it before continuing here.')}>
                    {t('may still be open')}
                  </span>
                ) : null}
              </div>
            </div>
            <button className="btn" disabled={!!importing || !!project && project.host !== s.host} title={project && project.host !== s.host ? t('Choose a project on the same machine as the session.') : undefined} onClick={() => add(s)}>
              {importing === sessionKey(s) ? t('Importing…') : t('Import')}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const LOCAL = 'local';
const SOURCE_KEY = 'amw.importSource';
const AUTOMATED_KEY = 'amw.importAutomated';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience only */
  }
}

const readSource = () => readPref(SOURCE_KEY) ?? LOCAL;
const writeSource = (source: string) => writePref(SOURCE_KEY, source);

/** "/Users/me/projects/shop/api" → "…/shop/api". */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

/** Fork an agent's conversation, as it is now or from just before one of the user's earlier prompts. */
export function ForkDialog({ snapshot, task, onClose, onForked }: { snapshot: WorkspaceSnapshot; task: Task; onClose: () => void; onForked: (taskId: string) => void }) {
  const project = snapshot.projects.find((p) => p.projectId === task.projectId);
  const [points, setPoints] = useState<ForkPoint[] | null>(null);
  /** '' = the whole conversation as it is now. */
  const [upTo, setUpTo] = useState('');
  const [isolate, setIsolate] = useState(!!project?.isGitRepo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    call('task:forkPoints', { taskId: task.taskId })
      .then((p) => setPoints([...p].reverse()))
      .catch((e) => {
        setPoints([]);
        setError(errorText(e));
      });
  }, [task.taskId]);
  const pick = (id: string) => setUpTo(id);
  const fork = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await call('task:fork', { taskId: task.taskId, upToMessageId: upTo || undefined, isolate: isolate && !!project?.isGitRepo });
      // Forked back to before a message: that message waits in the new agent's reply box, to edit and send.
      const prompt = upTo ? points?.find((p) => p.upToMessageId === upTo)?.prompt : undefined;
      if (prompt) setDraftText(t.taskId, prompt);
      onForked(t.taskId);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Fork {name}', { name: labelOf(task) })} onClose={onClose}>
      <div className="muted small">{t('A new agent continues from a copy; {name} stays as it is.', { name: labelOf(task) })}</div>
      <div className="field">
        <label>{t('Fork from')}</label>
        <div className="fork-points" data-testid="fork-points">
          <label className={`radio${upTo === '' ? ' selected' : ''}`}>
            <input type="radio" name="fork-point" checked={upTo === ''} onChange={() => pick('')} /> {t('Now (the whole conversation)')}
          </label>
          {points === null ? <div className="muted small">{t('Loading…')}</div> : null}
          {points?.map((p) => (
            <label key={p.upToMessageId} className={`radio${upTo === p.upToMessageId ? ' selected' : ''}`} title={p.prompt}>
              <input type="radio" name="fork-point" checked={upTo === p.upToMessageId} onChange={() => pick(p.upToMessageId)} /> <span className="muted">{t('Before:')}</span>{' '}
              <span className="truncate">{p.prompt}</span>
            </label>
          ))}
        </div>
        <div className="muted small">{t('Only the conversation goes back; files stay as they are now.')}</div>
      </div>
      <label className="check">
        <input type="checkbox" checked={isolate && !!project?.isGitRepo} disabled={!project?.isGitRepo} onChange={(e) => setIsolate(e.target.checked)} data-testid="fork-isolate" />
        {t('Run in its own git worktree')}{' '}
        {project?.isGitRepo ? t('(with {name}’s files as they are now, uncommitted changes included)', { name: labelOf(task) }) : t('(not a git repo — will share the folder)')}
      </label>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy || points === null} onClick={() => void fork()} data-testid="fork-confirm">
          {busy ? t('Forking…') : t('Fork')}
        </button>
      </div>
    </Modal>
  );
}
