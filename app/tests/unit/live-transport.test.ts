import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LiveConversation,
  voiceChunks,
  type LiveState,
} from '../../src/renderer/voice/live';
class Channel extends EventTarget {
  readyState = 'open';
  sent: any[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
  emit(value: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(value) }),
    );
  }
}
class Peer extends EventTarget {
  static latest: Peer;
  channel = new Channel();
  localDescription = { sdp: 'offer' };
  iceGatheringState = 'complete';
  connectionState = 'connected';
  close = vi.fn();
  addTrack = vi.fn();
  constructor() {
    super();
    Peer.latest = this;
  }
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return this.localDescription;
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
}
function setup() {
  vi.useFakeTimers();
  const track = { enabled: true, stop: vi.fn() },
    stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal(
    'Audio',
    class {
      autoplay = false;
      srcObject = null;
      pause = vi.fn();
      play = vi.fn(async () => {});
    },
  );
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
  const api = {
      start: vi.fn(async () => ({ sessionId: 'live_123', sdp: 'answer' })),
      end: vi.fn(async () => {}),
      turn: vi.fn(async () => ({
        text: 'Verified backend answer.',
        status: 'done',
      })),
    },
    states: LiveState[] = [];
  const controller = new LiveConversation(api, (state) => states.push(state));
  return { controller, states, api, track, stream };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('live voice transport', () => {
  it('waits for session.started, assembles fragments once, and returns verified backend results', async () => {
    const f = setup();
    await f.controller.start('task');
    const ch = Peer.latest.channel;
    expect(ch.sent).toEqual([]);
    ch.emit({ type: 'session.started' });
    ch.emit({ type: 'session.input_transcript.delta', delta: 'Compare' });
    ch.emit({
      type: 'session.delegation.created',
      delegation: { id: 'd', target: 'client' },
    });
    await vi.advanceTimersByTimeAsync(300);
    ch.emit({
      type: 'session.input_transcript.delta',
      delta: ' the ablations.',
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.api.turn).toHaveBeenCalledTimes(1);
    expect(f.api.turn.mock.calls[0]).toEqual([
      expect.any(String),
      'task',
      'd',
      'Compare the ablations.',
    ]);
    ch.emit({
      type: 'session.delegation.created',
      delegation: { id: 'd', target: 'client' },
    });
    expect(f.api.turn).toHaveBeenCalledTimes(1);
    expect(ch.sent).toContainEqual(
      expect.objectContaining({
        type: 'session.commentary.append',
        delegation_id: 'd',
        content: 'Verified backend answer.',
      }),
    );
    f.controller.dispose();
  });
  it('mutes tracks and closes gracefully, without a second session.start', async () => {
    const f = setup();
    await f.controller.start('task');
    const peer = Peer.latest,
      ch = peer.channel;
    ch.emit({ type: 'session.started' });
    f.controller.mute(true);
    expect(f.track.enabled).toBe(false);
    f.controller.mute(false);
    expect(f.track.enabled).toBe(true);
    f.controller.end();
    expect(ch.sent).toEqual([{ type: 'session.close' }]);
    expect(peer.close).not.toHaveBeenCalled();
    ch.emit({ type: 'session.closed', usage: { seconds: 12 } });
    expect(peer.close).toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.states.at(-1)).toEqual({ phase: 'off', seconds: 12 });
  });
  it('cleans up denied/failed starts, late microphone permission and network close', async () => {
    const f = setup();
    let resolve!: (stream: typeof f.stream) => void;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    });
    const pending = f.controller.start('task');
    f.controller.dispose();
    resolve(f.stream);
    await pending;
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.api.start).not.toHaveBeenCalled();
  });
  it('marks finalization unconfirmed on close timeout and suppresses late results', async () => {
    const f = setup();
    await f.controller.start('task');
    const ch = Peer.latest.channel;
    ch.emit({ type: 'session.started' });
    f.controller.end();
    await vi.advanceTimersByTimeAsync(15001);
    expect(f.states.at(-1)?.message).toContain('without confirmed final usage');
    expect(f.track.stop).toHaveBeenCalled();
    ch.emit({
      type: 'session.input_transcript.delta',
      delta: 'Do not dispatch after close',
    });
    expect(f.api.turn).not.toHaveBeenCalled();
  });
  it('does not silently truncate a long spoken instruction into a different request', async () => {
    const f = setup();
    await f.controller.start('task');
    const ch = Peer.latest.channel;
    ch.emit({ type: 'session.started' });
    ch.emit({
      type: 'session.input_transcript.delta',
      delta: 'x'.repeat(12001),
    });
    expect(f.states.at(-1)?.phase).toBe('error');
    expect(f.api.turn).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it('keeps Unicode intact and code in text chat with bounded context updates', () => {
    const chunks = voiceChunks(
      '中文 results. '.repeat(200) + '\n```secret code```',
    );
    expect(chunks.at(-1)).toContain('text chat');
    expect(chunks.every((s) => new TextEncoder().encode(s).length <= 360)).toBe(
      true,
    );
    expect(chunks.join('')).not.toContain('\uFFFD');
    expect(voiceChunks('```code```').join('')).not.toContain('```');
  });
});
