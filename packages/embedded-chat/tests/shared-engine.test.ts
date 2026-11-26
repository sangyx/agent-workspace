import {it,expect} from 'vitest';
it('uses a supplied native Workspace without starting a second engine or replacing native settings',async()=>{
 const {createHostMethods}=await import('../runtime/host-runtime.mjs' as string);
 const settings={permissionMode:'auto',autoListen:true,memoryLinks:{local:true}};
 const workspace={store:{data:{settings}},onChange:()=>()=>{},onTranscript:()=>()=>{},snapshot:()=>({settings,tasks:[{taskId:'same-engine'}]}),shutdown:async()=>{}};
 class Adapter{};class UnexpectedWorkspace{constructor(){throw Error('A second engine was created');}}
 const host=createHostMethods({workspace,dataDir:'/tmp/host-test',Workspace:UnexpectedWorkspace,ClaudeAdapter:Adapter,CodexAdapter:Adapter,AntigravityAdapter:Adapter});
 expect(host.workspace).toBe(workspace);expect((await host.call('snapshot',{})).tasks[0].taskId).toBe('same-engine');
 expect(settings).toEqual({permissionMode:'auto',autoListen:true,memoryLinks:{local:true}});
});
