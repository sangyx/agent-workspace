export interface QuestionReply {
  question: string;
  answer: string;
}

/** Recognize only a complete, standalone transport envelope; quoted code stays user text. */
export function questionReplies(text: string): QuestionReply[] | undefined {
  if (text.length > 262_144) return;
  const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if (!match) return;
  try {
    const entries: unknown = JSON.parse(match[1]);
    if (!Array.isArray(entries) || !entries.length || entries.length > 50) return;
    if (!entries.every(entry => entry && !Array.isArray(entry) && typeof entry === 'object' && typeof entry.question === 'string' && typeof entry.answer === 'string')) return;
    return entries.map(entry => ({ question: entry.question, answer: entry.answer }));
  } catch {
    return;
  }
}
