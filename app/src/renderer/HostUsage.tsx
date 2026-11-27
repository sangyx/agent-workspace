import type { WorkspaceSnapshot } from '../shared/types';
import { providerUsage } from '../shared/provider-usage';
import { formatTokens, shownWindows, windowLabel } from './components/SessionUsage';
import { PROVIDER_LABEL, ProviderIcon } from './components/bits';
import { language, t } from './i18n';
import { timeAgo, useTick } from './state';

/** Shared provider overview: the host and both Chat interfaces use the same data. */
export function ProviderUsage({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const now = useTick(30_000);
  return <div className="provider-usage-list" data-testid="provider-usage-list">
    {providerUsage(snapshot).map(row => {
      const windows = shownWindows(row.limits?.windows ?? []);
      return <section className="provider-usage-card" data-testid={`provider-usage-${row.provider}`} key={row.provider}>
        <div className="provider-usage-title"><span><ProviderIcon provider={row.provider} /><strong>{row.provider === 'claude' ? 'Claude' : PROVIDER_LABEL[row.provider]}</strong></span>
          <span className="muted small">{row.hasTokens ? t('{n} tokens tracked', {n: formatTokens(row.tokens)}) : t('No tracked tokens yet')}</span>
        </div>
        {windows.length ? windows.map(w => <div className="provider-usage-window" key={w.key}>
          <div className="usage-row"><span>{windowLabel(w)}</span><span className="mono">{t('{p}% used', {p:w.usedPercent})}</span></div>
          <div className="usage-bar"><span style={{width:`${Math.max(0, Math.min(100, w.usedPercent))}%`}} /></div>
          {w.resetsAt ? <div className="muted small">{t('Resets {time}', {time:new Date(w.resetsAt).toLocaleString(language() === 'zh' ? 'zh-CN' : 'en-US')})}</div> : null}
        </div>) : <p className="muted small">{t('Account quota not reported by this provider yet.')}</p>}
        {row.limits ? <div className="muted small">{t('Updated {time}', {time:timeAgo(row.limits.at,now)})}</div> : null}
      </section>;
    })}
    <p className="provider-usage-note muted small">{t('Latest reported quota per provider. Tracked tokens include all conversations; quota percentages are not added together.')}</p>
  </div>;
}
export function HostUsage({snapshot,onClose}: {snapshot: WorkspaceSnapshot;onClose:()=>void}) {
  return <section className="host-usage" aria-label={t('Usage & limits')}>
    <header><strong>{t('Usage & limits')}</strong><button className="btn" onClick={onClose} aria-label={t('Close usage')}>×</button></header>
    <ProviderUsage snapshot={snapshot}/>
  </section>;
}
