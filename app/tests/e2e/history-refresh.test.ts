// A separate native client appends history while this page is open. No model or real CLI is used.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

it('shows externally continued Codex history automatically without resuming its writer', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'amw-external-history-')));
  const bin = join(home, 'bin'), cwd = join(home, 'repo'); mkdirSync(bin); mkdirSync(cwd);
  const history = join(home, 'history.json'), calls = join(home, 'calls.log'), answer = join(home, 'answer.json');
  writeFileSync(answer, '""');
  const turn = (id: string, text: string) => ({ id, status: 'completed', items: [{ id: `a-${id}`, type: 'agentMessage', text }] });
  const saved = { id: 'external-native', cwd, turns: [turn('1', 'Original native answer')] };
  writeFileSync(history, JSON.stringify(saved));
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
const fs=require('node:fs');
if(process.argv[2]!=='app-server'){console.log(process.argv[2]==='login'?'Logged in using ChatGPT':'codex-cli test');process.exit(0)}
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;fs.appendFileSync(process.env.TEST_HISTORY_CALLS,m.method+'\\n');
 const result=m.method==='initialize'?{}:m.method==='model/list'?{data:[]}:m.method==='thread/read'?{thread:JSON.parse(fs.readFileSync(process.env.TEST_HISTORY_FILE,'utf8'))}:{};
 if(m.method==='thread/resume'||m.method==='thread/start')process.stdout.write(JSON.stringify({id:m.id,error:{code:-1,message:'already has an active writer'}})+'\\n');
 else process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});\n`);
  chmodSync(join(bin, 'codex'), 0o755);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.AMW_DISCOVER_FIXTURE; delete env.AMW_MOCK_DELAY_MS;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, PATH: `${bin}:${process.env.PATH}`, AMW_MAIN_AGENT: 'off', AMW_DATA_DIR: join(home, 'state'), AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1', AMW_BACKGROUND_ANSWER: answer, TEST_HISTORY_FILE: history, TEST_HISTORY_CALLS: calls } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    const invoke = (c: string, p: unknown) => page.evaluate(([c, p]) => (window as any).amw.invoke(c, p), [c, p] as const) as Promise<any>;
    await invoke('settings:update', { onboarding: { dismissed: true } });
    const project = await invoke('project:add', { rootPath: cwd, name: 'Existing project' });
    const task = await invoke('task:importSession', { projectId: project.projectId, provider: 'codex', nativeSessionId: saved.id, cwd, title: 'External history test' });
    await page.locator(`[data-testid="rail-item"][data-alias="${task.alias}"]`).click();
    await expect.poll(() => page.locator('.focus-thread').innerText()).toContain('Original native answer');
    saved.turns.push(turn('2', 'New answer written in the other Codex app'));
    writeFileSync(history, JSON.stringify(saved));
    // The active page polls saved history; no sync button is clicked.
    await expect.poll(() => page.locator('.focus-thread').innerText(), { timeout: 30_000 }).toContain('New answer written in the other Codex app');
    const snapshot = await invoke('workspace:snapshot', {});
    expect(snapshot.tasks).toHaveLength(1); expect(snapshot.tasks[0].projectId).toBe(project.projectId);
    expect(snapshot.sessions).toHaveLength(1); expect(snapshot.connectedTaskIds).toEqual([]);
    expect(readFileSync(calls, 'utf8')).not.toMatch(/thread\/(resume|start)/);
  } finally { await app.close(); }
}, 60_000);
