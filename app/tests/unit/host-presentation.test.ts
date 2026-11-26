import {it,expect} from 'vitest';
import {presentTranscriptItem,sessionTitle,isApprovalReviewTitle} from '../../src/shared/presentation';
import {turnsOf} from '../../src/shared/session-map';
import {attachChatHistory,originalChatText} from '../../../packages/embedded-chat/src/chatPresentation';
it('folds nested continuation and large memory envelopes without changing native text or IDs',()=>{
 const request='What should we run next?';
 const history=attachChatHistory('assistant: earlier evidence',request);
 const raw='## Workspace memory update (provided by Agent Workspace)\nThe user changed their saved notes since this session began. Follow them from now on; no need to reply to this part.\n- [project convention, updated] '+JSON.stringify({nodes:['long internal context'.repeat(5000)]})+'\n\n'+history;
 const item:any={id:'u1',taskId:'t1',role:'user',text:raw,createdAt:'now'};
 const shown=presentTranscriptItem(item);
 expect(shown.text).toBe(request);expect(shown.id).toBe('u1');expect(shown.contextNotes).toHaveLength(2);
 expect(originalChatText({...shown,at:'now'} as any)).toBe(raw);expect(item.text).toBe(raw);
 expect(presentTranscriptItem(shown)).toBe(shown);expect(turnsOf([item])[0].user.text).toBe(request);
 expect(sessionTitle(raw)).toBe(request);
});
it('keeps legitimate user code and quoted memory text visible and bounds import labels',()=>{
 const code='Explain this JSON: '+JSON.stringify({nodes:['value'.repeat(400)]});
 const item:any={id:'code',role:'user',text:code,createdAt:'now'};
 expect(presentTranscriptItem(item)).toBe(item);
 expect(sessionTitle(code).length).toBeLessThanOrEqual(180);
 const review='The following is the Codex agent history whose request action you are assessing. '+ 'internal review'.repeat(5000);
 expect(isApprovalReviewTitle(review)).toBe(true);expect(sessionTitle(review)).toBe('Codex approval review');
 const folded=presentTranscriptItem({...item,text:review});expect(folded.text).toBe('');expect(folded.contextNotes?.[0].text).toBe(review);
 expect(sessionTitle('中文\nTitle')).toBe('中文 Title');
});
