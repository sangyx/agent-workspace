import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
it.each([
  { mode: "ask", editAvailable: true },
  { mode: "edits", editAvailable: true },
  { mode: "edits", editAvailable: false },
])(
  "negotiates Gemini $mode permissions (edit support: $editAvailable) without bypassing command approvals",
  async ({ mode, editAvailable }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deimos-gemini-acp-")),
      bin = path.join(root, "gemini"),
      marker = path.join(root, "approved.txt");
    await fs.writeFile(
      bin,
      `#!${process.execPath}\nconst fs=require('fs'),readline=require('readline');if(process.argv.includes('--help')){console.log('--acp --approval-mode');process.exit(0);}if(!process.argv.includes('default'))process.exit(2);const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');let prompt;readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'g1',modes:{currentModeId:'default',availableModes:${JSON.stringify([{ id: "default" }, ...(editAvailable ? [{ id: "auto_edit" }] : [])])}},models:{currentModelId:'gemini-test',availableModels:[{modelId:'gemini-test',name:'Test'}]}}});else if(m.method==='session/set_mode')send({id:m.id,result:{}});else if(m.method==='session/prompt'){prompt=m.id;send({id:101,method:'session/request_permission',params:{sessionId:'g1',toolCall:{toolCallId:'edit1',title:'Write approved fixture',rawInput:{file:${JSON.stringify(marker)}}},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'deny',name:'Deny',kind:'reject_once'}]}});}else if(m.id===101){if(m.result.outcome.optionId==='allow')fs.writeFileSync(${JSON.stringify(marker)},'approved');send({method:'session/update',params:{sessionId:'g1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Finished safely.'}}}});send({id:prompt,result:{stopReason:'end_turn'}});} });`,
    );
    await fs.chmod(bin, 0o755);
    const { GeminiSession } = await import(
        "../runtime/gemini-acp.mjs" as string
      ),
      events: any[] = [],
      s = new GeminiSession(
        () => bin,
        { cwd: root, title: "Test", permissionMode: mode },
        (e: any) => events.push(e),
      );
    try {
      if (mode === "edits" && !editAvailable) {
        await expect(s.start()).rejects.toThrow(
          "does not expose the selected permission mode",
        );
        expect(
          await fs.access(marker).then(
            () => true,
            () => false,
          ),
        ).toBe(false);
        return;
      }
      await s.start();
      await expect(s.setPermissionMode("auto")).rejects.toThrow(
        "automatic risk review",
      );
      expect(s.currentPermissionMode).toBe(mode);
      await s.send("Write the fixture");
      for (
        let i = 0;
        i < 50 && !events.find((e) => e.type === "approvalRequested");
        i++
      )
        await new Promise((r) => setTimeout(r, 10));
      const a = events.find((e) => e.type === "approvalRequested");
      expect(a.options.map((o: any) => o.id)).toEqual(["allow", "deny"]);
      expect(
        await fs.access(marker).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      await expect(
        s.respond(a.requestId, { decision: "made-up" }),
      ).rejects.toThrow("Invalid");
      await s.respond(a.requestId, { decision: "allow" });
      for (
        let i = 0;
        i < 50 && !events.find((e) => e.type === "turnCompleted");
        i++
      )
        await new Promise((r) => setTimeout(r, 10));
      expect(await fs.readFile(marker, "utf8")).toBe("approved");
      expect(events.find((e) => e.type === "outputDelta")?.delta).toBe(
        "Finished safely.",
      );
      expect(events.find((e) => e.type === "turnCompleted")?.status).toBe(
        "completed",
      );
      await expect(
        s.respond(a.requestId, { decision: "allow" }),
      ).rejects.toThrow("expired");
    } finally {
      await s.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
