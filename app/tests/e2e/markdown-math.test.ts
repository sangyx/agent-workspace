import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';

it('renders saved equations offline with local fonts, readable code and contained wide displays', async () => {
  const home = mkdtempSync(join(tmpdir(), 'amw-math-preview-'));
  const at = new Date().toISOString();
  const text = String.raw`The estimator uses $x_i^2$ and \(\alpha + \beta\), with an aligned objective:
\[
\begin{aligned}
\mathcal{L}(\theta) &= \frac{1}{n}\sum_{i=1}^{n}(y_i - f_\theta(x_i))^2 \\
\theta^* &= \operatorname*{arg\,min}_{\theta}\mathcal{L}(\theta)
\end{aligned}
\]

$$
A=\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
$$

$$E=mc^2$$

Wide equation:
\[${Array.from({length: 32}, (_, i) => `x_{${i}}`).join(' + ')} = 0\]

Code stays literal: \`$x$ and \(x\)\`.

\`\`\`tex
\[x^2\]
\`\`\`

Malformed TeX stays readable: $\frac{1}{$`.replaceAll('\\`', '`');
  const transcript = JSON.stringify([{ id: 'saved', taskId: 't-math', role: 'assistant', text, createdAt: at }]);
  mkdirSync(join(home, 'transcripts')); const file = join(home, 'transcripts/t-math.json'); writeFileSync(file, transcript);
  writeFileSync(join(home, 'workspace.json'), JSON.stringify({ projects: [{projectId:'math-project', rootPath:home, name:'Math preview', kind:'research'}], tasks:[{taskId:'t-math',alias:'Math preview',name:'Math preview',nameSource:'user',projectId:'math-project',title:'Math preview',provider:'mock',status:'done',summary:'',cwd:home,createdAt:at,updatedAt:at}],settings:{onboarding:{dismissed:true},mainAgent:'off',language:'en'} }));
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({executablePath:require('electron') as string,args:[resolve(__dirname,'../..')],env:{...env,HOME:home,AMW_MAIN_AGENT:'off',AMW_DATA_DIR:home,AMW_NO_OPENAI:'1',AMW_NO_AUTOLISTEN:'1',AMW_MOCK_DELAY_MS:'5'}});
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.app');
    await page.locator('[data-testid="rail-item"][data-alias="Math preview"]').click();
    const message = page.locator('.msg.assistant');
    await expect.poll(() => message.locator('.katex').count()).toBe(6);
    expect(await message.locator('.katex-display').count()).toBe(4);
    expect(await message.locator('.katex-error').count()).toBe(1);
    expect(await message.locator('.md-code').innerText()).toContain('\\[x^2\\]');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true);
    const overflows = await message.locator('.katex-display').evaluateAll(elements => elements.map(el => ({wide:el.scrollWidth > el.clientWidth,overflow:getComputedStyle(el).overflowX})));
    expect(overflows.some(item => item.wide && item.overflow === 'auto')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(readFileSync(file,'utf8')).toBe(transcript);
    const shots = resolve(__dirname,'../../test-results'); mkdirSync(shots,{recursive:true});
    await page.screenshot({path:join(shots,`math-${process.env.AMW_TEST_STYLE || 'claude'}.png`)});
  } finally { await app.close(); }
},60_000);
