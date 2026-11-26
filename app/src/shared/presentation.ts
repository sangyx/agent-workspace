import type { TranscriptItem } from './types';
import {presentChatMessage} from '../../../packages/embedded-chat/src/chatPresentation';
import {importCandidateTitle,isApprovalReviewTitle} from '../../../packages/embedded-chat/src/chatImportPresentation';
export {isApprovalReviewTitle};
/** Display envelope only; the native transcript and provider history remain authoritative. */
export function presentTranscriptItem(item: TranscriptItem): TranscriptItem {
  if(item.role!=='user'||item.contextNotes?.length)return item;
  if(isApprovalReviewTitle(item.text)) return {...item,text:'',contextNotes:[{kind:'history',text:item.text}]};
  const shown=presentChatMessage({id:item.id,role:'user',text:item.text,at:item.createdAt});
  return shown.contextNotes?.length ? {...item,text:shown.text,contextNotes:shown.contextNotes} : item;
}
export function sessionTitle(title: string, fallback='Saved conversation') {
  const shown=presentChatMessage({id:'title',role:'user',text:title||'',at:''});
  return importCandidateTitle(shown.contextNotes?.length ? shown.text : title) || fallback;
}
