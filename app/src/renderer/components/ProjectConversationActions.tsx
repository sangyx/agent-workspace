import { Icon } from './bits';
import { t } from '../i18n';
import { useContextMenu } from './ContextMenu';

/** Conversation actions belong beside the project list, rather than in a second navigation block. */
export function ProjectConversationActions({ onNewChat, onContinue, onAddFolder, addingFolder }: {
  onNewChat: () => void;
  onContinue: () => void;
  onAddFolder?: () => void;
  addingFolder?: boolean;
}) {
  const menu = useContextMenu();
  return <>
    <span className="sidebar-section-actions project-conversation-actions">
      <button type="button" className="icon-btn" aria-label={t('New chat')} title={t('New chat')} onClick={onNewChat} data-testid="sidebar-new-task"><Icon name="plus" /></button>
      <button type="button" className="icon-btn" aria-label={t('Continue a session…')} title={t('Continue a session…')} onClick={onContinue} data-testid="resume-session"><Icon name="history" /></button>
      {onAddFolder ? <button type="button" className="icon-btn" aria-label={t('Project list options')} title={t('Project list options')} data-testid="project-list-options" onClick={(e) => {
        const bounds = e.currentTarget.getBoundingClientRect();
        menu.open({ x: bounds.left, y: bounds.bottom, keyboard: e.detail === 0, items: [{ id: 'add-project-folder', label: t('Add existing folder as project…'), icon: 'folder', disabled: addingFolder, onSelect: onAddFolder }] });
      }}><span aria-hidden>⋯</span></button> : null}
    </span>
    {menu.element}
  </>;
}
