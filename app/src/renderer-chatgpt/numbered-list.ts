/** Continue an ordered list when the caret is at the end of a numbered item. */
export function nextListItem(text: string, caret: number): string | null {
  if (caret < text.length && text[caret] !== '\n') return null;
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const match = /^([\t ]*)(\d{1,9})([.)])(?:[\t ].*)?$/.exec(line);
  if (!match) return null;
  const [, indent, number, delimiter] = match;
  const next = Number(number) + 1;
  return next <= 999_999_999 ? `\n${indent}${String(next).padStart(number.length, '0')}${delimiter} ` : null;
}
