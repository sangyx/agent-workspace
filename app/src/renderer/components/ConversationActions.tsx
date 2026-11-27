import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../../shared/types';
import { call, errorText } from '../api';
import { t } from '../i18n';
import { ConfirmDialog, Modal } from './Dialogs';
import { displayName } from './bits';

/** Shared by both interfaces: sidebar, Overview card and conversation header. */
export function useConversationActions() {
  const [removing, setRemoving] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const run = (operation: Promise<unknown>) => { void operation.catch(e => setError(errorText(e))); };
  return {
    archive: (task: Task) => run(call('task:archive', { taskId: task.taskId, on: !task.archivedAt })),
    remove: (task: Task) => setRemoving(task),
    element: createPortal(<>
      {removing ? <ConfirmDialog
        title={t('Delete {name}?', { name: displayName(removing) })}
        message={t('Stops this agent and removes its conversation from this workspace. Project files, worktrees and the original CLI history are kept. You can import the original session again with Continue a session.')}
        confirmLabel={t('Delete conversation')}
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => run(call('task:deleteConversation', { taskId: removing.taskId }))}
      /> : null}
      {error ? <Modal title={t('Conversation could not be updated')} onClose={() => setError('')}><p role="alert">{error}</p></Modal> : null}
    </>, document.body),
  };
}
