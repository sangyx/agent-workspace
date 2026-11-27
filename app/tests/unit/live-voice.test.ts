import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiveVoiceService } from '../../src/main/live-voice';
import { OpenAiClient } from '../../src/main/openai';
import type { WorkspaceSnapshot, TranscriptItem } from '../../src/shared/types';
import { ipcSchemas } from '../../src/shared/ipc';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const snapshot = {
    tasks: [
      {
        taskId: 't',
        provider: 'claude',
        name: 'Ablation study',
        status: 'done',
      },
    ],
    settings: { recognition: { language: 'mixed', vocabulary: 'LoRA' } },
  } as unknown as WorkspaceSnapshot;
  const transcript: TranscriptItem[] = [
    {
      id: 'old',
      taskId: 't',
      role: 'assistant',
      text: 'Earlier context',
      createdAt: 'now',
    },
  ];
  const change = new Set<() => void>(),
    updated = new Set<(id: string, item: TranscriptItem | null) => void>();
  const ai = {
    createLiveSession: vi.fn(async () => ({
      sessionId: 'live_123',
      sdp: 'answer',
    })),
  };
  const send = vi.fn(async () => {
    snapshot.tasks[0].status = 'running';
    return { ok: true };
  });
  const backend = {
    snapshot: () => snapshot,
    transcript: () => transcript,
    send,
    openAi: () => ai as unknown as OpenAiClient,
    onChange: (f: () => void) => {
      change.add(f);
      return () => {
        change.delete(f);
      };
    },
    onTranscript: (f: (id: string, item: TranscriptItem | null) => void) => {
      updated.add(f);
      return () => {
        updated.delete(f);
      };
    },
  };
  return {
    snapshot,
    transcript,
    change,
    updated,
    send,
    ai,
    backend,
    service: new LiveVoiceService(backend, 1000),
  };
}
describe('voice session ownership and delegation', () => {
  it('seeds only recent visible text and keeps the selected provider as the backend', async () => {
    const f = fixture();
    await f.service.start('call', 't', 'offer');
    const args = f.ai.createLiveSession.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
    ];
    expect(args[0]).toMatchObject({
      model: 'gpt-live-1.1',
      store: false,
      delegation: { type: 'client' },
      audio: { output: { voice: 'marin' } },
    });
    expect(JSON.stringify(args[0])).toContain('Earlier context');
    expect(JSON.stringify(args[0])).toContain('claude');
    f.service.shutdown();
  });
  it('sends once and waits for verified completed assistant output', async () => {
    const f = fixture();
    await f.service.start('call', 't', 'offer');
    const result = f.service.turn(
      'call',
      't',
      'delegation',
      'Compare the ablations.',
    );
    expect(f.service.turn('call', 't', 'delegation', 'duplicate')).toBe(result);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.transcript.push({
      id: 'progress',
      taskId: 't',
      role: 'assistant',
      text: 'I will check the files.',
      createdAt: 'now',
    });
    f.transcript.push({
      id: 'new',
      taskId: 't',
      role: 'assistant',
      text: 'Verified result: the control passed.',
      streaming: false,
      createdAt: 'now',
    });
    f.snapshot.tasks[0].status = 'done';
    f.change.forEach((fn) => fn());
    await expect(result).resolves.toEqual({
      status: 'done',
      text: 'Verified result: the control passed.',
    });
    expect(f.send).toHaveBeenCalledWith('t', 'Compare the ablations.', 'voice');
    f.service.shutdown();
  });
  it('keeps approvals on screen and rejects cross-task or expired leases', async () => {
    const f = fixture();
    await f.service.start('call', 't', 'offer');
    f.snapshot.tasks[0].status = 'waiting_for_user';
    expect((await f.service.turn('call', 't', 'd', 'Yes, allow.')).status).toBe(
      'waiting',
    );
    expect(f.send).not.toHaveBeenCalled();
    await expect(f.service.turn('call', 'other', 'd', 'Run')).rejects.toThrow(
      'no longer active',
    );
    f.service.end('call');
    await expect(f.service.turn('call', 't', 'd', 'Run')).rejects.toThrow(
      'no longer active',
    );
  });
  it('ending a call cancels waiters but leaves the agent working', async () => {
    const f = fixture();
    await f.service.start('call', 't', 'offer');
    const waiting = f.service.turn('call', 't', 'd', 'Run the experiment.');
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    f.service.end('call');
    expect((await waiting).status).toBe('working');
    expect(f.snapshot.tasks[0].status).toBe('running');
    expect(f.change.size).toBe(0);
    expect(f.updated.size).toBe(0);
  });
  it('reports pending work honestly after the bounded wait', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.service.start('call', 't', 'offer');
    const pending = f.service.turn('call', 't', 'd', 'Run');
    await vi.advanceTimersByTimeAsync(1001);
    expect((await pending).status).toBe('working');
    expect(f.snapshot.tasks[0].status).toBe('running');
    f.service.shutdown();
  });
});
describe('current OpenAI voice APIs', () => {
  it('uses multilingual vocabulary hints with GPT-Transcribe', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: 'LoRA 消融实验' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', request);
    const ai = new OpenAiClient('test-key');
    await ai.transcribe(new Uint8Array([1, 2]), 'audio/wav', 'Research notes', {
      keywords: ['LoRA'],
      languages: ['zh', 'en'],
    });
    const options = request.mock.calls[0] as unknown as [string, RequestInit];
    const form = options[1].body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['zh', 'en']);
    expect(form.getAll('keywords[]')).toEqual(['LoRA']);
  });
  it('creates a WebRTC session in main without returning credentials', async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            session: { id: 'live_123', secret: 'not-returned' },
            transport: { type: 'webrtc', sdp: 'answer' },
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', request);
    const result = await new OpenAiClient('private-key').createLiveSession(
      { model: 'gpt-live-1.1', delegation: { type: 'client' } },
      'offer',
    );
    expect(result).toEqual({ sessionId: 'live_123', sdp: 'answer' });
    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    expect(JSON.parse(options.body as string).transport).toEqual({
      type: 'webrtc',
      sdp: 'offer',
    });
  });
  it('redacts provider failures and validates bounded IPC settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('private audio/key echo', { status: 401 }),
      ),
    );
    await expect(
      new OpenAiClient('private-key').createLiveSession({}, 'offer'),
    ).rejects.toThrow('401');
    await expect(
      new OpenAiClient('private-key').transcribe(
        new Uint8Array([1]),
        'audio/wav',
      ),
    ).rejects.not.toThrow('private audio/key echo');
    expect(
      ipcSchemas['voice:liveTurn'].safeParse({
        id: 'c',
        taskId: 't',
        delegationId: 'd',
        utterance: 'x'.repeat(12001),
      }).success,
    ).toBe(false);
    expect(
      ipcSchemas['settings:update'].parse({
        recognition: { language: 'mixed', vocabulary: 'LoRA' },
      }),
    ).toMatchObject({ recognition: { language: 'mixed' } });
  });
});
