import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { Workspace } from '../../src/main/workspace';
import type { ProviderAdapter, ProviderEvent, ProviderSession } from '../../src/main/providers/types';
const opened: Workspace[] = [], dirs: string[] = [];
const row = (id: string, text = id): ProviderEvent => ({ type: 'transcriptItem', itemId: id, role: 'assistant', text, history: true });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'amw-history-refresh-')); dirs.push(dir);
  const cwd = join(dir, 'repo'); mkdirSync(cwd);
  const readHistory = vi.fn<NonNullable<ProviderAdapter['readHistory']>>().mockResolvedValue([row('old')]);
  const session: ProviderSession = { provider: 'codex', nativeSessionId: () => 'native', start: vi.fn(async () => {}), close: vi.fn(async () => {}), send: vi.fn(async () => 'turn' as const), respond: vi.fn(async () => {}), interrupt: vi.fn(async () => {}) };
  const createSession = vi.fn(() => session);
  const adapter = { provider: 'codex', readHistory, createSession } as unknown as ProviderAdapter;
  const ws = new Workspace({ dataDir: join(dir, 'data'), adapters: { codex: adapter }, backgroundModel: async () => '' }); opened.push(ws);
  const project = await ws.addProject(cwd, 'Chosen research project'); project.kind = 'research';
  const task = await ws.importSession({ provider: 'codex', projectId: project.projectId, cwd, nativeSessionId: 'native', title: 'Imported' });
  await ws.refreshHistory(task.taskId, true);
  return { ws, task, project, cwd, readHistory, createSession, session };
}
afterEach(async () => { for (const ws of opened.splice(0)) await ws.shutdown(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('refreshes externally appended messages without creating a writer or changing project/session identity', async () => {
  const { ws, task, project, readHistory, createSession } = await setup();
  const sessions = structuredClone(ws.store.data.sessions), localId = task.sessionLocalId, updatedAt = task.updatedAt;
  task.name = 'User title'; task.nameSource = 'user'; task.setAside = true;
  readHistory.mockResolvedValue([row('old'), row('external', 'New answer from Codex desktop')]);
  await ws.refreshHistory(task.taskId, true);
  expect(ws.transcript(task.taskId).map(i => i.text)).toEqual(['old', 'New answer from Codex desktop']);
  expect(task).toMatchObject({ projectId: project.projectId, sessionLocalId: localId, name: 'User title', setAside: true, updatedAt });
  expect(project.kind).toBe('research'); expect(ws.store.data.sessions).toEqual(sessions); expect(createSession).not.toHaveBeenCalled();
  expect(task.summary).toContain('New answer from Codex desktop');
});
it('coalesces and throttles background reads, while explicit sync can fetch immediately', async () => {
  const { ws, task, readHistory } = await setup();
  readHistory.mockClear(); const pending = deferred<ProviderEvent[]>(); readHistory.mockReturnValue(pending.promise);
  const a = ws.refreshHistory(task.taskId, true), b = ws.refreshHistory(task.taskId, true);
  expect(readHistory).toHaveBeenCalledTimes(1); pending.resolve([row('old'), row('new')]); await Promise.all([a, b]);
  await ws.refreshHistory(task.taskId); expect(readHistory).toHaveBeenCalledTimes(1);
  await ws.sync(task.taskId); expect(readHistory).toHaveBeenCalledTimes(2);
});
it('unchanged native history preserves row timestamps and emits no transcript reset or workspace write', async () => {
  const { ws, task } = await setup(); const before = structuredClone(ws.store.transcript(task.taskId));
  const reset = vi.fn(), changed = vi.fn(); ws.onTranscript(reset); ws.onChange(changed);
  await ws.refreshHistory(task.taskId, true);
  expect(ws.store.transcript(task.taskId)).toEqual(before); expect(reset).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
it('opening uses a read-only refresh on the source machine; errors and empty reads preserve the cache', async () => {
  const { ws, task, cwd, readHistory, createSession } = await setup(); task.host = 'lab-host';
  vi.spyOn(ws as unknown as { enabledHosts(): string[] }, 'enabledHosts').mockReturnValue(['lab-host']);
  readHistory.mockResolvedValue([row('old'), row('remote')]);
  await ws.refreshHistory(task.taskId, true); expect(readHistory).toHaveBeenLastCalledWith('native', cwd, 'lab-host');
  const before = structuredClone(ws.transcript(task.taskId));
  readHistory.mockRejectedValue(new Error('Offline')); await expect(ws.refreshHistory(task.taskId, true)).rejects.toThrow('Offline');
  readHistory.mockResolvedValue([]); await ws.sync(task.taskId); expect(ws.transcript(task.taskId)).toEqual(before);
  ws.warm(task.taskId); expect(createSession).not.toHaveBeenCalled(); expect(ws.snapshot().attention).toHaveLength(0);
});
it('discards an old read if a send/session takes ownership or local messages changed meanwhile', async () => {
  const { ws, task, readHistory } = await setup();
  const pending = deferred<ProviderEvent[]>(); readHistory.mockReturnValue(pending.promise);
  const reading = ws.refreshHistory(task.taskId, true);
  await ws.resume(task.taskId);
  pending.resolve([row('stale')]); await reading;
  expect(ws.transcript(task.taskId).some(i => i.id === 'stale')).toBe(false);
  await ws.sync(task.taskId); // closes the idle writer and now reads the source
  expect(ws.snapshot().connectedTaskIds).toEqual([]);
});
it('ignores late reads after shutdown', async () => {
  const { ws, task, readHistory, createSession } = await setup();
  const pending = deferred<ProviderEvent[]>(); readHistory.mockReturnValue(pending.promise);
  const reading = ws.refreshHistory(task.taskId, true); await ws.shutdown(); pending.resolve([row('late')]); await reading;
  expect(ws.transcript(task.taskId).some(i => i.id === 'late')).toBe(false); expect(createSession).not.toHaveBeenCalled();
});
it('preserves app notes and approval decisions while updating native tool results', async () => {
  const { ws, task, readHistory } = await setup();
  ws.store.setTranscript(task.taskId, [{ id: 'note', taskId: task.taskId, role: 'system', text: 'Local note', createdAt: '2026-01-01' }, { id: 'tool', taskId: task.taskId, role: 'tool', text: 'Running', createdAt: '2026-01-01', decision: { kind: 'approval', label: 'Allowed' } }]);
  readHistory.mockResolvedValue([{ type: 'transcriptItem', itemId: 'tool', role: 'tool', text: 'Finished', toolStatus: 'completed', history: true }, row('new')]);
  await ws.refreshHistory(task.taskId, true);
  expect(ws.store.transcript(task.taskId)[0].text).toBe('Local note'); expect(ws.store.transcript(task.taskId)[1]).toMatchObject({ text: 'Finished', decision: { label: 'Allowed' }, createdAt: '2026-01-01' });
});

it('warm refreshes a newly changed source while leaving execution disconnected', async () => {
  const { ws, task, readHistory, createSession } = await setup();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);
  try {
    readHistory.mockResolvedValue([row('old'), row('focus', 'Continued outside the workspace')]);
    ws.warm(task.taskId);
    await vi.waitFor(() => expect(ws.transcript(task.taskId).some(i => i.id === 'focus')).toBe(true));
    expect(createSession).not.toHaveBeenCalled(); expect(ws.snapshot().connectedTaskIds).toEqual([]);
  } finally { clock.mockRestore(); }
});
it('skips a busy local turn and explicit sync cannot interrupt it', async () => {
  const { ws, task, readHistory } = await setup(); await ws.resume(task.taskId);
  ws.handleEvent(task.taskId, task.sessionLocalId!, { type: 'turnStarted' }); readHistory.mockClear();
  await ws.refreshHistory(task.taskId, true); expect(readHistory).not.toHaveBeenCalled();
  await expect(ws.sync(task.taskId)).rejects.toThrow('Busy');
});
it('ignores in-flight reads when the native ID or local transcript changes', async () => {
  const { ws, task, readHistory } = await setup();
  const first = deferred<ProviderEvent[]>(); readHistory.mockReturnValueOnce(first.promise);
  const reading = ws.refreshHistory(task.taskId, true);
  ws.store.data.sessions.find(s => s.localId === task.sessionLocalId)!.nativeSessionId = 'new-native';
  first.resolve([row('stale-session')]); await reading;
  expect(ws.transcript(task.taskId).some(i => i.id === 'stale-session')).toBe(false);
  const second = deferred<ProviderEvent[]>(); readHistory.mockReturnValueOnce(second.promise);
  const loading = ws.refreshHistory(task.taskId, true);
  ws.store.setTranscript(task.taskId, [{ id: 'local', taskId: task.taskId, role: 'user', text: 'New local message', createdAt: 'now' }]);
  second.resolve([row('stale-content')]); await loading;
  expect(ws.transcript(task.taskId).map(i => i.id)).toEqual(['local']);
});

it('does not contact a source machine that was disabled in Settings', async () => {
  const { ws, task, readHistory } = await setup(); task.host = 'disabled-host'; readHistory.mockClear();
  await expect(ws.refreshHistory(task.taskId, true)).rejects.toThrow('not enabled');
  expect(readHistory).not.toHaveBeenCalled();
});
