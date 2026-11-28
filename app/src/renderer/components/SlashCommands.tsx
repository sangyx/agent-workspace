import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { SlashCommand } from '../../shared/types';
import { t } from '../i18n';
import './slash-commands.css';

/** Native CLI commands; choosing completes the draft, and only sending executes it. */
export function useSlashCommands(commands: SlashCommand[] | undefined, value: string, change: (text: string) => void, box: RefObject<HTMLTextAreaElement | null>, sideChat: boolean, recording: boolean) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const selected = useRef<HTMLLIElement>(null);
  const matches = useMemo(() => {
    const typed = /^\/(\S*)$/.exec(value);
    if (!typed) return [];
    const q = typed[1].toLowerCase();
    const choices = [...(commands ?? []).filter(c => c.name !== 'btw'), ...(sideChat ? [{ name: 'btw', description: t('Side question') }] : [])];
    return [...choices.filter(c => c.name.toLowerCase().startsWith(q)), ...choices.filter(c => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)))];
  }, [commands, value, sideChat]);
  const open = matches.length > 0 && dismissed !== value && !recording;
  const index = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => setActive(0), [value]);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const choose = (command: SlashCommand) => {
    change(`/${command.name} `);
    box.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((index + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault(); setDismissed(value); return true;
    }
    if (matches[index] && (e.key === 'Tab' || (e.key === 'Enter' && value !== `/${matches[index].name}`))) {
      e.preventDefault(); choose(matches[index]); return true;
    }
    return false;
  };
  return {
    onKeyDown,
    aria: { 'aria-autocomplete': 'list' as const, 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-activedescendant': open ? `${id}-${index}` : undefined },
    menu: open ? <ul className="native-command-menu" id={id} role="listbox" aria-label={t('Commands')} data-testid="composer-commands">
      {matches.map((command, i) => <li key={command.name} id={`${id}-${i}`} ref={i === index ? selected : undefined} role="option" aria-selected={i === index} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(command)}>
        <span>/{command.name}{command.hint ? <small> {command.hint}</small> : null}</span>
        {command.description ? <small>{command.description}</small> : null}
      </li>)}
    </ul> : null,
  };
}
