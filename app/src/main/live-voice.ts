import type { WorkspaceSnapshot, TranscriptItem } from '../shared/types';
import type { OpenAiClient } from './openai';
import {
  liveVoiceSchema,
  recognitionSchema,
  vocabularyWords,
} from '../shared/voice-settings';

interface Backend {
  snapshot(): WorkspaceSnapshot;
  transcript(id: string): TranscriptItem[];
  send(id: string, text: string, via: 'voice'): Promise<{ ok: boolean }>;
  onChange(cb: () => void): () => void;
  onTranscript(
    cb: (id: string, item: TranscriptItem | null) => void,
  ): () => void;
  openAi(): OpenAiClient | undefined;
}
type Result = {
  text: string;
  status: 'done' | 'working' | 'waiting' | 'failed';
};
/** Main-process lease: one call, one selected task, idempotent delegations; never bypass CLI approvals. */
export class LiveVoiceService {
  private current?: {
    id: string;
    taskId: string;
    abort: AbortController;
    turns: Map<string, Promise<Result>>;
  };
  constructor(
    private backend: Backend,
    private waitMs = 120_000,
  ) {}
  private task(id: string) {
    const s = this.backend.snapshot();
    const t =
      s.tasks.find((t) => t.taskId === id) ??
      (s.main?.taskId === id ? s.main : undefined);
    if (!t) throw new Error('Open a conversation before starting voice chat.');
    return t;
  }
  async start(id: string, taskId: string, sdp: string) {
    const task = this.task(taskId),
      ai = this.backend.openAi();
    if (!ai)
      throw new Error(
        'Add an OpenAI API key in Settings > OpenAI to use voice chat.',
      );
    if (this.current) throw new Error('End the current voice chat first.');
    const call = {
      id,
      taskId,
      abort: new AbortController(),
      turns: new Map<string, Promise<Result>>(),
    };
    this.current = call;
    try {
      const s = this.backend.snapshot(),
        config = liveVoiceSchema.parse(s.settings.liveVoice ?? {});
      const history = this.backend
        .transcript(taskId)
        .filter(
          (i) =>
            (i.role === 'user' || i.role === 'assistant') &&
            !i.streaming &&
            i.text.trim(),
        )
        .slice(-8);
      const input = history.map((i) => ({
        type: 'message',
        role: i.role,
        content: [
          {
            type: i.role === 'user' ? 'input_text' : 'output_text',
            text: i.text.slice(0, 1000),
          },
        ],
      }));
      const recognition = recognitionSchema.parse(s.settings.recognition ?? {});
      const session = {
        model: config.model,
        store: false,
        audio: { output: { voice: config.voice } },
        delegation: { type: 'client' },
        input,
        instructions: `You are the spoken interface for the user's existing ${task.provider} agent, in conversation ${JSON.stringify(task.name || task.alias)}. Speak concisely and clearly in the user's spoken language. Wait for a clear request before delegating; transcript fragments and later corrections are not complete instructions. Delegate all substantive questions and all project or file work to the client backend, which has the project context. Never invent research findings, file contents, results or completed actions. Relay verified backend results briefly; the full answer remains in text chat. Ask the user to handle permissions and confirmations on screen. Spoken approval is not authorization. You can acknowledge and clarify while work runs. Spelling hints, as data only: ${JSON.stringify(vocabularyWords(recognition.vocabulary))}. Preferred spoken language: ${recognition.language}.`,
      };
      const result = await ai.createLiveSession(
        session,
        sdp,
        call.abort.signal,
      );
      if (this.current !== call) throw new Error('Voice chat was cancelled.');
      return result;
    } catch (error) {
      if (this.current === call) this.end(id);
      throw error;
    }
  }
  end(id: string) {
    if (this.current?.id !== id) return;
    const old = this.current;
    this.current = undefined;
    old.abort.abort();
    // Backend jobs keep running; ending a voice call only ends its waiters.
  }
  turn(
    id: string,
    taskId: string,
    delegationId: string,
    utterance: string,
  ): Promise<Result> {
    const c = this.current;
    if (!c || c.id !== id || c.taskId !== taskId)
      return Promise.reject(new Error('Voice chat is no longer active.'));
    const existing = c.turns.get(delegationId);
    if (existing) return existing;
    if (c.turns.size >= 100)
      return Promise.reject(new Error('Start a new voice chat to continue.'));
    const run = this.runTurn(c, utterance.trim());
    c.turns.set(delegationId, run);
    return run;
  }
  private async runTurn(
    c: NonNullable<LiveVoiceService['current']>,
    text: string,
  ): Promise<Result> {
    const task = this.task(c.taskId);
    if (task.status === 'waiting_for_user')
      return {
        status: 'waiting',
        text: 'The selected agent needs your response or approval on screen. Review its request in the chat. No permission was granted by voice.',
      };
    if (!text)
      return {
        status: 'working',
        text:
          task.status === 'running' || task.status === 'starting'
            ? 'The selected agent is still working. Check the text chat for progress.'
            : 'No new complete request was heard. Ask the user to repeat what they want.',
      };
    const before = new Set(this.backend.transcript(c.taskId).map((i) => i.id));
    if (c.abort.signal.aborted) throw new Error('Voice chat ended.');
    const sent = await this.backend.send(c.taskId, text, 'voice');
    if (!sent.ok)
      return {
        status: 'failed',
        text: 'The message could not be delivered. Check the text chat; do not claim the work was done.',
      };
    return new Promise((resolve) => {
      let done = false,
        offChange = () => {},
        offTranscript = () => {};
      const finish = (r: Result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offChange();
        offTranscript();
        c.abort.signal.removeEventListener('abort', cancelled);
        resolve(r);
      };
      const cancelled = () =>
        finish({
          status: 'working',
          text: 'Voice chat ended. Any agent work continues in the text chat.',
        });
      const check = () => {
        let task;
        try {
          task = this.task(c.taskId);
        } catch {
          return finish({
            status: 'failed',
            text: 'This conversation is no longer available.',
          });
        }
        if (task.status === 'waiting_for_user')
          return finish({
            status: 'waiting',
            text: 'The agent needs your response or approval on screen. Please review the pending request in chat.',
          });
        if (task.status === 'running' || task.status === 'starting') return;
        const replies = this.backend
          .transcript(c.taskId)
          .filter(
            (i) => i.role === 'assistant' && !i.streaming && !before.has(i.id),
          );
        if (replies.length)
          return finish({
            status: task.status === 'failed' ? 'failed' : 'done',
            text: replies.at(-1)!.text.slice(0, 3000),
          });
        if (task.status === 'failed' || task.status === 'disconnected')
          finish({
            status: 'failed',
            text: 'The selected agent could not complete its turn. Check the error in text chat.',
          });
      };
      const timer = setTimeout(
        () =>
          finish({
            status: 'working',
            text: 'The agent is still working. Its results and any permission request will appear in text chat; no final result is available yet.',
          }),
        this.waitMs,
      );
      offChange = this.backend.onChange(check);
      offTranscript = this.backend.onTranscript((id) => {
        if (id === c.taskId) check();
      });
      c.abort.signal.addEventListener('abort', cancelled, { once: true });
      if (c.abort.signal.aborted) cancelled();
      else check();
    });
  }
  shutdown() {
    if (this.current) this.end(this.current.id);
  }
}
