import { expect, it } from 'vitest';
import { limitsByProvider, providerUsage } from '../../src/shared/provider-usage';
import type { ProviderLimits, WorkspaceSnapshot } from '../../src/shared/types';
const reading = (provider: 'claude'|'codex'|'antigravity', host: string|undefined, at: string, usedPercent:number):ProviderLimits => ({provider,host,at,windows:[{key:'primary',mins:300,usedPercent}]});
it('shows one quota reading per provider without summing repeated account snapshots or mutating host records', () => {
 const limits={codex:reading('codex',undefined,'2026-11-27T10:00:00Z',30),'codex@UT':reading('codex','UT','2026-11-27T11:00:00Z',40),claude:reading('claude',undefined,'2026-11-27T11:00:00Z',20)};
 const original=JSON.stringify(limits); const grouped=limitsByProvider(limits);
 expect(Object.keys(grouped)).toEqual(['codex','claude']);
 expect(grouped.codex.windows[0].usedPercent).toBe(40);
 expect(grouped.codex.host).toBeUndefined();expect(JSON.stringify(limits)).toBe(original);
});
it('recognizes old provider@host records and ignores invalid providers and empty windows', () => {
 const limits={'antigravity@UT':{at:'2026-11-27',windows:[{key:'primary',mins:300,usedPercent:80}]},ignored:{at:'today',windows:[]}};
 expect(limitsByProvider(limits).antigravity).toMatchObject({provider:'antigravity',windows:[{usedPercent:80}]});
 expect(limitsByProvider(limits).ignored).toBeUndefined();
});
it('always includes the three requested providers and leaves unreported quota and token counts unknown', () => {
 const rows=providerUsage({tasks:[],limits:{}});
 expect(rows.map(r=>r.provider)).toEqual(['codex','claude','antigravity']);
 expect(rows.every(r=>!r.limits&&!r.hasTokens)).toBe(true);
});
it('adds tracked tokens across machines, includes the main agent once and never counts context or reasoning twice', () => {
 const usage={input:100,cacheRead:20,cacheWrite:10,output:30,reasoning:15,context:5000,updatedAt:'today'};
 const a={taskId:'a',provider:'antigravity',usage};
 const snapshot={limits:{},tasks:[a,{...a,taskId:'b',host:'UT'},a,{taskId:'c',provider:'codex',usage}],main:a} as unknown as WorkspaceSnapshot;
 const rows=providerUsage(snapshot);
 expect(rows.find(r=>r.provider==='antigravity')).toMatchObject({hasTokens:true,tokens:320});
 expect(rows.find(r=>r.provider==='codex')?.tokens).toBe(160);
 expect(rows.find(r=>r.provider==='claude')?.hasTokens).toBe(false);
});
