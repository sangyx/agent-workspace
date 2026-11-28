import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AcpAdapter } from '../../src/main/providers/acp';
import { acpAgent } from '../../src/shared/acp-agents';
import type { ProviderSession } from '../../src/main/providers/types';
import type { RemoteRunner } from '../../src/main/util/detached';

const sessions: ProviderSession[] = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); vi.unstubAllEnvs(); });
for (const remote of [false, true]) it(`uses a physical Antigravity root without changing the configured alias (${remote ? 'host fixture' : 'local'})`, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'amw-root-')));
  const physical = join(dir, 'physical project'), alias = join(dir, 'alias project'), log = join(dir, 'requests.jsonl');
  mkdirSync(physical); symlinkSync(physical, alias);
  vi.stubEnv('FAKE_ACP_DIR', join(dir, 'sessions')); vi.stubEnv('FAKE_ACP_LOG', log); vi.stubEnv('FAKE_ACP_HIDE_USAGE', '1');
  const env = { ...process.env, HOME: dir };
  const runner: RemoteRunner = {
    spawn: command => spawn('sh', ['-c', command], { env, stdio: 'pipe' }),
    run: command => new Promise(resolve => {
      const child = spawn('sh', ['-c', command], { env, stdio: 'pipe' }); let stdout = '', stderr = '';
      child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
      child.on('close', code => resolve({ code: code ?? 255, stdout, stderr }));
    }),
  };
  const adapter = new AcpAdapter(acpAgent('antigravity')!, { command: [process.execPath, join(__dirname, '../fixtures/fake-acp-agent.mjs')], runner: () => runner });
  const args = { cwd: alias, title: 'Physical root', permissionMode: 'auto' as const, ...(remote ? { host: 'fake-host' } : {}) };
  const session = adapter.createSession(args, () => {}); sessions.push(session);
  await session.start();
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(calls().find(call => call.method === 'session/new').params.cwd).toBe(physical);
  expect(args.cwd).toBe(alias);
  await session.send('/compact');
  await vi.waitFor(() => expect(calls().some(call => call.method === 'session/prompt')).toBe(true));
  expect(calls().find(call => call.method === 'session/prompt').params.prompt).toEqual([{ type: 'text', text: '/compact' }]);
});
