import { useState, useRef } from 'react';
import type { Settings } from '../../shared/types';
import { call } from '../api';
import { t } from '../i18n';
export function SpeechSettings({ settings }: { settings: Settings }) {
  const [vocabulary, setVocabulary] = useState(
      settings.recognition?.vocabulary ?? '',
    ),
    [error, setError] = useState('');
  const save = (
    patch: Pick<Partial<Settings>, 'recognition' | 'liveVoice'>,
  ) => {
    setError('');
    void call('settings:update', patch).catch(() =>
      setError(t('Could not save voice settings.')),
    );
  };
  const [recognition, setRecognition] = useState(
    settings.recognition ?? { language: 'auto' as const, vocabulary: '' },
  );
  const current = useRef(recognition);
  const [live, setLive] = useState(
    settings.liveVoice ?? {
      model: 'gpt-live-1.1' as const,
      voice: 'marin' as const,
    },
  );
  const editRecognition = (patch: Partial<typeof recognition>) => {
    current.current = { ...current.current, ...patch };
    setRecognition(current.current);
    save({ recognition: current.current });
  };
  const editLive = (patch: Partial<typeof live>) => {
    const next = { ...live, ...patch };
    setLive(next);
    save({ liveVoice: next });
  };
  return (
    <div className="speech-settings" data-testid="speech-settings">
      <h3>{t('Recognition accuracy')}</h3>
      <label>
        {t('Spoken language')}
        <select
          aria-label={t('Spoken language')}
          value={recognition.language}
          onChange={(e) =>
            editRecognition({
              language: e.target.value as typeof recognition.language,
            })
          }
        >
          <option value="auto">{t('Detect automatically')}</option>
          <option value="mixed">中文 + English</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        {t('Research vocabulary')}
        <textarea
          aria-label={t('Research vocabulary')}
          value={vocabulary}
          maxLength={4000}
          rows={3}
          placeholder="LoRA, ablation, Zotero, ECC-EMO"
          onChange={(e) => {
            setVocabulary(e.target.value);
            current.current = {
              ...current.current,
              vocabulary: e.target.value,
            };
          }}
          onBlur={() => editRecognition({ vocabulary })}
        />
      </label>
      <p className="muted small">
        {t(
          'Add names and technical terms, separated by commas or new lines. These are spelling hints, not words to insert. Project and conversation names are included automatically.',
        )}
      </p>
      <h3>{t('Voice chat')}</h3>
      <p className="muted small">
        {t(
          'GPT-Live handles listening, speech and interruptions. Your selected agent keeps its project context and performs the work. Audio and recent conversation context go to OpenAI; API voice usage is billed separately. Spoken replies are AI-generated. Review approvals on screen.',
        )}
      </p>
      <label>
        {t('Voice model')}
        <select
          aria-label={t('Voice model')}
          value={live.model}
          onChange={(e) =>
            editLive({ model: e.target.value as typeof live.model })
          }
        >
          <option value="gpt-live-1.1">GPT-Live 1.1</option>
          <option value="gpt-live-1">GPT-Live 1</option>
        </select>
      </label>
      <label>
        {t('Speaking voice')}
        <select
          aria-label={t('Speaking voice')}
          value={live.voice}
          onChange={(e) =>
            editLive({ voice: e.target.value as typeof live.voice })
          }
        >
          <option value="marin">Marin</option>
          <option value="quartz">Quartz</option>
          <option value="meridian">Meridian</option>
        </select>
      </label>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
