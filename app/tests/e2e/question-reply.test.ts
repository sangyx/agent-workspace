import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

it('renders saved question replies readably and keeps transport data collapsed and unchanged', async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-question-reply-'));
  const at = new Date().toISOString();
  const entries = [{ questionItemId: 'synthetic-request-1', question: 'May I restart the scheduler?', answer: 'Keep it running; prepare the change only.' }, { questionItemId: 'synthetic-request-2', question: 'What text should stay literal?', answer: '<script>example</script>\n第二行' }];
  const wire = '<send_user_message_question_reply>\n'+JSON.stringify(entries)+'\n</send_user_message_question_reply>';
  mkdirSync(join(home, 'transcripts'));
  const file = join(home, 'transcripts/t-reply.json');
  const original = JSON.stringify([{ id: 'reply', taskId: 't-reply', role: 'user', text: wire, createdAt: at }]);
  writeFileSync(file, original);
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{ projectId: 'p1', rootPath: home, name: 'Reply fixture' }], tasks: [{ taskId: 't-reply', alias: 'reply', name: 'Reply fixture', nameSource: 'user', projectId: 'p1', title: 'Question reply', provider: 'mock', status: 'done', summary: '', cwd: home, createdAt: at, updatedAt: at }], settings: { onboarding: { dismissed: true }, mainAgent: 'off', language: 'en' } }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_MAIN_AGENT: 'off', AMW_DATA_DIR: home, AMW_MOCK_DELAY_MS: '5', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1' } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    await page.locator('[data-testid="rail-item"][data-alias="reply"]').click();
    const reply = page.getByTestId('question-reply-message');
    await reply.waitFor();
    expect(await reply.locator('.question-reply-entry').count()).toBe(2);
    expect(await reply.locator('.question-reply-question').first().innerText()).toBe(entries[0].question);
    expect(await reply.locator('.question-reply-answer').first().innerText()).toBe(entries[0].answer);
    expect(await reply.locator('.question-reply-answer').last().textContent()).toBe(entries[1].answer);
    expect(await reply.innerText()).not.toContain('questionItemId');
    expect(await reply.innerText()).not.toContain('send_user_message_question_reply');
    expect(await reply.locator('script').count()).toBe(0);
    expect(await reply.locator('pre').count()).toBe(0);
    await reply.locator('summary').click();
    await expect.poll(() => reply.locator('pre').textContent()).toBe(wire);
    expect(readFileSync(file, 'utf8')).toBe(original);
  } finally { await app.close(); }
}, 60_000);
