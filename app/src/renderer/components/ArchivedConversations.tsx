import { useState, type ReactNode } from 'react';
import type { Project, Task } from '../../shared/types';
import { recentConversations } from '../../shared/agent-order';
import { t } from '../i18n';
import { Icon } from './bits';

/** An explicit archive, separate from projects that became idle automatically. */
export function ArchivedConversations({ tasks, projects, renderRow }: { tasks: Task[]; projects: Project[]; renderRow: (task: Task) => ReactNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem('amw.archivedConversationsOpen') === '1');
  const archived = recentConversations(tasks.filter(task => task.archivedAt));
  if (!archived.length) return null;
  const projectIds = [...new Set(archived.map(task => task.projectId))];
  return <section className="team-archive" data-testid="archived-conversations">
    <button className="team-head team-archive-head" aria-expanded={open} onClick={() => {
      localStorage.setItem('amw.archivedConversationsOpen', open ? '0' : '1');
      setOpen(!open);
    }} data-testid="archived-conversations-toggle">
      <Icon name="archive" size={15} />
      <span className="team-name truncate">{t('Archived conversations')}</span>
      <span className="team-count idle">{archived.length}</span>
    </button>
    {open ? projectIds.map(id => <div className="team archived open" key={id}>
      <div className="team-head archived-head"><span className="team-name truncate">{projects.find(project => project.projectId === id)?.name ?? t('Other chats')}</span></div>
      {archived.filter(task => task.projectId === id).map(renderRow)}
    </div>) : null}
  </section>;
}
