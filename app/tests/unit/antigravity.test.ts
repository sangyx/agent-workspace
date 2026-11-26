import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AntigravityAdapter } from '../../src/main/providers/antigravity';
import type { ProviderEvent } from '../../src/main/providers/types';

// Native ACP boundary: a fake CLI exercises the model catalog, streaming, and a wire-level approval.
it.skipIf(process.platform === 'win32')('routes Antigravity ACP events and resumes the same conversation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'amw-agy-test-'));
  const executable = join(cwd, 'agy');
  writeFileSync(executable, `#!/usr/bin/env node
const { createInterface } = require('node:readline');
const id = 'conversation-1';
let promptId;
const send = (fields) => console.log(JSON.stringify({ jsonrpc: '2.0', ...fields }));
const update = (fields) => send({ method: 'session/update', params: { sessionId: id, update: fields } });
const chunk = (sessionUpdate, text) => update({ sessionUpdate, content: { type: 'text', text } });
const configOptions = [
  { id: 'model', category: 'model', name: 'Model', type: 'select', currentValue: 'flash', options: [{ value: 'flash', name: 'Flash' }] },
  { id: 'thought_level', category: 'thought_level', name: 'Thinking', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  { id: 'mode', category: 'mode', name: 'Mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
];
createInterface({ input: process.stdin }).on('line', (line) => {
  const rpc = JSON.parse(line);
  const params = rpc.params ?? {};
  const reply = (result) => send({ id: rpc.id, result });
  switch (rpc.method) {
    case 'initialize':
      return reply({ protocolVersion: 1, agentInfo: { name: 'Antigravity', version: '1.5.14' } });
    case 'session/list':
      return reply({ sessions: [{ sessionId: id, cwd: params.cwd ?? process.cwd(), title: 'Saved chat' }] });
    case 'session/new':
    case 'session/resume':
    case 'session/load':
      if (rpc.method === 'session/load') {
        chunk('user_message_chunk', 'Original prompt');
        chunk('agent_message_chunk', 'Saved reply');
      }
      if (params.sessionId && params.sessionId !== id) {
        return send({ id: rpc.id, error: { code: -32002, message: 'Wrong session' } });
      }
      return reply({ sessionId: id, configOptions });
    case 'session/set_config_option':
      configOptions.find((o) => o.id === params.configId).currentValue = params.value;
      return reply({ configOptions });
    case 'session/prompt':
      promptId = rpc.id;
      update({ sessionUpdate: 'usage_update', used: 100, size: 1000 });
      update({ sessionUpdate: 'tool_call', toolCallId: 'file-1', title: 'Read notes', kind: 'read', status: 'pending' });
      return send({ id: 123, method: 'session/request_permission', params: {
        sessionId: id, toolCall: { toolCallId: 'file-1', title: 'Read notes', kind: 'read' },
        options: [{ optionId: 'deny-1', kind: 'reject_once', name: 'Deny once' }],
      } });
    case 'session/cancel':
      return send({ id: promptId, result: { stopReason: 'cancelled' } });
    case 'session/close':
      return reply({});
    default:
      if (rpc.id === 123 && rpc.result?.outcome.optionId === 'deny-1') {
        chunk('agent_message_chunk', 'Permission ');
        chunk('agent_message_chunk', 'denied.');
        send({ id: promptId, result: { stopReason: 'end_turn' } });
      }
  }
});
`, { mode: 0o755 });
  vi.stubEnv('PATH', cwd + delimiter + process.env.PATH);
  const adapter = new AntigravityAdapter();
  const events: ProviderEvent[] = [];
  const session = adapter.createSession({ cwd, title: 'Probe', permissionMode: 'ask', reasoningEffort: 'high' }, (event) => events.push(event));
  try {
    expect(await adapter.capabilities()).toMatchObject({ provider: 'antigravity', available: true, auth: { loggedIn: true } });
    expect(await adapter.listModels()).toMatchObject([{ id: 'flash', label: 'Flash', reasoningEfforts: ['low', 'high'], isDefault: true }]);
    expect(await adapter.discoverSessions({ cwd })).toMatchObject([{ nativeSessionId: 'conversation-1', title: 'Saved chat' }]);
    await session.start();
    expect(session.nativeSessionId()).toBe('conversation-1');
    expect(await session.send('Original prompt')).toBe('turn');
    const approval = () => events.find((e) => e.type === 'approvalRequested');
    await expect.poll(approval).toMatchObject({ options: [{ id: 'deny-1', kind: 'reject_once' }] });
    await expect(session.respond(approval()!.requestId, { decision: 'unknown' })).rejects.toThrow('no longer available');
    await session.respond(approval()!.requestId, { decision: 'deny-1' });
    await expect.poll(() => events.find((e) => e.type === 'turnCompleted')).toMatchObject({ status: 'completed', finalText: 'Permission denied.' });
    expect(events).toContainEqual({ type: 'usage', context: 100, contextWindow: 1000 });
    expect(events.filter((e) => e.type === 'outputDelta').map((e) => e.delta).join('')).toBe('Permission denied.');
    await session.send('Another prompt');
    await expect.poll(() => events.filter((e) => e.type === 'approvalRequested').length).toBe(2);
    await session.interrupt();
    expect(events.at(-1)).toMatchObject({ type: 'turnCompleted', status: 'interrupted' });
    await session.close();

    const history = await adapter.readHistory('conversation-1', cwd);
    expect(history).toMatchObject([
      { role: 'user', text: 'Original prompt', history: true },
      { role: 'assistant', text: 'Saved reply', history: true },
    ]);
    const resumed = adapter.createSession({ cwd, title: 'Resume', resumeNativeSessionId: 'conversation-1' }, () => {});
    try {
      await resumed.start();
      expect(resumed.nativeSessionId()).toBe('conversation-1');
    } finally {
      await resumed.close();
    }
  } finally {
    await session.close();
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  }
});
