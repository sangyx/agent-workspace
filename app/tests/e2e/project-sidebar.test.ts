import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

it('keeps conversation icons beside Projects and sorts expanded project conversations by update', async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-project-sidebar-'));
  const iso = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const task = (taskId: string, hours: number, extra = {}) => ({ taskId, alias: taskId, name: taskId, nameSource: 'user', projectId: 'p1', title: taskId, provider: 'mock', status: 'idle', summary: '', cwd: home, createdAt: iso(48), updatedAt: iso(hours), ...extra });
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{ projectId: 'p1', rootPath: home, name: 'Research folder', kind: 'research' }], tasks: [task('older', 4), task('newest', 0), task('middle', 2), task('aside-recent', 1, { setAside: true })], settings: { onboarding: { dismissed: true }, mainAgent: 'off', idleAfterDays: 0 } }));
  const fixture = join(home, 'sessions.json'); writeFileSync(fixture, '[]');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_MAIN_AGENT: 'off', AMW_DATA_DIR: home, AMW_MOCK_DELAY_MS: '5', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1', AMW_DISCOVER_FIXTURE: fixture } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    const header = page.locator('.sidebar-section').filter({ has: page.getByTestId('sidebar-new-task') });
    expect((await header.innerText()).toLowerCase()).toContain('projects');
    expect(await header.getByTestId('resume-session').count()).toBe(1);
    expect(await page.locator('.sidebar-tools').count()).toBe(0);
    expect(await page.getByTestId('add-project').count()).toBe(0);
    await header.getByTestId('sidebar-new-task').click();
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    await header.getByTestId('resume-session').click();
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    const team = page.getByTestId('team').filter({ has: page.getByTestId('team-head').filter({ hasText: 'Research folder' }) });
    if (await team.getByTestId('team-head').getAttribute('aria-expanded') !== 'true') await team.getByTestId('team-head').click();
    const ids = () => team.getByTestId('rail-item').evaluateAll(rows => rows.map(row => row.getAttribute('data-alias')));
    await expect.poll(ids).toEqual(['newest', 'middle', 'older']);
    await team.getByTestId('team-idle').click();
    await expect.poll(ids).toEqual(['newest', 'aside-recent', 'middle', 'older']);
    const more = page.getByTestId('project-list-options');
    if (await more.count()) {
      await more.click(); await page.getByRole('menuitem', { name: 'Add existing folder as project…' }).waitFor();
      await page.keyboard.press('Escape');
    }
  } finally { await app.close(); }
}, 60_000);
