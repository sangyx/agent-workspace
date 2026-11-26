import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { client, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk/unstable';
import type {
  ContentBlock, InitializeResponse, LoadSessionResponse, NewSessionResponse, RequestPermissionRequest, RequestPermissionResponse,
  SessionConfigOption, SessionNotification, SessionUpdate, ToolCall, ToolCallUpdate,
} from '@agentclientprotocol/sdk/unstable';
import { clipOutput, makeDiff, snippetHunks } from '../../shared/content';
import type { ModelOption, NativeSessionInfo, PermissionMode, ProviderCapabilities, ToolContent, ToolStatus } from '../../shared/types';
import { transientKind } from '../retry';
import { childEnv, findExecutable } from '../util/exec';
import type { ApprovalResponse, Delivery, HistoryImage, ImageInput, ProviderAdapter, ProviderEvent, ProviderSession, StartArgs } from './types';
import { cleanUserText } from './user-text';
import { shq, sshError, sshRun, sshRunner, sshSpawn } from '../util/ssh';
import { detachedSpawn } from '../util/detached';

const agent = methods.agent;
const timeout = (ms = 12_000) => ({ cancellationSignal: AbortSignal.timeout(ms), stopWaitingOnCancel: true });
const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };
const authRequired = (error: unknown) => error instanceof RequestError && error.code === -32000;
const modeIds: Record<PermissionMode, string> = { ask: 'default', edits: 'accept-edits', auto: 'auto' };
const workspaceContext = /^<agent-workspace-context>[\s\S]*?<\/agent-workspace-context>\s*/;

function openClient(executable: string, cwd: string | undefined, handlers?: {
  update: (notification: SessionNotification) => void;
  permission: (request: RequestPermissionRequest, signal: AbortSignal) => Promise<RequestPermissionResponse>;
}, host?: string, durable = false) {
  const command = `cd -- ${cwd ? shq(cwd) : '"$HOME"'} && exec agy acp --sandbox`;
  const child = host
    ? durable ? detachedSpawn(sshRunner(host), command) : sshSpawn(host, command)
    : spawn(executable, ['acp', '--sandbox'], { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
  // Login banners are not ACP messages. Keep only JSON-RPC lines, as the Codex transport does.
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stdout = Readable.from((async function* () {
    for await (const line of lines) {
      try {
        if (JSON.parse(line)?.jsonrpc === '2.0') yield Buffer.from(line + '\n');
      } catch { /* A login banner, never sent to the ACP parser. */ }
    }
  })());
  child.stderr?.resume();
  const app = client({ name: 'agent-workspace' })
    .onNotification(methods.client.session.update, ({ params }) => handlers?.update(params))
    .onRequest(methods.client.session.requestPermission, ({ params, signal }) => handlers?.permission(params, signal) ?? cancelled);
  const output = Writable.toWeb(child.stdin);
  const input = Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>;
  const connection = app.connect(ndJsonStream(output, input));
  const rpc = connection.agent;
  child.once('error', () => connection.close());
  child.once('exit', () => connection.close());
  return {
    rpc,
    closed: connection.closed,
    initialize: () => rpc.request<InitializeResponse>(agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'agent-workspace' } }, timeout(host ? 25_000 : 12_000)),
    close: () => {
      connection.close();
      lines.close();
      stdout.destroy();
      child.kill();
    },
  };
}

function select(options: SessionConfigOption[] | null | undefined, category: string) {
  return options?.find((o) => o.type === 'select' && (o.category === category || o.id === category));
}

function values(option: ReturnType<typeof select>) {
  return option?.type === 'select' ? option.options.flatMap((o) => 'options' in o ? o.options : [o]) : [];
}

type SessionOptions = (NewSessionResponse | LoadSessionResponse) & {
  models?: { availableModels: Array<{ modelId: string; name: string }>; currentModelId: string };
};

function catalog(session: SessionOptions): ModelOption[] {
  const models = select(session.configOptions, 'model');
  const offered = new Set(values(select(session.configOptions, 'thought_level')).map((o) => o.value));
  return values(models).map((m) => {
    const variants = session.models?.availableModels.filter((v) => v.modelId.startsWith(m.value + '-')).map((v) => v.modelId.slice(m.value.length + 1));
    const reasoningEfforts = [...offered].filter((effort) => !session.models || variants?.includes(effort) || models?.currentValue === m.value);
    return { id: m.value, label: m.name, description: m.description ?? undefined, isDefault: m.value === models?.currentValue, reasoningEfforts };
  });
}

export class AntigravityAdapter implements ProviderAdapter {
  readonly provider = 'antigravity' as const;
  readonly remote = true;
  private checking = new Map<string, Promise<ProviderCapabilities>>();

  capabilities(): Promise<ProviderCapabilities> {
    return this.check();
  }
  hostCapabilities(host: string): Promise<ProviderCapabilities> { return this.check(host); }
  private check(host?: string): Promise<ProviderCapabilities> {
    const key = host ?? '';
    const pending = this.checking.get(key);
    if (pending) return pending;
    const promise = this.detect(host).finally(() => this.checking.delete(key));
    this.checking.set(key, promise);
    return promise;
  }

  private async detect(host?: string): Promise<ProviderCapabilities> {
    const base: ProviderCapabilities = {
      provider: this.provider, available: false, createSession: true, resumeHistorical: true, importHistory: true,
      attachExternalRunning: false, readOnlyMonitor: false, structuredApprovals: true, structuredQuestions: false,
    };
    const exe = host ? 'agy' : findExecutable('agy');
    if (host) {
      const found = await sshRun(host, 'command -v agy >/dev/null', 15_000);
      if (found.code === 255) throw new Error(sshError(host, found.stderr));
      if (found.code !== 0) return { ...base, detail: `Antigravity CLI (agy) not found on ${host} (in its login shell's PATH).` };
    }
    if (!exe) return { ...base, detail: 'Antigravity CLI (agy) not found on PATH.' };
    const transport = openClient(exe, host ? undefined : homedir(), undefined, host);
    try {
      const init = await transport.initialize();
      if (init.protocolVersion !== PROTOCOL_VERSION) throw new Error('Antigravity uses an unsupported ACP protocol version.');
      const installed = { ...base, available: true, version: init.agentInfo?.version, detail: host ? `Antigravity ACP over SSH on ${host}, with the login there.` : `Antigravity CLI → ${exe}` };
      try {
        await transport.rpc.request(agent.session.list, {}, timeout());
        return { ...installed, auth: { loggedIn: true } };
      } catch (error) {
        return { ...installed, ...(authRequired(error) ? { auth: { loggedIn: false } } : { detail: String(error) }) };
      }
    } catch (error) {
      return { ...base, detail: `Antigravity ACP unavailable${host ? ` on ${host}` : ''}: ${String(error)}` };
    } finally {
      transport.close();
    }
  }

  async discoverSessions({ cwd, limit = 60, host }: { cwd?: string; limit?: number; host?: string }): Promise<NativeSessionInfo[]> {
    const transport = openClient(host ? 'agy' : requireAgy(), cwd ?? (host ? undefined : homedir()), undefined, host);
    try {
      await transport.initialize();
      const result: NativeSessionInfo[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await transport.rpc.request(agent.session.list, { cwd, cursor }, timeout());
        for (const s of page.sessions) {
          if (s.archived || (cwd && resolve(s.cwd) !== resolve(cwd))) continue;
          result.push({ provider: this.provider, nativeSessionId: s.sessionId, cwd: s.cwd, host, title: s.title || s.sessionId, updatedAt: s.updatedAt ?? undefined });
        }
        cursor = page.nextCursor ?? undefined;
        if (!cursor || seen.has(cursor)) break;
        seen.add(cursor);
      } while (result.length < limit);
      return result.slice(0, limit);
    } finally {
      transport.close();
    }
  }

  async listModels(host?: string): Promise<ModelOption[]> {
    const exe = host ? 'agy' : requireAgy();
    let cwd: string;
    if (host) {
      const created = await sshRun(host, 'd=$(mktemp -d /tmp/amw-antigravity-models.XXXXXXXX) || exit; printf "__AMW_MODELS__%s\\n" "$d"');
      cwd = /__AMW_MODELS__(\/tmp\/amw-antigravity-models\.[A-Za-z0-9]+)/.exec(created.stdout)?.[1] ?? '';
      if (created.code !== 0 || !cwd) throw new Error(`Could not prepare an Antigravity model query on ${host}.`);
    } else cwd = await mkdtemp(join(tmpdir(), 'amw-antigravity-models-'));
    const transport = openClient(exe, cwd, undefined, host);
    try {
      await transport.initialize();
      const session = await transport.rpc.request<NewSessionResponse>(agent.session.new, { cwd, mcpServers: [] }, timeout());
      await transport.rpc.request(agent.session.close, { sessionId: session.sessionId }, timeout(2000));
      return catalog(session);
    } finally {
      transport.close();
      if (host) await sshRun(host, `rm -rf -- ${shq(cwd)}`);
      else await rm(cwd, { recursive: true, force: true });
    }
  }

  async readHistory(nativeSessionId: string, cwd: string, host?: string): Promise<ProviderEvent[]> {
    const events: ProviderEvent[] = [];
    const session = new AntigravitySession({ cwd, host, resumeNativeSessionId: nativeSessionId, title: '' }, (e) => events.push(e));
    try {
      await session.start(true);
      return events;
    } finally {
      await session.close();
    }
  }

  createSession(args: StartArgs, emit: (event: ProviderEvent) => void): ProviderSession {
    return new AntigravitySession(args, emit, async () => (await this.listModels(args.host)).find((model) => model.isDefault)?.id);
  }
}

function requireAgy(): string {
  const exe = findExecutable('agy');
  if (!exe) throw new Error('Install the Antigravity CLI (agy) and sign in first.');
  return exe;
}

class AntigravitySession implements ProviderSession {
  readonly provider = 'antigravity' as const;
  readonly canSteer = false;
  private transport?: ReturnType<typeof openClient>;
  private id?: string;
  private closed = false;
  private loading = false;
  private history = new Map<string, Extract<ProviderEvent, { type: 'transcriptItem' }>>();
  private pending = new Map<string, { optionIds: Set<string>; finish: (response: RequestPermissionResponse) => void }>();
  private message?: { key: string; id: string };
  private current?: Promise<void>;
  private finalText = '';
  private catalog?: SessionConfigOption[] | null;
  private defaults = new Map<string, string>();
  private mode: PermissionMode;
  private model?: string;
  private effort?: string | null;
  private stopping = false;
  private inject?: string;
  private usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };

  constructor(private args: StartArgs, private emit: (event: ProviderEvent) => void, private defaultModel?: () => Promise<string | undefined>) {
    this.id = args.resumeNativeSessionId;
    this.model = args.model;
    this.effort = args.reasoningEffort;
    this.mode = args.permissionMode ?? 'ask';
    this.inject = args.developerInstructions;
  }

  nativeSessionId() { return this.id; }

  async start(historyOnly = false): Promise<void> {
    this.transport = openClient(this.args.host ? 'agy' : requireAgy(), this.args.cwd, {
      update: ({ sessionId, update }) => {
        if (this.id === sessionId || (!this.id && !this.closed)) this.onUpdate(update);
      },
      permission: (request, signal) => this.requestPermission(request, signal),
    }, this.args.host, !historyOnly);
    const { rpc } = this.transport;
    try {
      const init = await this.transport.initialize();
      if (init.protocolVersion !== PROTOCOL_VERSION) throw new Error('Antigravity uses an unsupported ACP protocol version.');
      const args = { cwd: this.args.cwd, mcpServers: [] };
      const previous = this.id;
      this.loading = !!previous && (historyOnly || !!this.args.loadHistory);
      let session: SessionOptions;
      if (previous) {
        const request = { ...args, sessionId: previous };
        session = await rpc.request(agent.session.load, request, timeout(25_000));
      } else {
        const created = await rpc.request<NewSessionResponse>(agent.session.new, args, timeout(25_000));
        this.id = created.sessionId;
        session = created;
      }
      this.loading = false;
      for (const item of this.history.values()) {
        if (item.role === 'user') item.text = cleanUserText(item.text.replace(workspaceContext, ''));
        if (item.text || item.images?.length || item.tool) this.emit(item);
      }
      this.history.clear();
      if (historyOnly) return;
      this.catalog = session.configOptions;
      for (const option of session.configOptions ?? []) {
        if (option.type === 'select') this.defaults.set(option.id, option.currentValue);
      }
      await this.configure();
      this.emit({ type: 'sessionStarted', nativeSessionId: this.id!, resumed: !!previous });
      void this.transport.closed.then(() => {
        if (!this.closed) {
          this.clearRequests();
          this.transport?.close();
          this.emit({ type: 'sessionDisconnected', reason: 'Antigravity CLI disconnected.' });
        }
      });
    } catch (error) {
      await this.close();
      if (authRequired(error)) throw new Error(`Sign in to Antigravity by running agy${this.args.host ? ` on ${this.args.host}` : ' in Terminal'}, then try again.`);
      throw error;
    }
  }

  async setModel(model: string | undefined): Promise<void> {
    this.model = model ?? await this.defaultModel?.();
  }
  setReasoningEffort(effort: string | null): Promise<void> { this.effort = effort; return Promise.resolve(); }
  setPermissionMode(mode: PermissionMode): Promise<void> { this.mode = mode; return Promise.resolve(); }

  private async configure() {
    const rpc = this.transport!.rpc;
    const sessionId = this.id!;
    const set = async (category: string, target: string | undefined, fallback = false) => {
      const option = select(this.catalog, category);
      if (option?.type !== 'select') return;
      const value = target ?? (fallback ? this.defaults.get(option.id) : undefined);
      if (!value || value === option.currentValue) return;
      if (!values(option).some((v) => v.value === value)) throw new Error(`Antigravity does not offer ${option.name}: ${value}.`);
      const result = await rpc.request(agent.session.setConfigOption, { sessionId, configId: option.id, value }, timeout());
      this.catalog = result.configOptions;
    };
    // Some accounts do not offer Auto. Preserve native approval prompts in that case.
    const mode = select(this.catalog, 'mode');
    await set('mode', this.mode === 'auto' && !values(mode).some((v) => v.value === 'auto') ? 'default' : modeIds[this.mode]);
    await set('model', this.model, true);
    await set('thought_level', this.effort ?? undefined, this.effort === null);
    const current = select(this.catalog, 'model')?.currentValue;
    if (typeof current === 'string') this.emit({ type: 'model', model: current });
  }

  async send(text: string, opts?: { interrupt?: boolean; images?: ImageInput[] }): Promise<Delivery> {
    if (this.closed || !this.transport || !this.id) throw new Error('Antigravity is disconnected.');
    const active = this.current;
    if (active && !opts?.interrupt) throw new Error('Antigravity is still working. Wait for it to finish or use Stop & send.');
    if (active) await this.interrupt();
    if (this.closed || this.current) throw new Error('Antigravity is busy or disconnected.');
    this.stopping = false;
    this.finalText = '';
    this.message = undefined;
    const run = this.prompt(text, opts?.images).then((result) => {
      this.clearRequests();
      this.current = undefined;
      if (!this.closed) this.emit(result);
    });
    this.current = run;
    this.emit({ type: 'turnStarted' });
    return active ? 'interrupt' : 'turn';
  }

  private async prompt(text: string, images: ImageInput[] = []): Promise<Extract<ProviderEvent, { type: 'turnCompleted' }>> {
    try {
      await this.configure();
      const prompt: ContentBlock[] = [];
      if (this.inject) prompt.push({ type: 'text', text: `<agent-workspace-context>\n${this.inject}\n</agent-workspace-context>` });
      if (text) prompt.push({ type: 'text', text });
      for (const image of images) prompt.push({ type: 'image', mimeType: image.mediaType, data: (await readFile(image.path)).toString('base64') });
      if (this.stopping || this.closed) return { type: 'turnCompleted', status: 'interrupted' };
      const response = await this.transport!.rpc.request(agent.session.prompt, { sessionId: this.id!, prompt });
      this.inject = undefined;
      if (response.usage) {
        const tokens = response.usage;
        const totals = {
          input: Math.max(0, tokens.inputTokens - (tokens.cachedReadTokens ?? 0) - (tokens.cachedWriteTokens ?? 0)),
          output: tokens.outputTokens, cacheRead: tokens.cachedReadTokens ?? 0, cacheWrite: tokens.cachedWriteTokens ?? 0, reasoning: tokens.thoughtTokens ?? 0,
        };
        const add = { ...totals };
        if (this.usage) for (const key of Object.keys(add) as Array<keyof typeof add>) add[key] = Math.max(0, totals[key] - this.usage[key]);
        this.usage = totals;
        this.emit({ type: 'usage', add });
      }
      return { type: 'turnCompleted', status: this.stopping || response.stopReason === 'cancelled' ? 'interrupted' : 'completed', finalText: this.finalText };
    } catch (error) {
      const message = (error as Error).message;
      return { type: 'turnCompleted', status: this.stopping ? 'interrupted' : 'failed', error: message, transient: transientKind(message) };
    }
  }

  async interrupt(): Promise<void> {
    const turn = this.current;
    if (!turn || !this.id || !this.transport) return;
    this.stopping = true;
    this.clearRequests();
    await this.transport.rpc.notify(agent.session.cancel, { sessionId: this.id });
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([turn, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Antigravity did not stop the current turn.')), 10_000);
      })]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearRequests();
    const transport = this.transport;
    try {
      if (transport && this.id && !this.current) {
        await transport.rpc.request(agent.session.close, { sessionId: this.id }, timeout(2000));
      }
    } catch {
      // An already disconnected CLI has no session left to close.
    } finally {
      transport?.close();
    }
  }

  private requestPermission(request: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse> {
    if (signal.aborted || this.closed || this.stopping || this.loading || request.sessionId !== this.id) return Promise.resolve(cancelled);
    const requestId = randomUUID();
    const options = request.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind }));
    const tool = request.toolCall;
    const headline = tool.title ?? 'Antigravity requests permission';
    return new Promise((resolve) => {
      const abort = () => this.pending.get(requestId)?.finish(cancelled);
      this.pending.set(requestId, {
        optionIds: new Set(options.map((o) => o.id)),
        finish: (response) => {
          this.pending.delete(requestId);
          signal.removeEventListener('abort', abort);
          if (response.outcome.outcome === 'cancelled') this.emit({ type: 'requestResolved', requestId, reason: 'Antigravity cancelled the request.' });
          resolve(response);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      this.emit({ type: 'approvalRequested', requestId, headline, details: headline, options, toolCallId: `agy-tool-${tool.toolCallId}`, preview: toolContent(tool, 'proposed') });
    });
  }

  async respond(requestId: string, response: ApprovalResponse): Promise<void> {
    const request = this.pending.get(requestId);
    if (!request || !response.decision || !request.optionIds.has(response.decision)) throw new Error('This Antigravity permission choice is no longer available.');
    request.finish({ outcome: { outcome: 'selected', optionId: response.decision } });
  }

  private clearRequests() {
    for (const request of this.pending.values()) request.finish(cancelled);
  }

  private onUpdate(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk':
      case 'user_message_chunk': {
        const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : update.sessionUpdate === 'agent_thought_chunk' ? 'thought' : 'assistant';
        if (!this.loading && (role === 'user' || !this.current)) break;
        const key = update.messageId ?? role;
        if (this.message?.key !== key) this.message = { key, id: `agy-${randomUUID()}` };
        const itemId = this.message.id;
        const text = update.content.type === 'text' ? update.content.text : '';
        if (this.loading) {
          const item = this.history.get(itemId) ?? { type: 'transcriptItem', itemId, role, text: '', history: true };
          const img: HistoryImage | undefined = update.content.type === 'image' ? { data: update.content.data, mediaType: update.content.mimeType } : undefined;
          if (img) (item.images ??= []).push(img);
          item.text += text;
          this.history.set(itemId, item);
        } else if (text && role !== 'user') {
          if (role === 'assistant') this.finalText += text;
          this.emit({ type: 'outputDelta', itemId, role, delta: text });
        }
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        if (!this.loading && !this.current) break;
        this.message = undefined;
        const status: ToolStatus | undefined = update.status === 'completed' || update.status === 'failed' ? update.status : update.status ? 'running' : undefined;
        const itemId = `agy-tool-${update.toolCallId}`;
        const old = this.history.get(itemId);
        const tool = { ...old?.tool, ...(update.title ? { title: update.title, name: update.title } : {}),
          ...(update.kind ? { kind: update.kind } : {}),
          ...(update.locations ? { locations: update.locations.map((p) => ({ path: p.path, line: p.line ? p.line + 1 : p.line === 0 ? 1 : undefined })) } : {}),
          ...(update.content ? { content: toolContent(update, status === 'completed' ? 'applied' : 'proposed') } : {}),
        };
        const item = { type: 'transcriptItem' as const, itemId, role: 'tool' as const, text: update.title ?? old?.text ?? '', toolStatus: status ?? old?.toolStatus, tool, history: this.loading };
        if (this.loading) this.history.set(itemId, item);
        else this.emit(item);
        break;
      }
      case 'plan':
        if (!this.loading) this.emit({ type: 'planUpdated', entries: update.entries.map(({ content, status }) => ({ content, status })) });
        break;
      case 'usage_update':
        if (!this.loading) this.emit({ type: 'usage', context: update.used, contextWindow: update.size });
        break;
      case 'config_option_update':
        this.catalog = update.configOptions;
        break;
    }
  }
}

function toolContent(tool: ToolCall | ToolCallUpdate, phase: 'proposed' | 'applied'): ToolContent[] {
  const items: ToolContent[] = [];
  for (const entry of tool.content ?? []) {
    if (entry.type === 'content' && entry.content.type === 'text') items.push({ type: 'text', text: clipOutput(entry.content.text) });
    if (entry.type === 'diff') items.push({
      type: 'diff',
      diff: makeDiff({ path: entry.path, operation: entry.oldText == null ? 'add' : 'modify', phase, hunks: snippetHunks(entry.oldText ?? '', entry.newText), snippet: true }),
    });
  }
  return items;
}
