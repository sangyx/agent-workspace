import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

for (const style of ['claude', 'chatgpt']) it(`rewinds a sent message and wraps highlighted, plain and indented code in ${style}`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-rewind-ui-'));
  const at = new Date().toISOString();
  const code = `const explanation = "${'A long readable explanation '.repeat(24)}";\nconst token = "${'x'.repeat(420)}";\n`;
  const text = 'Earlier answer.\n\n```javascript\n' + code + '```\n\n```\n' + 'y'.repeat(380) + '\n```\n\n    ' + 'z'.repeat(380);
  const row = (id: string, role: string, text: string) => ({ id, role, text, taskId: 'source', createdAt: at });
  const original = JSON.stringify([row('u1', 'user', 'Earlier request'), row('a1', 'assistant', text), row('u2', 'user', 'Edit this earlier message'), row('a2', 'assistant', 'LATER REPLY MUST NOT FOLLOW')]);
  mkdirSync(join(home, 'transcripts')); const transcriptFile = join(home, 'transcripts/source.json'); writeFileSync(transcriptFile, original);
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{ projectId: 'p', rootPath: home, name: 'Rewind research', kind: 'research' }], tasks: [{ taskId: 'source', alias: 'rewind-source', name: 'Rewind source', nameSource: 'user', projectId: 'p', title: 'Rewind source', provider: 'mock', status: 'done', summary: '', cwd: home, createdAt: at, updatedAt: at }], settings: { mainAgent: 'off', onboarding: { dismissed: true }, language: 'en', chatAppearance: { interfaceStyle: style } } }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, AMW_DATA_DIR: home, AMW_MAIN_AGENT: 'off', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1' } });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app'); await page.setViewportSize({ width: 1180, height: 800 });
    await page.locator('[data-testid="rail-item"][data-alias="rewind-source"]').click();
    const blocks = page.locator('.msg.assistant .md-code pre');
    await expect.poll(() => blocks.count()).toBe(3);
    for (const pre of await blocks.all()) {
      const layout = await pre.evaluate(el => ({ whiteSpace: getComputedStyle(el).whiteSpace, width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, lines: parseFloat(getComputedStyle(el).lineHeight) }));
      expect(layout.whiteSpace).toBe('pre-wrap'); expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1); expect(layout.height).toBeGreaterThan(layout.lines * 2);
    }
    expect(await blocks.first().textContent()).toBe(code);
    await page.locator('.md-code').first().getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.locator('.md-code').first().getByRole('button').innerText()).toContain('Copied');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code);
    // Check both entry points: message action, then the context menu.
    const selected = page.locator('[data-item-id="u2"]');
    await selected.hover();
    await selected.getByRole('button', { name: 'Rewind to this message', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await selected.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Rewind to this message', exact: true }).click();
    await page.getByTestId('rewind-confirm').click();
    await expect.poll(() => page.getByTestId('composer-input').inputValue()).toBe('Edit this earlier message');
    expect(await page.getByTestId('transcript').innerText()).toContain('Earlier request');
    expect(await page.getByTestId('transcript').innerText()).not.toContain('LATER REPLY MUST NOT FOLLOW');
    expect(await page.getByTestId('transcript').locator('.msg.user').count()).toBe(1);
    await expect.poll(async () => JSON.parse(readFileSync(join(home, 'workspace.json'), 'utf8')).tasks.length).toBe(2);
    const branch = JSON.parse(readFileSync(join(home, 'workspace.json'), 'utf8')).tasks.find((task: any) => task.taskId !== 'source');
    expect(branch.projectId).toBe('p'); expect(branch.status).toBe('idle'); expect(branch.sessionLocalId).toBeUndefined();
    expect(readFileSync(transcriptFile, 'utf8')).toBe(original);
    await page.screenshot({ path: join(home, `rewind-${style}.png`) });
    await page.locator('[data-testid="rail-item"][data-alias="rewind-source"]').click();
    expect(await page.getByTestId('transcript').innerText()).toContain('LATER REPLY MUST NOT FOLLOW');
  } finally { await app.close(); }
}, 60_000);
