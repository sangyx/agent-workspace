import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

for (const style of ['claude', 'chatgpt']) it(`offers project-scoped new/import actions from button and context menus in ${style}`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-project-menu-'));
  const old = new Date(Date.now() - 86400_000).toISOString(), recent = new Date().toISOString();
  const projects = [{ projectId: 'research', rootPath: join(home, 'research'), name: 'Research target', kind: 'research' }, { projectId: 'other', rootPath: join(home, 'other'), name: 'Other target', kind: 'chat' }];
  projects.forEach(p => mkdirSync(p.rootPath));
  const tasks = projects.map((p, n) => ({ taskId: `task-${p.projectId}`, alias: p.projectId, name: p.name, nameSource: 'user', projectId: p.projectId, title: p.name, provider: 'mock', status: 'done', summary: '', cwd: p.rootPath, createdAt: n ? recent : old, updatedAt: n ? recent : old }));
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects, tasks, sessions: [], settings: { mainAgent: 'off', language: 'en', idleAfterDays: 0, onboarding: { dismissed: true }, chatAppearance: { interfaceStyle: style } } }));
  const fixture = join(home, 'sessions.json');
  writeFileSync(fixture, JSON.stringify([{ provider: 'codex', nativeSessionId: 'project-menu-synthetic-history', cwd: projects[1].rootPath, title: 'Saved synthetic conversation', updatedAt: old }]));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_DATA_DIR: home, AMW_MAIN_AGENT: 'off', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1', AMW_DISCOVER_FIXTURE: fixture } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    for (const p of projects) for (const via of ['button', 'context', 'options-context']) {
      const team = page.locator('.team').filter({ has: page.getByTestId('team-head').filter({ hasText: p.name }) });
      const head = team.getByTestId('team-head'), expanded = await head.getAttribute('aria-expanded');
      const open = async () => via === 'button' ? team.getByTestId('project-options').click() : via === 'context' ? head.click({ button: 'right' }) : team.getByTestId('project-options').click({ button: 'right' });
      await open();
      await page.getByRole('menuitem', { name: 'Rename project…', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: 'New chat', exact: true }).click();
      await expect.poll(() => page.getByTestId('project-current').innerText()).toContain(p.name);
      // Switching from new to import retains the chosen target.
      await page.getByTestId('new-continue-session').click();
      await expect.poll(() => page.getByTestId('session-project').inputValue()).toBe(p.projectId);
      await page.keyboard.press('Escape');
      await open(); await page.getByRole('menuitem', { name: 'Import conversation…', exact: true }).click();
      await expect.poll(() => page.getByTestId('session-project').inputValue()).toBe(p.projectId);
      await page.getByTestId('session-row').filter({ hasText: 'Saved synthetic conversation' }).waitFor();
      await page.keyboard.press('Escape');
      expect(await head.getAttribute('aria-expanded')).toBe(expanded);
    }
    // Create without sending a prompt: the new chat belongs to the menu's target, not the last-used project.
    const research = page.locator('.team[data-project="Research target"]');
    await research.getByTestId('project-options').click(); await page.getByRole('menuitem', { name: 'New chat', exact: true }).click();
    await page.getByTestId('create-agent').click();
    const snapshot = () => page.evaluate(() => (window as any).amw.invoke('workspace:snapshot', {})) as Promise<any>;
    await expect.poll(async () => (await snapshot()).tasks.length).toBe(3);
    const fresh = (await snapshot()).tasks.find((task: any) => !task.taskId.startsWith('task-'));
    expect(fresh.projectId).toBe('research'); expect(fresh.status).toBe('idle'); expect(fresh.sessionLocalId).toBeUndefined();
    // Adopt a synthetic saved session into the target project while retaining its original folder.
    await research.getByTestId('project-options').click(); await page.getByRole('menuitem', { name: 'Import conversation…', exact: true }).click();
    await page.getByTestId('session-row').filter({ hasText: 'Saved synthetic conversation' }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(async () => (await snapshot()).tasks.length).toBe(4);
    const adopted = (await snapshot()).tasks.find((task: any) => task.title === 'Saved synthetic conversation');
    expect(adopted.projectId).toBe('research'); expect(adopted.cwd).toBe(projects[1].rootPath);
    // Global import stays unscoped; a React click event must not become a project ID.
    await page.getByTestId('resume-session').click();
    await expect.poll(() => page.getByTestId('session-project').inputValue()).toBe('');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(home, `project-menu-${style}.png`) });
  } finally { await app.close(); }
}, 60_000);
