import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';
for (const style of ['claude','chatgpt']) it(`groups Usage by provider in ${style} and keeps Antigravity visible without fabricated quota`, async () => {
 const home=mkdtempSync(join(tmpdir(),'amw-provider-usage-'));
 const at=new Date().toISOString();
 const usage={input:100,cacheRead:20,cacheWrite:10,output:30,reasoning:10,updatedAt:at};
 writeFileSync(join(home,'workspace.json'),JSON.stringify({projects:[],tasks:[{taskId:'ag',alias:'AG',name:'AG',provider:'antigravity',title:'AG',status:'done',cwd:home,usage,createdAt:at,updatedAt:at}],sessions:[],settings:{mainAgent:'off',onboarding:{dismissed:true},language:'en',chatAppearance:{interfaceStyle:style}},limits:{codex:{provider:'codex',at:'2026-11-26T10:00:00Z',windows:[{key:'primary',mins:300,usedPercent:10}]},'codex@UT':{provider:'codex',host:'UT',at,windows:[{key:'primary',mins:300,usedPercent:40}]},claude:{provider:'claude',at,windows:[{key:'five_hour',mins:300,usedPercent:20}]}}}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron') as string,args:[resolve(__dirname,'../..')],env:{...env,AMW_DATA_DIR:home,AMW_MAIN_AGENT:'off',AMW_NO_OPENAI:'1',AMW_NO_AUTOLISTEN:'1'}});
 try {
  const page=await app.firstWindow();
  await page.addInitScript(() => {
   (window as any).amwHost={onCommand:(cb:any)=>{(window as any).__usageHostReady=true;const listener=(e:any)=>cb(e.detail);window.addEventListener('test-host-command',listener);return()=>window.removeEventListener('test-host-command',listener);},notify:()=>{}};
  });
  await page.reload();await page.waitForSelector('.app');await page.waitForFunction(()=>(window as any).__usageHostReady);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('test-host-command',{detail:{action:'usage'}})));
  const panel=page.locator('.host-usage');await panel.waitFor();
  expect(await panel.getByTestId('provider-usage-list').locator(':scope > section').count()).toBe(3);
  expect(await panel.getByTestId('provider-usage-codex').innerText()).toContain('40% used');
  expect(await panel.getByTestId('provider-usage-codex').innerText()).not.toContain('10% used');
  expect(await panel.getByTestId('provider-usage-antigravity').innerText()).toContain('160 tokens tracked');
  expect(await panel.getByTestId('provider-usage-antigravity').innerText()).toContain('Account quota not reported');
  expect(await panel.innerText()).not.toMatch(/\bLocal\b|\bUT\b|this Mac|(?:^|\s)0% used/);
  await page.screenshot({path:join(home,`provider-usage-${style}.png`)});
  await panel.getByRole('button',{name:'Close usage'}).click();await expect.poll(()=>panel.count()).toBe(0);
 } finally {await app.close();}
},60000);
