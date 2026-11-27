import { useState } from 'react';
import type { ImageRef, Task } from '../../shared/types';
import { call, errorText } from '../api';
import { t } from '../i18n';
import { Icon } from './bits';
import { Modal } from './Dialogs';

export function RewindButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return <button className="icon-btn message-rewind" title={t('Rewind to this message')} aria-label={t('Rewind to this message')} disabled={disabled} onClick={onClick}><Icon name="history" size={13} /></button>;
}

export function RewindDialog({ task, messageId, onClose, onRewound }: {
  task: Task; messageId: string; onClose: () => void;
  onRewound: (taskId: string, text: string, images: ImageRef[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rewind = async () => {
    setBusy(true); setError('');
    try {
      const result = await call('task:rewind', { taskId: task.taskId, messageId });
      onRewound(result.task.taskId, result.message.text, result.message.images ?? []);
      onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return <Modal title={t('Rewind to this message')} onClose={() => { if (!busy) onClose(); }}>
    <p>{t('Open a new chat with the earlier conversation and this message ready to edit. The original chat is kept. Later messages are excluded; files stay as they are.')}</p>
    {error ? <div className="error-text" role="alert">{error}</div> : null}
    <div className="modal-foot">
      <button className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => void rewind()} data-testid="rewind-confirm">{busy ? t('Rewinding…') : t('Rewind')}</button>
    </div>
  </Modal>;
}
