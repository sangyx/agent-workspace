export interface LiveApi {
  start(
    id: string,
    taskId: string,
    sdp: string,
  ): Promise<{ sessionId: string; sdp: string }>;
  end(id: string): Promise<void>;
  turn(
    id: string,
    taskId: string,
    delegationId: string,
    utterance: string,
  ): Promise<{ text: string; status: string }>;
}
export interface LiveState {
  phase: 'off' | 'connecting' | 'live' | 'closing' | 'error';
  message?: string;
  heard?: string;
  said?: string;
  muted?: boolean;
  seconds?: number;
}
/** Break context updates at Unicode boundaries, below Live's per-append token limit. */
export function voiceChunks(text: string): string[] {
  text = text
    .replace(/```[\s\S]*?```/g, '[Code is in the text chat.]')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  const result: string[] = [];
  let part = '',
    bytes = 0,
    total = 0;
  for (const c of text) {
    const n = new TextEncoder().encode(c).length;
    if (total + n > 1200) {
      if (part) result.push(part);
      result.push('Full details are available in the text chat.');
      return result;
    }
    if (bytes + n > 360) {
      result.push(part);
      part = '';
      bytes = 0;
    }
    part += c;
    bytes += n;
    total += n;
  }
  if (part) result.push(part);
  return result;
}
/** WebRTC media stays on negotiated tracks. The standard API key stays in the main process. */
export class LiveConversation {
  private current?: {
    id: string;
    taskId: string;
    peer: RTCPeerConnection;
    audio: HTMLAudioElement;
    stream?: MediaStream;
    channel?: RTCDataChannel;
    ready: boolean;
    closing: boolean;
    timers: Set<ReturnType<typeof setTimeout>>;
    seen: Set<string>;
    input: string;
    heard: string;
    said: string;
    lastInput: number;
    cancelGather?: () => void;
  };
  private disposed = false;
  private publish(s: LiveState) {
    if (!this.disposed) this.update(s);
  }
  constructor(
    private api: LiveApi,
    private update: (s: LiveState) => void,
  ) {}
  async start(taskId: string) {
    if (this.current || this.disposed) return;
    const peer = new RTCPeerConnection(),
      audio = new Audio();
    audio.autoplay = true;
    const c = {
      id: crypto.randomUUID(),
      taskId,
      peer,
      audio,
      ready: false,
      closing: false,
      timers: new Set<ReturnType<typeof setTimeout>>(),
      seen: new Set<string>(),
      input: '',
      heard: '',
      said: '',
      lastInput: 0,
    } as NonNullable<LiveConversation['current']>;
    this.current = c;
    this.publish({ phase: 'connecting' });
    const fail = (message: string) => {
      if (this.current === c) {
        this.cleanup(c);
        this.publish({ phase: 'error', message });
      }
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.current !== c) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      c.stream = stream;
      stream.getAudioTracks().forEach((t) => peer.addTrack(t, stream));
      peer.addEventListener('track', (e) => {
        if (this.current !== c) return;
        audio.srcObject = new MediaStream([e.track]);
        void audio.play().catch(() => {
          if (this.current === c)
            this.publish({
              phase: 'live',
              message: 'Enable speaker playback to hear the reply.',
            });
        });
      });
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed')
          fail(
            'Voice connection lost. Start a new voice chat; agent work remains in text chat.',
          );
      });
      const channel = peer.createDataChannel('oai-events');
      c.channel = channel;
      channel.addEventListener('message', (e) => {
        if (
          this.current !== c ||
          typeof e.data !== 'string' ||
          e.data.length > 100000
        )
          return;
        let event: any;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === 'session.closed') {
          const seconds =
            typeof event.usage?.seconds === 'number'
              ? event.usage.seconds
              : undefined;
          this.cleanup(c);
          this.publish({ phase: 'off', seconds });
          return;
        }
        if (event.type === 'error') {
          fail(
            'The voice provider reported an error. Check GPT-Live access and billing in Settings > OpenAI.',
          );
          return;
        }
        if (event.type === 'session.started') {
          c.ready = true;
          this.publish({ phase: 'live' });
          return;
        }
        if (c.closing || !c.ready) return;
        if (
          event.type === 'session.input_transcript.delta' &&
          typeof event.delta === 'string'
        ) {
          if (c.input.length + event.delta.length > 12000) {
            fail(
              'This spoken request is too long. Start a new voice chat with a shorter request.',
            );
            return;
          }
          c.input += event.delta;
          c.heard = c.input;
          c.lastInput = Date.now();
          this.publish({ phase: 'live', heard: c.heard, said: c.said });
        } else if (
          event.type === 'session.output_transcript.delta' &&
          typeof event.delta === 'string'
        ) {
          c.said = (c.said + event.delta).slice(-1000);
          this.publish({ phase: 'live', heard: c.heard, said: c.said });
        } else if (
          event.type === 'session.delegation.created' &&
          event.delegation?.target === 'client' &&
          typeof event.delegation.id === 'string'
        ) {
          const id = event.delegation.id;
          if (c.seen.has(id)) return;
          c.seen.add(id);
          // Deltas are fragments, not complete turns. Wait for the latest words/corrections to settle.
          const run = () => {
            if (this.current !== c || c.closing) return;
            if (Date.now() - c.lastInput < 700) {
              const timer = setTimeout(() => {
                c.timers.delete(timer);
                run();
              }, 700);
              c.timers.add(timer);
              return;
            }
            const text = c.input.trim();
            c.input = '';
            c.said = '';
            void this.api
              .turn(c.id, c.taskId, id, text)
              .then((result) => {
                if (this.current !== c || c.closing) return;
                for (const content of voiceChunks(result.text))
                  this.send(c, {
                    type: 'session.commentary.append',
                    event_id: crypto.randomUUID(),
                    delegation_id: id,
                    content,
                  });
              })
              .catch(() => {
                if (this.current === c && !c.closing)
                  this.send(c, {
                    type: 'session.commentary.append',
                    event_id: crypto.randomUUID(),
                    delegation_id: id,
                    content:
                      'The backend could not deliver a verified result. Please check the text chat.',
                  });
              });
          };
          run();
        }
      });
      channel.addEventListener('close', () => {
        if (this.current === c)
          fail(
            'Voice connection ended without confirmed final usage. Agent work remains in text chat.',
          );
      });
      const offer = await peer.createOffer();
      if (this.current !== c) return;
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== 'complete')
        await new Promise<void>((resolve, reject) => {
          const changed = () => {
            if (peer.iceGatheringState === 'complete') {
              clearTimeout(timer);
              c.timers.delete(timer);
              peer.removeEventListener('icegatheringstatechange', changed);
              resolve();
            }
          };
          const timer = setTimeout(() => {
            c.timers.delete(timer);
            peer.removeEventListener('icegatheringstatechange', changed);
            reject(new Error('Voice network setup timed out.'));
          }, 10000);
          c.cancelGather = () => {
            clearTimeout(timer);
            peer.removeEventListener('icegatheringstatechange', changed);
            reject(new Error('Voice setup cancelled.'));
          };
          c.timers.add(timer);
          peer.addEventListener('icegatheringstatechange', changed);
          changed();
        });
      if (this.current !== c) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('Missing voice connection offer.');
      const result = await this.api.start(c.id, taskId, sdp);
      if (this.current !== c) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      const timeout = setTimeout(() => {
        c.timers.delete(timeout);
        if (!c.ready)
          fail(
            'The voice session did not become ready. Check your network and GPT-Live access.',
          );
      }, 20000);
      c.timers.add(timeout);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Could not start voice chat.');
    }
  }
  mute(muted: boolean) {
    this.current?.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }
  end() {
    const c = this.current;
    if (!c || c.closing) return;
    c.stream?.getTracks().forEach((t) => t.stop());
    c.audio.pause();
    if (!c.ready || c.channel?.readyState !== 'open') {
      this.cleanup(c);
      this.publish({ phase: 'off' });
      return;
    }
    c.closing = true;
    void this.api.end(c.id).catch(() => {});
    this.publish({ phase: 'closing' });
    this.send(c, { type: 'session.close' });
    const timer = setTimeout(() => {
      c.timers.delete(timer);
      if (this.current === c) {
        this.cleanup(c);
        this.publish({
          phase: 'error',
          message:
            'Call ended without confirmed final usage. Agent work remains in text chat.',
        });
      }
    }, 15000);
    c.timers.add(timer);
  }
  dispose() {
    this.disposed = true;
    this.end();
  }
  private send(c: NonNullable<LiveConversation['current']>, event: unknown) {
    if (c.channel?.readyState === 'open') c.channel.send(JSON.stringify(event));
  }
  private cleanup(c: NonNullable<LiveConversation['current']>) {
    if (this.current === c) this.current = undefined;
    c.cancelGather?.();
    c.cancelGather = undefined;
    c.timers.forEach(clearTimeout);
    c.timers.clear();
    c.stream?.getTracks().forEach((t) => t.stop());
    c.channel?.close();
    c.peer.close();
    c.audio.pause();
    c.audio.srcObject = null;
    void this.api.end(c.id).catch(() => {});
  }
}
