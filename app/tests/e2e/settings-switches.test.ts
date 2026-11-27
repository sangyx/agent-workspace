// Run against either renderer: the shared settings switches keep their behavior and usable bounds.
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

it('saves an on/off setting through a visible, styled switch', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'amw-switch-')));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = await electron.launch({ executablePath: require('electron') as string, args: [resolve(__dirname, '../..')], env: { ...env, HOME: home, AMW_DATA_DIR: join(home, 'data'), AMW_MAIN_AGENT: 'off', AMW_MOCK_DELAY_MS: '5', AMW_NO_OPENAI: '1', AMW_NO_AUTOLISTEN: '1' } });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForSelector('.app');
    await page.evaluate(() => (window as any).amw.invoke('settings:update', { onboarding: { dismissed: true }, keepAwake: true }));
    await page.getByTestId('open-settings').click();
    const toggle = page.getByTestId('keep-awake');
    await expect.poll(() => toggle.getAttribute('role')).toBe('switch');
    await expect.poll(() => toggle.isChecked()).toBe(true);
    await toggle.click();
    await expect.poll(() => page.evaluate(async () => (await (window as any).amw.invoke('workspace:snapshot', {})).settings.keepAwake)).toBe(false);
    const box = await toggle.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(30);
    expect(box!.height).toBeGreaterThanOrEqual(18);
    expect(await toggle.evaluate((e) => getComputedStyle(e).appearance)).toBe('none');
    await toggle.click();
    await expect.poll(() => toggle.isChecked()).toBe(true);
  } finally {
    await app.close();
  }
}, 60_000);
