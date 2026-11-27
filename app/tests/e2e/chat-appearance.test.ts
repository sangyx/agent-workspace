import { mkdtempSync, writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect,it } from 'vitest';
it('switches both native styles within Workspace settings and keeps custom CSS out of recovery controls', async()=>{
 const home=mkdtempSync(join(tmpdir(),'amw-appearance-settings-')),at=new Date().toISOString();
 writeFileSync(join(home,'workspace.json'),JSON.stringify({projects:[{projectId:'p',rootPath:home,name:'Research',kind:'research'}],tasks:[{taskId:'t',alias:'Saved chat',name:'Saved chat',nameSource:'user',projectId:'p',provider:'mock',cwd:home,title:'Saved chat',status:'done',summary:'',createdAt:at,updatedAt:at}],settings:{mainAgent:'off',onboarding:{dismissed:true},language:'en',chatAppearance:{interfaceStyle:'claude'}}}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron') as string,args:[resolve(__dirname,'../..')],env:{...env,HOME:home,AMW_DATA_DIR:home,AMW_MAIN_AGENT:'off',AMW_NO_OPENAI:'1',AMW_NO_AUTOLISTEN:'1'}});
 try {
  const page=await app.firstWindow();await page.waitForSelector('.app');
  await page.locator('[data-testid="rail-item"][data-alias="Saved chat"]').click();
  await page.getByTestId('open-settings').click();await page.getByTestId('chat-interface').waitFor();
  await page.getByTestId('chat-interface').selectOption('chatgpt');
  await expect.poll(()=>page.locator('html').getAttribute('data-chat-interface')).toBe('chatgpt');
  await page.getByTestId('chat-interface').waitFor();
  await page.getByTestId('chat-style-file').setInputFiles({name:'custom.css',mimeType:'text/css',buffer:Buffer.from('body { --acceptance-style: loaded; }')});
  await page.getByText('custom.css',{exact:true}).waitFor();
  expect(await page.locator('#amw-chat-custom-style').getAttribute('media')).toBe('not all');
  await page.getByLabel('Enable custom style',{exact:true}).uncheck();
  await expect.poll(()=>page.locator('#amw-chat-custom-style').textContent()).toBe('');
  await page.getByLabel('Enable custom style',{exact:true}).check();
  await expect.poll(()=>page.locator('#amw-chat-custom-style').textContent()).toContain('--acceptance-style');
  await page.getByTestId('chat-interface').selectOption('claude');
  await expect.poll(()=>page.locator('html').getAttribute('data-chat-interface')).toBe('claude');
  await page.getByTestId('chat-interface').waitFor();await page.getByText('custom.css',{exact:true}).waitFor();
  await page.locator('#settings-appearance').getByRole('button',{name:'Remove',exact:true}).click();
  await expect.poll(()=>page.locator('#amw-chat-custom-style').textContent()).toBe('');
  await page.getByTestId('settings-page').locator('.stage-head').getByRole('button',{name:'Close',exact:true}).click();await page.getByTestId('focus-title').waitFor();
  expect(await page.getByTestId('focus-title').innerText()).toContain('Saved chat');
 }finally{await app.close();}
},60000);
