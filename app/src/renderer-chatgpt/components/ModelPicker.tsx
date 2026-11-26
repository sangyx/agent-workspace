import { useEffect, useRef, useState } from 'react';
import type { ModelOption, ReasoningEffort, SessionRecord, Task } from '../../shared/types';
import { call, errorText } from '../api';
import { t } from '../i18n';
import { Icon, PROVIDER_LABEL, ProviderTag } from './bits';

/** Display names already learnt from a CLI's model list (shared by every agent view). */
const known = new Map<string, string>();

/** A readable name before the list is in: "claude-opus-5-5" → "Opus 5.5", "gpt-6.1-sol" → "GPT-6.1-Sol". */
export function modelName(id: string): string {
  const k = known.get(id);
  if (k) return k;
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(id);
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] ? `.${c[3]}` : ''}`;
  if (/^gpt-/i.test(id)) return id.split('-').map((p, i) => (i === 0 ? 'GPT' : p[0] ? p[0].toUpperCase() + p.slice(1) : p)).join('-');
  return id;
}

const matches = (o: ModelOption, id?: string) => !!id && (o.id === id || o.resolves === id);

const EFFORT_LABELS: Readonly<Partial<Record<ReasoningEffort, string>>> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
  ultra: 'Ultra',
};
const effortLabel = (id: ReasoningEffort) => Object.hasOwn(EFFORT_LABELS, id) ? t(EFFORT_LABELS[id] ?? id) : id;

/**
 * In the composer: pick a model and its reasoning effort. Load the CLI's catalog on first open.
 */
export function ModelPicker({ task, session }: { task: Task; session?: SessionRecord }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    if (!models)
      call('task:models', { taskId: task.taskId }).then(
        (list) => {
          for (const o of list) if (!o.isDefault) for (const id of [o.id, o.resolves]) if (id) known.set(id, o.label);
          setModels(list);
        },
        (e) => setError(errorText(e)),
      );
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    // Esc closes just this (before the app's Esc, which leaves the agent view).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  useEffect(() => setModels(null), [task.provider, task.host]);

  const current = task.activeModel ?? task.model;
  // A model's own name rather than "Default" (which stands for one of them).
  const listed = models?.find((o) => matches(o, current) && !o.isDefault) ?? models?.find((o) => matches(o, current));
  // One tick: the pick, else the default entry (when it is what runs), else what runs.
  const onId = task.model ?? (models?.find((o) => o.isDefault && (matches(o, current) || !current)) ?? models?.find((o) => matches(o, current)))?.id;
  const label = listed?.label ?? (current ? modelName(current) : t('Default model'));
  // Picked while a turn runs: the running turn keeps its model.
  const pending = !!task.model && !!task.activeModel && task.model !== task.activeModel && !models?.find((o) => o.id === task.model && o.resolves === task.activeModel) && (task.status === 'running' || task.status === 'starting');
  const selectedId = task.model ?? task.activeModel;
  const selected = selectedId ? models?.find((m) => m.id === selectedId) ?? models?.find((m) => m.resolves === selectedId) : models?.find((m) => m.isDefault);
  const efforts = selected?.reasoningEfforts ?? [];
  const save = async (change: () => Promise<void>, close = false) => {
    setError('');
    setSaving(true);
    try {
      await change();
      if (close) {
        setOpen(false);
        trigger.current?.focus();
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const pick = (model: string | null) => save(() => call('task:setModel', { taskId: task.taskId, model }), true);
  return (
    <div className="model-picker" ref={ref}>
      <button ref={trigger} className={`model-chip${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title={t('Model and reasoning effort')} data-testid="model-chip">
        <span className="model-chip-label truncate">{label}</span>
        {task.reasoningEffort ? <span className="model-effort-value">{effortLabel(task.reasoningEffort)}</span> : null}
        {pending ? <span className="model-pending">{t('next turn')}</span> : null}
        <Icon name="chevron" size={10} />
      </button>
      {open ? (
        <div className="model-menu" role="dialog" aria-label={t('Model and reasoning effort')} data-testid="model-menu">
          <div className="model-provider">
            <span>{t('Provider')}</span>
            <SessionTag provider={task.provider} id={session?.nativeSessionId} mode={session?.integrationMode} />
          </div>
          {error ? <div className="error-text small" role="alert">{error}</div> : null}
          {models ? (
            <label className="model-effort">
              <span>{t('Reasoning effort')}</span>
              <select data-testid="model-effort" disabled={saving || (!efforts.length && !task.reasoningEffort)} value={task.reasoningEffort ?? ''} onChange={(event) => {
                const effort = event.target.value || null;
                void save(() => call('task:setReasoningEffort', { taskId: task.taskId, effort }));
              }}>
                <option value="">{t(efforts.length ? 'Model default' : 'Unavailable')}</option>
                {task.reasoningEffort && !efforts.includes(task.reasoningEffort) ? <option value={task.reasoningEffort} disabled>{effortLabel(task.reasoningEffort)}</option> : null}
                {efforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
              </select>
            </label>
          ) : null}
          <div className="model-menu-head">{t('Model for this chat · from the next turn')}</div>
          {!models && !error ? <div className="muted small">{t('Asking {name} for its models…', { name: PROVIDER_LABEL[task.provider] })}</div> : null}
          {models?.map((o) => {
            const on = o.id === onId;
            return (
              <button key={o.id} className={`model-option${on ? ' on' : ''}`} onClick={() => void pick(o.id)} disabled={saving} data-testid="model-option" data-model={o.id}>
                <span className="model-option-check">{on ? <Icon name="check" size={12} /> : null}</span>
                <span className="model-option-text">
                  <span>
                    <strong>{o.label}</strong>
                    {o.isDefault ? <span className="muted small"> · {t('default')}</span> : null}
                  </span>
                  {o.description ? <span className="model-option-desc">{o.description}</span> : null}
                </span>
              </button>
            );
          })}
          {models && task.model ? (
            <button className="model-option model-reset" onClick={() => void pick(null)} disabled={saving} data-testid="model-reset">
              <span className="model-option-check" />
              <span className="model-option-text">{t('Back to the default of {name}', { name: PROVIDER_LABEL[task.provider] })}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The provider's tag; it carries the native session id (in its tooltip; a click copies it). */
function SessionTag({ provider, id, mode }: { provider: Task['provider']; id?: string; mode?: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <ProviderTag provider={provider} />;
  return (
    <button
      className="session-tag"
      data-testid="session-tag"
      title={`${copied ? t('Copied') : t('Session {id} · click to copy', { id })}${mode === 'resumed' ? ` · ${t('resumed')}` : ''}`}
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <ProviderTag provider={provider} />
    </button>
  );
}
