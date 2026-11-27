import { useEffect, useRef, useState } from 'react';
import { LiveConversation, type LiveState } from '../voice/live';
import { call } from '../api';
import { Icon } from './bits';
import { t } from '../i18n';
export function LiveVoiceControls({
  taskId,
  available,
  onSettings,
  onBeforeStart,
  onActiveChange,
}: {
  taskId: string;
  available: boolean;
  onSettings?: () => void;
  onBeforeStart: () => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [state, setState] = useState<LiveState>({ phase: 'off' }),
    [muted, setMuted] = useState(false);
  const latest = useRef(onActiveChange);
  latest.current = onActiveChange;
  const session = useRef<LiveConversation | undefined>(undefined);
  useEffect(() => {
    const controller = new LiveConversation(
      {
        start: (id, taskId, sdp) =>
          call('voice:liveStart', { id, taskId, sdp }),
        end: (id) => call('voice:liveEnd', { id }),
        turn: (id, taskId, delegationId, utterance) =>
          call('voice:liveTurn', { id, taskId, delegationId, utterance }),
      },
      (s) => {
        setState(s);
        latest.current(!['off', 'error'].includes(s.phase));
      },
    );
    session.current = controller;
    setState({ phase: 'off' });
    setMuted(false);
    const stop = () => controller.end();
    window.addEventListener('amw:voice-stop', stop);
    return () => {
      window.removeEventListener('amw:voice-stop', stop);
      controller.dispose();
      if (session.current === controller) session.current = undefined;
      latest.current(false);
    };
  }, [taskId]);
  const active = !['off', 'error'].includes(state.phase);
  const start = async () => {
    if (!available) {
      onSettings?.();
      return;
    }
    const controller = session.current;
    onBeforeStart();
    setMuted(false);
    try {
      if (!(await call('voice:ensureMic', {}))) {
        if (session.current === controller)
          setState({
            phase: 'error',
            message: 'Allow microphone access in system settings.',
          });
        return;
      }
      if (session.current === controller) void controller?.start(taskId);
    } catch {
      if (session.current === controller)
        setState({
          phase: 'error',
          message: 'Could not open the microphone. Check system permissions.',
        });
    }
  };
  return (
    <span className="live-voice-controls" data-testid="live-voice-controls">
      <button
        className="icon-btn"
        title={t(
          active
            ? 'End voice chat'
            : available
              ? 'Start voice chat'
              : 'Set up voice chat',
        )}
        aria-label={t(active ? 'End voice chat' : 'Start voice chat')}
        aria-pressed={active}
        onClick={() => (active ? session.current?.end() : void start())}
        data-testid="voice-chat-toggle"
      >
        <Icon name={active ? 'x' : 'wave'} size={19} />
      </button>
      {active ? (
        <>
          <button
            className="icon-btn"
            aria-label={t(muted ? 'Unmute voice chat' : 'Mute voice chat')}
            aria-pressed={muted}
            disabled={state.phase !== 'live'}
            onClick={() => {
              const next = !muted;
              session.current?.mute(next);
              setMuted(next);
            }}
          >
            <Icon name="mic" size={16} />
          </button>
          <span className="live-voice-state" role="status">
            {t(
              state.phase === 'connecting'
                ? 'Connecting voice…'
                : state.phase === 'closing'
                  ? 'Ending voice…'
                  : muted
                    ? 'Voice muted'
                    : 'Voice chat · AI voice',
            )}
          </span>
        </>
      ) : null}
      {active && (state.heard || state.said) ? (
        <span className="live-voice-caption" role="status">
          {state.said || state.heard}
        </span>
      ) : null}
      {state.message ? (
        <span className="live-voice-caption error-text" role="alert">
          {t(state.message)}
        </span>
      ) : null}
    </span>
  );
}
