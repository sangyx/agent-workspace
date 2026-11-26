import {useState} from 'react';
import {t} from './i18n';
import type {TranscriptItem} from '../shared/types';
export function ContextNotes({notes}:{notes:NonNullable<TranscriptItem['contextNotes']>}){
 const [open,setOpen]=useState(false);
 return <details className="context-notes" onToggle={e=>setOpen(e.currentTarget.open)} data-testid="context-notes" style={{fontSize:12,margin:'4px 0',color:'var(--muted)'}}>
  <summary>{t('Attached context')} · {notes.length}</summary>
  {open?<pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{notes.map(n=>n.text).join('')}</pre>:null}
 </details>;
}
