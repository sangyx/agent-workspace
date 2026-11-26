import { expect, it, vi } from 'vitest';
import type { TranscriptItem } from '../../src/shared/types';
import { TranscriptCache, upsertTranscript } from '../../src/renderer/transcript-cache';
const item = (id: string, taskId = 'a', text = id): TranscriptItem => ({ id, taskId, role: 'assistant', text, createdAt: '2026-01-01' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
it('batches long transcripts and preserves unchanged rows, streaming state and structured decisions', () => {
  const previous = Array.from({ length: 20_000 }, (_, i) => item(String(i)));
  const updates = previous.slice(-500).map((row) => ({ ...row, text: row.text + ' streamed', streaming: true }));
  const next = upsertTranscript(previous, [...updates, { ...updates[0], streaming: false }]);
  expect(next).toHaveLength(previous.length);
  expect(next[0]).toBe(previous[0]);
  expect(next[19_500].streaming).toBe(false);
  expect(previous[19_500].streaming).toBeUndefined();
  expect(upsertTranscript(next, structuredClone(next.slice(-500)))).toBe(next);
  const decided = { ...next[0], decision: { kind: 'approval' as const, label: 'Denied', options: [{ label: 'Allow', chosen: false }] } };
  expect(upsertTranscript(next, [decided])[0]).toBe(decided);
});
it('retains streamed deltas that arrive while a full load is in flight, and ignores unloaded conversations', async () => {
  const read = deferred<TranscriptItem[]>();
  const cache = new TranscriptCache(() => read.promise);
  const publish = vi.fn(); cache.subscribe(publish);
  const loading = cache.load('a');
  await cache.update([item('1', 'a', 'new stream'), item('2'), item('hidden', 'unloaded')]);
  read.resolve([item('1', 'a', 'old snapshot')]);
  await loading;
  expect(cache.value.a.map((r) => r.text)).toEqual(['new stream', '2']);
  expect(cache.value.unloaded).toBeUndefined();
  const state = cache.value;
  const count = publish.mock.calls.length;
  await cache.update([structuredClone(cache.value.a[0])]);
  expect(cache.value).toBe(state); expect(publish).toHaveBeenCalledTimes(count);
});
it('a reset replaces removed history, keeps later deltas and defeats older load responses', async () => {
  const old = deferred<TranscriptItem[]>(), reset = deferred<TranscriptItem[]>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(reset.promise);
  const cache = new TranscriptCache(read);
  const loading = cache.load('a');
  await cache.update([item('removed'), item('b-row', 'b')]);
  const resetting = cache.update([item('after-reset', 'a', 'stream after reset')], ['a', 'a', 'unloaded']);
  reset.resolve([item('replacement')]); await resetting;
  old.resolve([item('removed')]); await loading;
  expect(read).toHaveBeenCalledTimes(2);
  expect(cache.value.a.map((r) => r.id)).toEqual(['replacement', 'after-reset']);
  expect(cache.value.b).toBeUndefined();
});
it('reuses stable full loads and preserves the order and removals of the authoritative history', async () => {
  const rows = [item('1'), item('2')];
  const read = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(structuredClone(rows)).mockResolvedValueOnce([item('2')]);
  const cache = new TranscriptCache(read);
  await cache.load('a'); const first = cache.value;
  await cache.load('a'); expect(cache.value).toBe(first);
  await cache.load('a'); expect(cache.value.a).toEqual([item('2')]); expect(cache.value.a[0]).toBe(rows[1]);
});
it('failed loads can retry and unsubscribed views receive no late updates', async () => {
  const late = deferred<TranscriptItem[]>();
  const read = vi.fn().mockRejectedValueOnce(new Error('IPC unavailable')).mockReturnValueOnce(late.promise);
  const cache = new TranscriptCache(read), publish = vi.fn();
  const off = cache.subscribe(publish);
  await expect(cache.load('a')).rejects.toThrow('IPC unavailable');
  const retry = cache.load('a'); off();
  late.resolve([item('ok')]); await retry;
  expect(cache.value.a[0].id).toBe('ok'); expect(publish).toHaveBeenCalledTimes(1);
});
