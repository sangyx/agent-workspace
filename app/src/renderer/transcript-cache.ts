import type { TranscriptItem } from '../shared/types';

type State = Record<string, TranscriptItem[]>;
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every((key) => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** One index and at most one copy per changed conversation, rather than per streamed item. */
export function upsertTranscript(previous: TranscriptItem[], incoming: Iterable<TranscriptItem>): TranscriptItem[] {
  const index = new Map(previous.map((item, i) => [item.id, i]));
  let next = previous;
  for (const item of incoming) {
    const at = index.get(item.id);
    if (at !== undefined && same(next[at], item)) continue;
    if (next === previous) next = previous.slice();
    if (at === undefined) { index.set(item.id, next.length); next.push(item); }
    else next[at] = item;
  }
  return next;
}

/** Keeps full loads, resets and streamed updates ordered, even when IPC replies arrive late. */
export class TranscriptCache {
  value: State = {};
  private loaded = new Set<string>();
  private pending = new Map<string, { updates: Map<string, TranscriptItem> }>();
  private listeners = new Set<(state: State) => void>();
  constructor(private read: (taskId: string) => Promise<TranscriptItem[]>) {}
  subscribe(listener: (state: State) => void) {
    this.listeners.add(listener);
    listener(this.value);
    return () => { this.listeners.delete(listener); };
  }
  private publish(next: State) {
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener(next);
  }
  async load(taskId: string) {
    this.loaded.add(taskId);
    const request = { updates: new Map<string, TranscriptItem>() };
    this.pending.set(taskId, request);
    try {
      const rows = await this.read(taskId);
      if (this.pending.get(taskId) !== request) return;
      const fetched = upsertTranscript(rows, request.updates.values());
      // Reuse unchanged rows after a full load, but honor removals and the saved order.
      const previous = this.value[taskId] ?? [];
      const byId = new Map(previous.map((item) => [item.id, item]));
      const next = fetched.map((item) => same(byId.get(item.id), item) ? byId.get(item.id)! : item);
      if (next.length !== previous.length || next.some((item, i) => item !== previous[i]) || !Object.hasOwn(this.value, taskId))
        this.publish({ ...this.value, [taskId]: next });
    } finally {
      if (this.pending.get(taskId) === request) this.pending.delete(taskId);
    }
  }
  async update(items: TranscriptItem[], resets: string[] = []) {
    const reloads = [...new Set(resets)].filter((id) => this.loaded.has(id)).map((id) => this.load(id));
    const grouped = new Map<string, TranscriptItem[]>();
    for (const item of items) {
      if (!this.loaded.has(item.taskId)) continue;
      const list = grouped.get(item.taskId) ?? [];
      if (!grouped.has(item.taskId)) grouped.set(item.taskId, list);
      list.push(item);
      this.pending.get(item.taskId)?.updates.set(item.id, item);
    }
    let next = this.value;
    for (const [taskId, rows] of grouped) {
      const old = this.value[taskId] ?? [];
      const list = upsertTranscript(old, rows);
      if (list === old) continue;
      if (next === this.value) next = { ...this.value };
      next[taskId] = list;
    }
    this.publish(next);
    await Promise.all(reloads);
  }
}
