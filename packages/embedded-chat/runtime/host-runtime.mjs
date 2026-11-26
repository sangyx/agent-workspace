import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GeminiAdapter } from "./gemini-acp.mjs";
const exec = promisify(execFile),
  send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
export function createHostMethods({
  workspace: providedWorkspace,
  publish = () => {},
  dataDir = process.env.AMW_EMBED_DATA,
  contextPrefix = "host-context-",
  contextSource = "Host project context",
  projectName = "Chats",
  Workspace,
  ClaudeAdapter,
  CodexAdapter,
  AntigravityAdapter,
  MockAdapter,
  findExecutable,
  readLocal,
  readRemote,
  workDirs,
}) {
  if (!dataDir) throw Error("Runtime data directory missing.");
  const workspaceOptions = {
    dataDir,
    adapters: {
      claude: new ClaudeAdapter(),
      codex: new CodexAdapter(),
      gemini: new GeminiAdapter(findExecutable),
      antigravity: new AntigravityAdapter(),
      ...(process.env.AMW_EMBED_TEST === "1"
        ? { mock: new MockAdapter(path.join(dataDir, "mock-sessions")) }
        : {}),
    },
    log: (...args) => console.error(...args),
  };
  const ws = providedWorkspace || new Workspace(workspaceOptions);
  // Preserve the prior fallback for legacy tasks with no saved override.
  // Newly created tasks receive their provider-specific default explicitly.
  if (!providedWorkspace) {
    ws.store.data.settings.permissionMode = "ask";
    ws.store.data.settings.autoListen = false;
    ws.store.data.settings.memoryLinks = {};
  }
  let revision = 0;
  ws.onChange(() => {
    revision++;
    publish({ event: "changed", revision });
  });
  ws.onTranscript(() => {
    revision++;
    publish({ event: "transcript", revision });
  });
  const sideAsks = new Set();
  const checked = new Set(),
    cancelledTasks = new Set();
  const check = async (engine, host) => {
    const key = engine + "@" + (host || "local");
    if (checked.has(key) || engine === "mock") return;
    const executable = engine === "antigravity" ? "agy" : engine;
    if (host && engine === "antigravity")
      throw Error(
        "Native Antigravity Chat is available on this Mac. Use the local Antigravity provider.",
      );
    if (host) {
      const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
      const cmds = [
        engine + " --help",
        ...(engine === "codex"
          ? ["codex app-server --help", "codex login --help"]
          : engine === "claude"
            ? ["claude auth --help"]
            : []),
      ].join(" >/dev/null && ");
      await exec(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-T",
          host,
          "--",
          `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ${cmds} >/dev/null`,
        ],
        { timeout: 30000, maxBuffer: 200000 },
      );
    } else {
      const bin = findExecutable(executable);
      if (!bin)
        throw Error(
          `${engine} CLI is not installed. Install it and sign in, then retry.`,
        );
      await exec(bin, ["--help"], { timeout: 20000, maxBuffer: 1000000 });
      if (engine === "antigravity")
        await exec(bin, ["acp", "--help"], {
          timeout: 20000,
          maxBuffer: 1000000,
        });
      if (engine === "codex") {
        await exec(bin, ["app-server", "--help"], {
          timeout: 20000,
          maxBuffer: 1000000,
        });
        await exec(bin, ["login", "--help"], {
          timeout: 20000,
          maxBuffer: 1000000,
        });
      }
      if (engine === "claude")
        await exec(bin, ["auth", "--help"], {
          timeout: 20000,
          maxBuffer: 1000000,
        });
    }
    checked.add(key);
  };
  const task = (id) => {
    const t = ws.store.data.tasks.find((t) => t.taskId === id);
    if (!t) throw Error("Conversation missing.");
    return t;
  };
  const permission = (
    provider,
    mode = provider === "gemini" ? "ask" : "auto",
  ) => {
    if (!["ask", "edits", "auto"].includes(mode))
      throw Error("Choose an offered permission mode.");
    if (provider === "gemini" && mode === "auto")
      throw Error(
        "Gemini does not expose native automatic risk review. Choose Ask every time or Allow file edits.",
      );
    return mode;
  };
  const method = async (name, a) => {
    switch (name) {
      case "provider-models": {
        await check(a.provider, a.host);
        const adapter = workspaceOptions.adapters[a.provider];
        if (!adapter?.listModels)
          throw Error("This CLI does not expose a model catalog.");
        return adapter.listModels(a.host);
      }
      case "file-preview": {
        // Read only: this never attaches a CLI or changes the original chat.
        const where = {
          cwd: a.directory.path,
          roots: a.roots,
          bases: workDirs(a.messages || [], a.directory.path, path.posix),
        };
        const file =
          a.directory.location === "ssh"
            ? await readRemote(a.directory.sshHost, a.path, where)
            : readLocal(a.path, where);
        if (!["pdf", "html"].includes(file.kind))
          throw Error("Choose a PDF or HTML file.");
        return {
          path: file.path,
          kind: file.kind,
          size: file.size,
          base64: file.data
            ? Buffer.from(file.data).toString("base64")
            : undefined,
          text: file.text,
        };
      }
      case "snapshot":
        return { ...ws.snapshot(), revision };
      case "detail": {
        const t = task(a.id);
        return {
          task: t,
          messages: ws.transcript(t.taskId),
          index: ws.store.data.sessionMaps?.[t.taskId] || null,
          related: ws.store.data.tasks
            .filter(
              (x) =>
                x.forkedFrom?.taskId === t.taskId ||
                x.taskId === t.forkedFrom?.taskId,
            )
            .map((x) => ({
              taskId: x.taskId,
              forkedFrom: x.forkedFrom,
              createdAt: x.createdAt,
              name: x.name,
              alias: x.alias,
            })),
          attention: ws.store.data.attention.filter(
            (x) => x.taskId === t.taskId && x.state === "open",
          ),
          revision,
        };
      }
      case "create": {
        const mode = permission(a.provider, a.permissionMode);
        await check(a.provider, a.directory.sshHost);
        if (a.directory.sshHost) {
          ws.store.data.settings.remoteHosts = [
            ...new Set([
              ...(ws.store.data.settings.remoteHosts || []),
              a.directory.sshHost,
            ]),
          ];
        }
        const project = await ws.addProject(
          a.directory.path,
          a.projectName,
          a.directory.sshHost,
        );
        const created = await ws.createTask({
          projectId: project.projectId,
          provider: a.provider,
          title: a.title,
          name: a.title,
          model: a.model,
          permissionMode: mode,
          mockScript:
            process.env.AMW_EMBED_TEST === "1" ? a.mockScript : undefined,
          isolate: a.isolate === true,
        });
        if (!a.isolate) created.cwd = a.directory.path;
        created.permissionMode = mode;
        if (a.effort && a.effort !== "default")
          await ws.setReasoningEffort(created.taskId, a.effort);
        if (a.instructions)
          ws.store.data.memory.push({
            id: contextPrefix + created.taskId,
            scope: "task",
            scopeId: created.taskId,
            body: a.instructions,
            source: contextSource,
            approvedForReuse: true,
            updatedAt: new Date().toISOString(),
          });
        ws.store.save();
        ws.store.flush();
        return created;
      }
      case "side-list":
        return ws.btwList(task(a.id).taskId);
      case "side-clear":
        if (sideAsks.has(a.id))
          throw Error("Wait for the side answer before clearing it.");
        ws.clearBtw(task(a.id).taskId);
        ws.store.flush();
        return { ok: true };
      case "side-ask": {
        const t = task(a.id);
        if (["gemini", "antigravity"].includes(t.provider))
          throw Error(
            "This provider adapter does not expose read-only side questions.",
          );
        if (
          typeof a.question !== "string" ||
          !a.question.trim() ||
          a.question.length > 12000
        )
          throw Error("Enter a side question (up to 12,000 characters).");
        if (sideAsks.has(a.id))
          throw Error("A side answer is already in progress.");
        sideAsks.add(a.id);
        try {
          await check(t.provider, t.host);
          const result = await ws.askBtw(t.taskId, a.question.trim());
          ws.store.flush();
          return result;
        } finally {
          sideAsks.delete(a.id);
        }
      }
      case "send": {
        const t = task(a.id);
        cancelledTasks.delete(t.taskId);
        if (a.text?.trimStart().startsWith("!"))
          throw Error(
            "Ask the agent to run commands in plain language so native approval checks apply.",
          );
        await check(t.provider, t.host);
        if (
          ws.store.data.attention.some(
            (x) =>
              x.taskId === t.taskId &&
              x.state === "open" &&
              !!x.providerRequestId &&
              ["approval", "question"].includes(x.kind),
          )
        )
          throw Error(
            "Answer the pending approval or question card before sending another message.",
          );
        if (a.context) {
          const m = ws.store.data.memory.find(
            (m) => m.id === contextPrefix + t.taskId,
          );
          if (m) {
            m.body = a.context;
            m.updatedAt = new Date().toISOString();
          }
        }
        if (a.model !== undefined)
          await ws.setModel(t.taskId, a.model || undefined);
        if (a.effort !== undefined)
          await ws.setReasoningEffort(
            t.taskId,
            a.effort === "default" ? null : a.effort,
          );
        const images = [];
        for (const image of a.images || [])
          images.push(
            ws.attachments.save(await fs.readFile(image.file), image.name),
          );
        const result = await ws.send(t.taskId, a.text, "text", { images });
        if (cancelledTasks.has(t.taskId)) await ws.interrupt(t.taskId);
        ws.store.flush();
        if (!result.ok) throw Error(result.error || "Could not send message.");
        return result;
      }
      case "permissions": {
        const t = task(a.id),
          mode = permission(t.provider, a.mode);
        if (
          ["running", "starting"].includes(t.status) ||
          ws.store.data.attention.some(
            (x) =>
              x.taskId === t.taskId &&
              x.state === "open" &&
              x.providerRequestId &&
              ["approval", "question"].includes(x.kind),
          )
        )
          throw Error(
            "Wait for the agent or stop it before changing permissions. Pending native requests still need a response.",
          );
        const before = t.permissionMode || "ask";
        try {
          await ws.setPermissionMode(t.taskId, mode);
        } catch (error) {
          await ws.setPermissionMode(t.taskId, before).catch(() => {});
          t.permissionMode = before;
          ws.store.save();
          ws.store.flush();
          throw error;
        }
        ws.store.flush();
        return { permissionMode: mode };
      }
      case "respond": {
        const t = task(a.id),
          item = ws.store.data.attention.find(
            (x) =>
              x.id === a.attentionId &&
              x.taskId === t.taskId &&
              x.state === "open",
          );
        if (!item)
          throw Error(
            "This request expired or belongs to another conversation.",
          );
        if (!item.providerRequestId)
          throw Error(
            "Reply to this agent question in the conversation composer.",
          );
        if (
          item.options?.length &&
          !item.options.some((x) => x.id === a.decision)
        )
          throw Error("Choose an offered native approval option.");
        await ws.respondAttention(item.id, a.decision, a.answers);
        ws.store.flush();
        return { ok: true };
      }
      case "interrupt":
        cancelledTasks.add(a.id);
        await ws.interrupt(task(a.id).taskId);
        return { ok: true };
      case "stop":
        cancelledTasks.add(a.id);
        await ws.stop(task(a.id).taskId);
        return { ok: true };
      case "catalog": {
        await check(a.provider, a.directory.sshHost);
        if (a.directory.sshHost)
          ws.store.data.settings.remoteHosts = [
            ...new Set([
              ...(ws.store.data.settings.remoteHosts || []),
              a.directory.sshHost,
            ]),
          ];
        const p = await ws.addProject(
          a.directory.path,
          a.projectName || projectName,
          a.directory.sshHost,
        );
        return ws.listProjectModels({
          projectId: p.projectId,
          provider: a.provider,
        });
      }
      case "models": {
        const t = task(a.id);
        await check(t.provider, t.host);
        return ws.listModels(t.taskId);
      }
      case "index": {
        const t = task(a.id);
        await check(t.provider, t.host);
        const engine = ["claude", "codex"].includes(t.provider)
          ? t.provider
          : findExecutable("codex")
            ? "codex"
            : "claude";
        await check(engine);
        const adapter = workspaceOptions.adapters[engine];
        (providedWorkspace
          ? providedWorkspace.opts
          : workspaceOptions
        ).backgroundModel = (system, prompt) => adapter.oneShot(system, prompt);
        try {
          const result = await ws.sessionMapGrouping(t.taskId);
          ws.store.flush();
          if (!result)
            throw Error(
              "The agent did not return a task grouping. The conversation turn index is still available.",
            );
          return result;
        } finally {
          (providedWorkspace
            ? providedWorkspace.opts
            : workspaceOptions
          ).backgroundModel = undefined;
        }
      }
      case "fork": {
        const t = task(a.id);
        await check(t.provider, t.host);
        return ws.forkTask(t.taskId, {
          instruction: a.instruction || "",
          isolate: true,
        });
      }
      case "shutdown":
        await ws.shutdown();
        return { ok: true };
      default:
        throw Error("Unsupported bridge operation.");
    }
  };
  return { call: method, shutdown: () => ws.shutdown(), workspace: ws };
}
export async function startHost(options) {
  const host = createHostMethods({ ...options, publish: send });
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.length > 20000000) return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof m.id !== "number") return;
    void host.call(m.method, m.args || {}).then(
      (result) => send({ id: m.id, result }),
      (error) => send({ id: m.id, error: error.message }),
    );
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await host.shutdown();
    process.exit(0);
  };
  lines.on("close", () => void close());
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  send({ event: "ready", revision: 0 });
}
