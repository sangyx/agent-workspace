import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { Workspace, type WorkspaceOptions } from '../../src/main/workspace';
import type { ProviderAdapter } from '../../src/main/providers/types';
const dirs: string[] = [], opened: Workspace[] = [];
function setup(adapters: WorkspaceOptions['adapters'] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'amw-import-preservation-')); dirs.push(dir);
  const ws = new Workspace({ dataDir: join(dir, 'state'), adapters }); opened.push(ws);
  const cwd = join(dir, 'original'), target = join(dir, 'destination');
  mkdirSync(cwd); mkdirSync(target);
  return { ws, dir, cwd, target };
}
afterEach(async () => { for (const ws of opened.splice(0)) await ws.shutdown(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('imports into a selected project while preserving its native session and original working directory', async () => {
  const { ws, cwd, target } = setup();
  const project = await ws.addProject(target, 'Chosen folder');
  const task = await ws.importSession({ projectId: project.projectId, provider: 'codex', nativeSessionId: 'saved-session', cwd, title: 'Saved conversation' });
  expect(task.projectId).toBe(project.projectId); expect(task.cwd).toBe(cwd); expect(task.keptOriginalFolder).toBe(true);
  expect(ws.store.data.sessions.find((s) => s.localId === task.sessionLocalId)).toMatchObject({ cwd, nativeSessionId: 'saved-session' });
});
it('re-import opens the existing task without altering its project, archive flag, permissions or raw transcript', async () => {
  const { ws, dir, cwd, target } = setup();
  const first = await ws.addProject(cwd), other = await ws.addProject(target);
  const args = { projectId: first.projectId, provider: 'codex' as const, nativeSessionId: 'retained', cwd, title: 'Original' };
  const task = await ws.importSession(args);
  task.setAside = true; task.permissionMode = 'ask'; task.nameSource = 'user'; task.name = 'My title';
  ws.store.setTranscript(task.taskId, [{ id: 'raw', taskId: task.taskId, role: 'user', text: 'Original native context\n' + 'payload'.repeat(20_000), createdAt: 'now' }]);
  ws.store.flush();
  const file = join(dir, 'state', 'transcripts', task.taskId + '.json');
  const bytes = readFileSync(file), saved = structuredClone(task), sessions = structuredClone(ws.store.data.sessions);
  const again = await ws.importSession({ ...args, projectId: other.projectId, title: 'New import label' });
  expect(again.taskId).toBe(task.taskId); expect(again).toEqual(saved);
  expect(ws.store.data.sessions).toEqual(sessions); expect(ws.store.data.tasks).toHaveLength(1); expect(readFileSync(file)).toEqual(bytes);
});
it('concurrent imports create one project, task and session, while provider and host remain distinct', async () => {
  const { ws, cwd } = setup();
  const args = { provider: 'codex' as const, nativeSessionId: 'same-id', cwd, title: 'A' };
  const tasks = await Promise.all([ws.importSession(args), ws.importSession(args), ws.importSession(args)]);
  expect(new Set(tasks.map((t) => t.taskId)).size).toBe(1);
  expect(ws.store.data.projects).toHaveLength(1); expect(ws.store.data.sessions).toHaveLength(1);
  const claude = await ws.importSession({ ...args, provider: 'claude' }); expect(claude.taskId).not.toBe(tasks[0].taskId);
  tasks[0].host = 'another-machine';
  const local = await ws.importSession(args); expect(local.taskId).not.toBe(tasks[0].taskId); expect(local.host).toBeUndefined();
});
it('uses the closest existing project and rejects a destination that would change the session machine', async () => {
  const { ws, cwd } = setup();
  const parent = await ws.addProject(cwd);
  const nested = join(cwd, 'nested'); mkdirSync(nested);
  const child = await ws.addProject(nested);
  const task = await ws.importSession({ provider: 'claude', nativeSessionId: 'nested-id', cwd: nested, title: 'Nested' });
  expect(task.projectId).toBe(child.projectId); expect(task.projectId).not.toBe(parent.projectId);
  ws.store.data.projects.push({ ...child, projectId: 'remote', host: 'lab-host' });
  const before = ws.store.data.tasks.length;
  await expect(ws.importSession({ projectId: 'remote', provider: 'codex', nativeSessionId: 'must-not-move', cwd, title: 'Local' })).rejects.toThrow('same machine');
  await expect(ws.importSession({ projectId: parent.projectId, host: 'lab-host', provider: 'codex', nativeSessionId: 'must-not-move', cwd, title: 'Remote' })).rejects.toThrow('same machine');
  expect(ws.store.data.tasks).toHaveLength(before);
});
it('discovery does not hide sessions merely because another provider or machine used the same native ID', async () => {
  const record = { provider: 'codex' as const, nativeSessionId: 'colliding-id', cwd: '/synthetic', title: 'Saved session' };
  const codex = { provider: 'codex', discoverSessions: async () => [record] } as unknown as ProviderAdapter;
  const claude = { provider: 'claude', discoverSessions: async () => [{ ...record, provider: 'claude' }] } as unknown as ProviderAdapter;
  const { ws, cwd } = setup({ codex, claude });
  const project = await ws.addProject(cwd);
  const task = await ws.importSession({ ...record, cwd, projectId: project.projectId });
  expect(await ws.discoverSessions(project.projectId, 'codex')).toEqual([]);
  expect(await ws.discoverSessions(project.projectId, 'claude')).toHaveLength(1);
  task.host = 'other-machine';
  expect(await ws.discoverSessions(project.projectId, 'codex')).toHaveLength(1);
});
