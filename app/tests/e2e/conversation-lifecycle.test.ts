import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { expect, it } from 'vitest';

it('archives, restores and confirms deletion from conversation context menus, preserving files and project grouping', async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-conversation-menu-'));
  const at = new Date().toISOString();
  const task = (taskId: string, projectId: string) => ({ taskId, alias: taskId, name: taskId, nameSource: 'user', projectId, title: taskId, provider: 'mock', status: 'done', summary: '', cwd: home, createdAt: at, updatedAt: at });
  mkdirSync(join(home, 'transcripts')); writeFileSync(join(home, 'keep.tex'), 'Keep project files.');
  const transcript = JSON.stringify([{ id: 'saved', taskId: 'research-chat', role: 'user', text: 'Saved research history', createdAt: at }]);
  writeFileSync(join(home, 'transcripts/research-chat.json'), transcript);
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{ projectId: 'research', rootPath: home, name: 'Research project', kind: 'research' }, { projectId: 'other', rootPath: home, name: 'Other project', kind: 'chat' }], tasks: [task('research-chat', 'research'), task('other-chat', 'other')], settings: { onboarding: { dismissed: true }, mainAgent: 'off', language: 'en', idleAfterDays: 0 } }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication;
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_MAIN_AGENT: 'off', AMW_DATA_DIR: home, AMW_MOCK_DELAY_MS: '5', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1' } });
    const page = await app.firstWindow(); await page.waitForSelector('.app'); return page;
  };
  const row = (page: Page, id: string) => page.locator(`[data-testid="rail-item"][data-alias="${id}"]`);
  let page = await launch();
  try {
    await row(page, 'research-chat').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archive conversation', exact: true }).click();
    await expect.poll(() => row(page, 'research-chat').count()).toBe(0);
    await page.getByTestId('archived-conversations-toggle').click();
    const archive = page.getByTestId('archived-conversations');
    await archive.getByText('Research project', { exact: true }).waitFor();
    await row(page, 'research-chat').click();
    const title = page.getByTestId('focus-title');
    await title.waitFor();
    await expect.poll(() => page.locator('.msg.user').innerText()).toContain('Saved research history');
    // Viewing history keeps the conversation in the explicit archive.
    await expect.poll(() => archive.locator('[data-alias="research-chat"]').count()).toBe(1);
    await app!.close(); page = await launch();
    await page.getByTestId('archived-conversations').waitFor();
    await row(page, 'research-chat').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unarchive conversation', exact: true }).click();
    await expect.poll(() => page.getByTestId('archived-conversations').count()).toBe(0);
    await row(page, 'research-chat').click();
    await page.getByTestId('focus-title').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete conversation…', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId('confirm-cancel').click();
    expect(await row(page, 'research-chat').count()).toBe(1);
    await row(page, 'research-chat').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete conversation…', exact: true }).click();
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => row(page, 'research-chat').count()).toBe(0);
    expect(await row(page, 'other-chat').count()).toBe(1);
    expect(readFileSync(join(home, 'keep.tex'), 'utf8')).toBe('Keep project files.');
    expect(readFileSync(join(home, 'transcripts/research-chat.json'), 'utf8')).toBe(transcript);
    await app!.close(); page = await launch();
    expect(await row(page, 'research-chat').count()).toBe(0);
    expect(await row(page, 'other-chat').count()).toBe(1);
  } finally { await app!.close(); }
}, 90_000);
