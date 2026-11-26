import { useCallback, useEffect, useState } from 'react';
import type { TranscriptItem, WorkspaceSnapshot } from '../shared/types';
import { call } from './api';
import { t } from './i18n';
import { TranscriptCache } from './transcript-cache';

/** Snapshot-on-start, then push updates from the main process (spec 03: recover from missed events). */
export function useWorkspace(): WorkspaceSnapshot | null {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  useEffect(() => {
    let pushed = false, alive = true;
    const off = window.amw.onWorkspace((value) => { pushed = true; setSnapshot(value); });
    void call('workspace:snapshot', {}).then((value) => { if (alive && !pushed) setSnapshot(value); });
    return () => { alive = false; off(); };
  }, []);
  return snapshot;
}

/** Transcripts are loaded per task on demand and kept current from pushed item upserts. */
export function useTranscripts(): {
  transcripts: Record<string, TranscriptItem[]>;
  load: (taskId: string) => void;
} {
  const [cache] = useState(() => new TranscriptCache((taskId) => call('transcript:get', { taskId })));
  const [transcripts, setTranscripts] = useState(cache.value);
  useEffect(() => {
    return cache.subscribe(setTranscripts);
  }, [cache]);
  useEffect(() => {
    return window.amw.onTranscript(({ items, resets }) => {
      void cache.update(items, resets).catch((error) => console.error('Could not reload conversation', error));
    });
  }, [cache]);
  const load = useCallback((taskId: string) => {
    void cache.load(taskId).catch((error) => console.error('Could not load conversation', error));
  }, [cache]);
  return { transcripts, load };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return t('just now');
  const m = Math.round(s / 60);
  if (m < 60) return t('{n}m ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n}h ago', { n: h });
  return t('{n}d ago', { n: Math.round(h / 24) });
}

/** Re-render periodically so relative times stay fresh. */
export function useTick(ms = 30_000): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
