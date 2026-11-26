// Embedded-host adapter for the Gemini CLI Agent Client Protocol.
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile);
export class GeminiAdapter {
  provider = "gemini";
  remote = true;
  constructor(findExecutable) {
    this.find = findExecutable;
  }
  async capabilities() {
    return {
      provider: "gemini",
      available: !!this.find("gemini"),
      createSession: true,
      resumeHistorical: true,
      importHistory: false,
      attachExternalRunning: false,
      readOnlyMonitor: false,
      structuredApprovals: true,
      structuredQuestions: false,
    };
  }
  async discoverSessions() {
    return [];
  }
  async listModels(host) {
    const session = new GeminiSession(
      this.find,
      { cwd: host ? "/tmp" : process.env.HOME, host, title: "Model options" },
      () => {},
    );
    try {
      await session.start();
      const choices = session.models?.availableModels || [];
      const effortOption = session.config.find(
        (o) =>
          o.category === "thought_level" ||
          ["thought_level", "reasoning_effort", "thinking"].includes(o.id),
      );
      const efforts = (effortOption?.options || [])
        .flatMap((o) => o.options || [o])
        .map((o) => o.value);
      return choices.map((m) => ({
        id: m.modelId,
        label: m.name,
        isDefault: m.modelId === session.models.currentModelId,
        reasoningEfforts: efforts,
      }));
    } finally {
      await session.close();
    }
  }

  createSession(args, onEvent) {
    return new GeminiSession(this.find, args, onEvent);
  }
}
export class GeminiSession {
  provider = "gemini";
  canSteer = false;
  pending = new Map();
  permissions = new Map();
  seq = 0;
  active = false;
  closed = false;
  config = [];
  constructor(find, args, emit) {
    this.find = find;
    this.args = args;
    this.emit = emit;
  }
  nativeSessionId() {
    return this.sid;
  }
  async start() {
    const a = this.args;
    let bin = this.find("gemini");
    let flag = "--acp";
    let explicitApproval = false;
    if (a.host) {
      const help = await exec(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-T",
          a.host,
          "--",
          'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"; gemini --help',
        ],
        { timeout: 20000, maxBuffer: 1000000 },
      );
      explicitApproval = help.stdout.includes("--approval-mode");
      if (!help.stdout.includes("--acp")) {
        if (help.stdout.includes("--experimental-acp"))
          flag = "--experimental-acp";
        else throw Error("This Gemini CLI does not offer ACP mode.");
      }
      this.child = spawn(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-T",
          a.host,
          "--",
          `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"; exec gemini ${flag}${explicitApproval ? " --approval-mode default" : ""}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } else {
      if (!bin)
        throw Error(
          "Gemini CLI is not installed. Install it and sign in first.",
        );
      const help = await exec(bin, ["--help"], {
        timeout: 20000,
        maxBuffer: 1000000,
      });
      explicitApproval = help.stdout.includes("--approval-mode");
      if (!help.stdout.includes("--acp")) {
        if (help.stdout.includes("--experimental-acp"))
          flag = "--experimental-acp";
        else throw Error("This Gemini CLI does not offer ACP mode.");
      }
      this.child = spawn(
        bin,
        [flag, ...(explicitApproval ? ["--approval-mode", "default"] : [])],
        {
          cwd: a.cwd,
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([k]) =>
                ![
                  "ELECTRON_RUN_AS_NODE",
                  "CLAUDECODE",
                  "CLAUDE_CODE_ENTRYPOINT",
                  "CLAUDE_CODE_SSE_PORT",
                ].includes(k),
            ),
          ),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    }
    let stderr = "";
    this.child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-4000);
    });
    this.child.on("error", (e) => this.fail(e));
    this.child.on("exit", () =>
      this.fail(Error(stderr || "Gemini connection closed.")),
    );
    createInterface({ input: this.child.stdout }).on("line", (l) => {
      let m;
      try {
        m = JSON.parse(l);
      } catch {
        return;
      }
      this.receive(m);
    });
    await this.rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "Deimos", version: "0.26.0" },
    });
    const method = a.resumeNativeSessionId ? "session/load" : "session/new";
    const session = await this.rpc(method, {
      cwd: a.cwd,
      mcpServers: [],
      ...(a.resumeNativeSessionId
        ? { sessionId: a.resumeNativeSessionId }
        : {}),
    });
    this.sid = session.sessionId || a.resumeNativeSessionId;
    this.config = session.configOptions || [];
    this.models = session.models;
    this.modes = session.modes;
    const safeMode = session.modes?.availableModes?.find((m) =>
      ["default", "normal"].includes(m.id),
    );
    if (safeMode)
      await this.rpc("session/set_mode", {
        sessionId: this.sid,
        modeId: safeMode.id,
      });
    else if (
      !explicitApproval &&
      !["default", "normal"].includes(session.modes?.currentModeId)
    )
      throw Error("Gemini must run in its default approval mode.");
    this.currentPermissionMode = "ask";
    await this.setPermissionMode(a.permissionMode || "ask");
    if (a.model) await this.setModel(a.model);
    if (a.reasoningEffort) await this.setReasoningEffort(a.reasoningEffort);
    this.emit({
      type: "sessionStarted",
      nativeSessionId: this.sid,
      resumed: !!a.resumeNativeSessionId,
    });
  }
  write(m) {
    if (!this.child?.stdin.writable) throw Error("Gemini is disconnected.");
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  }
  rpc(method, params, timeout = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Gemini ${method} timed out.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  receive(m) {
    if (m.method === "session/request_permission") {
      if (m.params?.sessionId !== this.sid) {
        this.write({ id: m.id, result: { outcome: { outcome: "cancelled" } } });
        return;
      }
      const p = m.params,
        id = String(m.id);
      this.permissions.set(id, { rpcId: m.id, options: p.options || [] });
      this.emit({
        type: "approvalRequested",
        requestId: id,
        headline: p.toolCall?.title || "Gemini requests permission",
        details: JSON.stringify(
          p.toolCall?.rawInput || p.toolCall || {},
          null,
          2,
        ),
        options: (p.options || []).map((o) => ({
          id: o.optionId,
          label: o.name,
          kind: o.kind,
        })),
        toolCallId: p.toolCall?.toolCallId,
        preview: p.toolCall?.content,
      });
      return;
    }
    if (m.method === "session/update") {
      if (m.params?.sessionId !== this.sid) return;
      const u = m.params.update || {},
        type = u.sessionUpdate;
      if (type === "agent_message_chunk" || type === "agent_thought_chunk") {
        const role = type === "agent_thought_chunk" ? "thought" : "assistant";
        if (u.content?.text)
          this.emit({
            type: "outputDelta",
            itemId: this.turn + "-" + role,
            role,
            delta: u.content.text,
          });
      } else if (type === "tool_call" || type === "tool_call_update")
        this.emit({
          type: "transcriptItem",
          itemId: u.toolCallId,
          role: "tool",
          text: u.title || "",
          toolLabel: u.title,
          toolStatus:
            u.status === "pending"
              ? "awaiting_approval"
              : u.status === "in_progress"
                ? "running"
                : u.status,
          tool: {
            name: u.title,
            content: u.content,
            rawInput: u.rawInput,
            rawOutput: u.rawOutput,
          },
        });
      else if (type === "plan")
        this.emit({ type: "planUpdated", entries: u.entries || [] });
      else if (type === "config_option_update")
        this.config = u.configOptions || [];
      return;
    }
    if (m.method && m.id !== undefined) {
      this.write({
        id: m.id,
        error: { code: -32601, message: "Client method not supported" },
      });
      return;
    }
    const p = this.pending.get(m.id);
    if (p) {
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  }
  async send(text, opts = {}) {
    if (this.active)
      throw Error("Wait for this Gemini turn to finish or stop it first.");
    this.active = true;
    this.turn = randomUUID();
    this.emit({ type: "turnStarted" });
    const context =
      !this.sentContext && this.args.developerInstructions
        ? this.args.developerInstructions + "\n\n"
        : "";
    this.sentContext = true;
    const prompt = [{ type: "text", text: context + text }];
    for (const image of opts.images || [])
      prompt.push({
        type: "image",
        data: (await readFile(image.path)).toString("base64"),
        mimeType: image.mediaType,
      });
    void this.rpc(
      "session/prompt",
      { sessionId: this.sid, prompt },
      24 * 60 * 60 * 1000,
    ).then(
      (r) => {
        this.active = false;
        this.resolvePermissions();
        this.emit({
          type: "turnCompleted",
          status: r.stopReason === "cancelled" ? "interrupted" : "completed",
        });
      },
      (e) => {
        this.active = false;
        this.resolvePermissions();
        this.emit({
          type: "turnCompleted",
          status: "failed",
          error: e.message,
        });
      },
    );
    return "turn";
  }
  async respond(id, response) {
    const p = this.permissions.get(id);
    if (!p) throw Error("This Gemini approval expired.");
    const option = p.options.find((o) => o.optionId === response.decision);
    if (!option) throw Error("Invalid Gemini approval option.");
    this.permissions.delete(id);
    this.write({
      id: p.rpcId,
      result: { outcome: { outcome: "selected", optionId: option.optionId } },
    });
  }
  async setModel(model) {
    if (!model) return;
    const option = this.config.find(
      (o) => o.category === "model" || o.id === "model",
    );
    if (option)
      await this.rpc("session/set_config_option", {
        sessionId: this.sid,
        configId: option.id,
        value: model,
      });
    else
      await this.rpc("session/set_model", {
        sessionId: this.sid,
        modelId: model,
      });
  }
  async setReasoningEffort(effort) {
    if (!effort) return;
    const option = this.config.find(
      (o) =>
        ["thought_level", "reasoning_effort", "thinking"].includes(o.id) ||
        o.category === "thought_level",
    );
    const values = (option?.options || []).flatMap((v) => v.options || [v]);
    if (!option || !values.some((v) => v.value === effort))
      throw Error(
        "This Gemini model does not expose the selected reasoning effort.",
      );
    await this.rpc("session/set_config_option", {
      sessionId: this.sid,
      configId: option.id,
      value: effort,
    });
  }
  async setPermissionMode(mode) {
    if (!["ask", "edits"].includes(mode))
      throw Error(
        "Gemini does not expose native automatic risk review. Choose Ask every time or Allow file edits.",
      );
    if (this.sid && mode !== this.currentPermissionMode) {
      const nativeMode = this.modes?.availableModes?.find((m) =>
        mode === "ask"
          ? ["default", "normal"].includes(m.id)
          : m.id === "auto_edit",
      );
      if (!nativeMode)
        throw Error(
          "This Gemini CLI does not expose the selected permission mode.",
        );
      await this.rpc("session/set_mode", {
        sessionId: this.sid,
        modeId: nativeMode.id,
      });
    }
    this.args.permissionMode = mode;
    this.currentPermissionMode = mode;
  }
  resolvePermissions() {
    for (const [id, p] of this.permissions) {
      try {
        this.write({
          id: p.rpcId,
          result: { outcome: { outcome: "cancelled" } },
        });
      } catch {}
      this.emit({
        type: "requestResolved",
        requestId: id,
        reason: "Turn ended",
      });
    }
    this.permissions.clear();
  }
  async interrupt() {
    this.resolvePermissions();
    if (this.sid)
      this.write({ method: "session/cancel", params: { sessionId: this.sid } });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.permissions.clear();
    this.emit({ type: "sessionDisconnected", reason: error.message });
  }
  async close() {
    await this.interrupt().catch(() => {});
    this.fail(Error("Gemini stopped."));
    this.child?.kill();
  }
}
