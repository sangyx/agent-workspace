import { useState } from 'react';
import { t } from './i18n';
import type { TranscriptItem } from '../shared/types';

/** Human question/answer pairs, with the exact wire payload available on demand. */
export function QuestionReplyMessage({ replies, originalText }: { replies: NonNullable<TranscriptItem['questionReplies']>; originalText?: string }) {
  const [showOriginal, setShowOriginal] = useState(false);
  return <div className="question-reply-message" data-testid="question-reply-message">
    {replies.map((reply, index) => <div className="question-reply-entry" key={index}>
      {reply.question.trim() ? <>
        <div className="question-reply-label">{t('In reply to')}</div>
        <blockquote className="question-reply-question">{reply.question}</blockquote>
      </> : null}
      <div className="question-reply-answer">{reply.answer || t('No answer provided')}</div>
    </div>)}
    {originalText !== undefined ? <details className="question-reply-original" data-testid="question-reply-original" onToggle={e => setShowOriginal(e.currentTarget.open)}>
      <summary>{t('Original message')}</summary>
      {showOriginal ? <pre>{originalText}</pre> : null}
    </details> : null}
  </div>;
}
