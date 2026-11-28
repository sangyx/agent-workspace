import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

for (const style of ['claude', 'chatgpt']) it(`completes reported commands without sending prematurely and retains agent chips in ${style}`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-slash-ui-')), at = new Date().toISOString();
  const task = (id: string, title: string) => ({ taskId: id, alias: id, name: id, nameSource: 'user', projectId: 'p', title, provider: 'mock', mockScript: 'quick', status: 'done', summary: '', cwd: home, createdAt: at, updatedAt: at });
  const tasks = [ { ...task('writer', 'Writer'), commands: [{ name: 'compact', description: 'Compact this conversation' }, { name: 'goal', description: 'Work toward a goal', hint: 'goal' }] }, task('plan', 'Plan') ];
  mkdirSync(join(home, 'transcripts'));
  writeFileSync(join(home, 'transcripts/writer.json'), JSON.stringify([{ id: 'u1', taskId: 'writer', role: 'user', text: 'Follow @plan for details.', createdAt: at }]));
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{ projectId: 'p', rootPath: home, name: 'Commands', kind: 'research' }], tasks, settings: { mainAgent: 'off', onboarding: { dismissed: true }, language: 'en', chatAppearance: { interfaceStyle: style } } }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_DATA_DIR: home, AMW_MAIN_AGENT: 'off', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1', AMW_MOCK_DELAY_MS: '5' } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    await page.locator('[data-testid="rail-item"][data-alias="writer"]').click();
    const box = page.getByTestId('composer-input'), menu = page.getByTestId('composer-commands');
    await box.fill('/');
    await expect.poll(() => menu.getByRole('option').count()).toBe(3);
    await menu.getByRole('option').filter({ hasText: '/goal' }).hover();
    expect(await menu.getByRole('option').filter({ hasText: '/goal' }).getAttribute('aria-selected')).toBe('true');
    await box.press('Tab'); await expect.poll(() => box.inputValue()).toBe('/goal ');
    expect(await page.locator('.msg.user').count()).toBe(1);
    await box.fill('/com'); await box.press('Enter');
    await expect.poll(() => box.inputValue()).toBe('/compact ');
    expect(await page.locator('.msg.user').count()).toBe(1);
    await box.fill('/'); await box.press('Escape'); await expect.poll(() => menu.count()).toBe(0);
    await box.fill('/com'); await expect.poll(() => menu.count()).toBe(1);
    await box.fill('/compact'); await box.press('Enter');
    await expect.poll(() => box.inputValue()).toBe('');
    await expect.poll(() => page.locator('.msg.user').count()).toBe(2);
    expect(await page.locator('.msg.user').last().innerText()).toContain('/compact');
    await page.locator('.msg.user [data-agent="plan"]').click();
    await expect.poll(() => page.locator('[data-testid="rail-item"][data-alias="plan"]').getAttribute('class')).toMatch(/active|selected|focused/);
  } finally { await app.close(); }
}, 60_000);
