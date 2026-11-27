import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workspace } from '../../src/main/workspace';
import { needsYou, overviewCandidates, teams } from '../../src/shared/agent-order';

const opened: Workspace[] = [];
const open = (dataDir: string) => {
  const ws = new Workspace({ dataDir, adapters: {} }); opened.push(ws); return ws;
};
afterEach(async () => { for (const ws of opened.splice(0)) await ws.shutdown(); });
async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'amw-conversation-lifecycle-'));
  const folder = join(home, 'project'); mkdirSync(folder);
  writeFileSync(join(folder, 'paper.tex'), 'Original paper\n');
  const ws = open(join(home, 'state'));
  const project = await ws.addProject(folder, 'Research', undefined); project.kind = 'research';
  const task = await ws.importSession({ projectId: project.projectId, provider: 'codex', nativeSessionId: 'original-native-session', cwd: folder, title: 'Research conversation' });
  ws.store.setTranscript(task.taskId, [{ id: 'original', taskId: task.taskId, role: 'user', text: 'Unmodified native history', createdAt: task.createdAt }]);
  ws.store.flush();
  return { home, folder, ws, project, task };
}
it('archives durably without changing project alignment, sessions, raw history or files; viewing and renaming do not restore it', async () => {
  const { home, folder, ws, project, task } = await setup();
  const file = join(home, 'state', 'transcripts', task.taskId + '.json');
  const bytes = readFileSync(file), sessions = structuredClone(ws.store.data.sessions);
  ws.archiveConversation(task.taskId, true);
  const archivedAt = task.archivedAt; expect(archivedAt).toBeTruthy();
  ws.markViewed(task.taskId); ws.rename(task.taskId, 'Still archived'); ws.setAside(task.taskId, false);
  expect(task.archivedAt).toBe(archivedAt);
  const again = await ws.importSession({ projectId: project.projectId, provider: 'codex', nativeSessionId: 'original-native-session', cwd: folder, title: 'Do not overwrite' });
  expect(again.taskId).toBe(task.taskId); expect(again.archivedAt).toBe(archivedAt);
  await ws.shutdown();
  const restored = open(join(home, 'state'));
  expect(restored.snapshot().tasks[0]).toMatchObject({ taskId: task.taskId, projectId: project.projectId, archivedAt, name: 'Still archived' });
  expect(restored.snapshot().projects[0].kind).toBe('research');
  expect(restored.store.data.sessions).toEqual(sessions);
  expect(readFileSync(file)).toEqual(bytes); expect(readFileSync(join(folder, 'paper.tex'), 'utf8')).toBe('Original paper\n');
  restored.store.data.tasks[0].setAside = true;
  restored.store.data.tasks[0].createdAt = restored.store.data.tasks[0].updatedAt = '2020-01-01T00:00:00.000Z';
  restored.archiveConversation(task.taskId, false);
  expect(restored.snapshot().tasks[0].archivedAt).toBeUndefined();
  expect(restored.snapshot().tasks[0].setAside).toBeUndefined();
  expect(teams(restored.snapshot().tasks, [project], [], Date.now())[0]).toMatchObject({ active: true, project: { projectId: project.projectId } });
});
it('keeps manually archived conversations out of project rows, attention, Overview and untargeted routing', async () => {
  const { ws, project, task } = await setup(); task.status = 'waiting_for_user';
  const attention = { id: 'question', taskId: task.taskId, kind: 'question' as const, state: 'open' as const, headline: 'Question', details: '', createdAt: task.createdAt };
  ws.store.data.attention.push(attention);
  ws.archiveConversation(task.taskId, true);
  expect(needsYou([task], [attention])).toEqual([]);
  expect(teams([task], [project], [attention], Date.now())).toEqual([]);
  expect(overviewCandidates([task], [attention], Date.now())).toEqual([]);
  expect(ws.routeContext('A new topic', null).tasks).toEqual([]);
  expect(ws.routeContext('Continue this topic', task.taskId).tasks).toHaveLength(1);
  expect(ws.store.data.attention[0]).toEqual(attention);
});
it('deletes only the selected conversation while retaining even a clean worktree and native session history', async () => {
  const { home, folder, ws, project, task } = await setup();
  execFileSync('git', ['init', '-q', folder]);
  execFileSync('git', ['-C', folder, 'add', 'paper.tex']);
  execFileSync('git', ['-C', folder, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'Initial paper']);
  const worktree = join(home, 'clean-worktree');
  execFileSync('git', ['-C', folder, 'worktree', 'add', '-q', '-b', 'analysis', worktree]);
  task.worktree = { path: worktree, branch: 'analysis', parentRepo: folder, baseRef: execFileSync('git', ['-C', folder, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
  const other = await ws.importSession({ projectId: project.projectId, provider: 'claude', nativeSessionId: 'other-native', cwd: folder, title: 'Other conversation' });
  const sessions = structuredClone(ws.store.data.sessions);
  const raw = JSON.stringify(ws.store.transcript(task.taskId));
  await ws.deleteConversation(task.taskId);
  expect(ws.snapshot().tasks.map(t => t.taskId)).toEqual([other.taskId]);
  expect(ws.snapshot().projects).toHaveLength(1); expect(project.kind).toBe('research');
  expect(readFileSync(join(worktree, 'paper.tex'), 'utf8')).toBe('Original paper\n');
  expect(readFileSync(join(folder, 'paper.tex'), 'utf8')).toBe('Original paper\n');
  expect(ws.store.data.sessions).toEqual(sessions); expect(JSON.stringify(ws.store.transcript(task.taskId))).toBe(raw);
  await ws.shutdown();
  const next = open(join(home, 'state'));
  expect(next.snapshot().tasks.map(t => t.taskId)).toEqual([other.taskId]);
  const reimport = await next.importSession({ projectId: project.projectId, provider: 'codex', nativeSessionId: 'original-native-session', cwd: worktree, title: 'Explicit reimport' });
  expect(reimport.taskId).not.toBe(task.taskId);
});
it('protects the main agent from conversation archive and delete operations', async () => {
  const { ws, task } = await setup(); ws.store.data.mainAgent = { ...task, taskId: 't-main-test' };
  expect(() => ws.archiveConversation('t-main-test', true)).toThrow('main agent');
  await expect(ws.deleteConversation('t-main-test')).rejects.toThrow('main agent');
});
