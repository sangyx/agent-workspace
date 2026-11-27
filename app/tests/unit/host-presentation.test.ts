import {it,expect} from 'vitest';
import {presentTranscriptItem,sessionTitle,isApprovalReviewTitle} from '../../src/shared/presentation';
import {turnsOf,sessionMap} from '../../src/shared/session-map';
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
 expect(sessionMap([item],[],{turns:1,tasks:[{start:0,title:raw.slice(0,80)}]})[0].title).toBe(request);
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
it('uses readable question replies for native messages and task summaries while keeping raw history lossless',()=>{
 const raw='<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:'fixture',question:'May I restart it?',answer:'Keep it running.'}])+'\n</send_user_message_question_reply>';
 const item:any={id:'question-reply',taskId:'t1',role:'user',text:raw,createdAt:'now',delivery:'turn'};
 const shown=presentTranscriptItem(item);
 expect(shown.text).toBe('Keep it running.');expect(shown.questionReplies?.[0].question).toBe('May I restart it?');expect(shown.delivery).toBe('turn');
 expect(originalChatText({...shown,at:'now'} as any)).toBe(raw);expect(item.text).toBe(raw);
 expect(turnsOf([item])[0].user.text).toBe('Keep it running.');expect(sessionTitle(raw)).toBe('Keep it running.');
 expect(presentTranscriptItem(shown)).toBe(shown);
});
