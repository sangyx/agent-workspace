import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Workspace } from '../../src/main/workspace';
import { activeChatCSS, chatAppearanceSchema, importChatStyle, maxChatStyleBytes } from '../../src/shared/chat-appearance';
import { ipcSchemas } from '../../src/shared/ipc';
it('owns and persists the selected interface and exact custom CSS independently of its host', async () => {
  const dataDir=mkdtempSync(join(tmpdir(),'amw-chat-appearance-'));
  const ws=new Workspace({dataDir,adapters:{}});
  const customStyle=importChatStyle('personal.CSS', ':root { --accent: #456 !important; }');
  const saved={interfaceStyle:'chatgpt' as const,customStyle};
  ws.updateSettings(ipcSchemas['settings:update'].parse({chatAppearance:saved})); await ws.shutdown();
  const reopened=new Workspace({dataDir,adapters:{}});
  try {
    expect(reopened.snapshot().settings.chatAppearance).toEqual(saved);
    expect(activeChatCSS(customStyle)).toBe(customStyle.css);
    reopened.updateSettings({chatAppearance:{...saved,customStyle:{...customStyle,enabled:false}}});
    expect(activeChatCSS(reopened.snapshot().settings.chatAppearance?.customStyle)).toBe('');
    reopened.updateSettings({chatAppearance:{interfaceStyle:'claude',customStyle:null}});
    expect(reopened.snapshot().settings.chatAppearance).toEqual({interfaceStyle:'claude',customStyle:null});
  } finally {await reopened.shutdown();}
});
it('rejects invalid style imports and preferences before replacing saved CSS', () => {
  expect(()=>importChatStyle('wrong.txt','body{}')).toThrow('.css');
  expect(()=>importChatStyle('empty.css','  ')).toThrow('empty');
  expect(()=>importChatStyle('binary.css','x\0')).toThrow();
  expect(()=>importChatStyle('huge.css','界'.repeat(maxChatStyleBytes/3+1))).toThrow();
  expect(chatAppearanceSchema.safeParse({interfaceStyle:'unknown'}).success).toBe(false);
  expect(ipcSchemas['settings:update'].safeParse({chatAppearance:{interfaceStyle:'claude',customStyle:{name:'invalid',css:'x'.repeat(maxChatStyleBytes+1),enabled:true}}}).success).toBe(false);
});
