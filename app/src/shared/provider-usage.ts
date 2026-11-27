import { CODING_PROVIDERS } from './types';
import type { AgentProvider, ProviderLimits, Task, WorkspaceSnapshot } from './types';

export const USAGE_PROVIDERS = ['codex', 'claude', 'antigravity'] as const;

/** Quota percentages describe an account window, not additive machine usage. Keep the
 * newest complete provider reading, without mutating per-host data used by sessions. */
export function limitsByProvider(limits: Record<string, ProviderLimits>): Record<string, ProviderLimits> {
  const grouped: Record<string, ProviderLimits> = {};
  const time = (at: string) => Date.parse(at) || 0;
  for (const [key, value] of Object.entries(limits)) {
    const provider = value.provider ?? key.split('@')[0] as AgentProvider;
    if (![...CODING_PROVIDERS, 'mock'].includes(provider)) continue;
    if (!value.windows.length) continue;
    if (grouped[provider] && time(grouped[provider].at) >= time(value.at)) continue;
    const { host: _host, ...reading } = value;
    grouped[provider] = { ...reading, provider };
  }
  return grouped;
}

export function providerUsage(snapshot: Pick<WorkspaceSnapshot, 'limits' | 'tasks' | 'main'>) {
  const limits = limitsByProvider(snapshot.limits ?? {});
  const tasks: Task[] = [...snapshot.tasks];
  if (snapshot.main && !tasks.some(t => t.taskId === snapshot.main!.taskId)) tasks.push(snapshot.main);
  const seen = new Set<string>();
  const unique = tasks.filter(t => !seen.has(t.taskId) && !!seen.add(t.taskId));
  const providers: AgentProvider[] = [...USAGE_PROVIDERS, ...CODING_PROVIDERS.filter(provider => !(USAGE_PROVIDERS as readonly string[]).includes(provider) && (limits[provider] || unique.some(task => task.provider === provider && task.usage)))];
  return providers.map(provider => {
    const tracked = unique.filter(t => t.provider === provider && t.usage);
    return {
      provider,
      limits: limits[provider],
      hasTokens: tracked.length > 0,
      tokens: tracked.reduce((total, t) => {
        const u = t.usage!;
        return total + u.input + u.cacheWrite + u.cacheRead + u.output;
      }, 0),
    };
  });
}
