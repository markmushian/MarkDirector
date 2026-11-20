import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { listConnections } from "@/utils/mcp/control";
import type { AgentEvent } from "@/agent/runtime/types";
import { runStreamJson } from "./streamJson";
import { runPersistentStreamJson } from "./persistentTraceStream";
import { detectCliEngine, getCliEngine, parseCliProvider } from "./registry";
import { registerMcpProgress } from "./mcpProgress";
import { prepareCliMcpBridge } from "./mcpBridge";
import type { CliEngineId, CliLaunch } from "./types";
import { CliEngineError } from "./types";

export * from "./registry";
export * from "./types";

/** codex 冷启动到首条事件的等待上限。实测首次 turn 约 5-15 秒。 */
const CODEX_FIRST_OUTPUT_MS = 150_000;

export type RunCliAgentInput = {
  providerId: string;
  modelId?: string;
  prompt: string;
  cwd: string;
  signal: AbortSignal;
  send: (event: AgentEvent) => void;
  sessionFile: string;
  usesCanvas?: boolean;
};

const sessionCache = new Map<string, string>();

/**
 * CLI 引擎的统一入口。
 * 传输层差异在这里收口，上层（/api/agent 路由）只关心「这是一次 CLI 回合」。
 */
export async function runCliAgent(input: RunCliAgentInput): Promise<string | undefined> {
  const engineId = parseCliProvider(input.providerId);
  if (!engineId) throw new CliEngineError(`不是 CLI 引擎标识：${input.providerId}`, "claude");
  const engine = getCliEngine(engineId);
  if (!engine) throw new CliEngineError(`未注册的引擎：${engineId}`, engineId);

  const status = await detectCliEngine(engineId);
  if (!status.available) {
    throw new CliEngineError(status.reason ?? `${engine.label} 不可用`, engineId, "请在设置中检查该 CLI 是否已安装并登录");
  }

  const key = JSON.stringify([input.cwd, input.sessionFile, engineId, input.modelId]);
  const resumeSessionId = sessionCache.get(key);

  // 挂上 MarkDirector 自带的 MCP（画布/节点/文档/切项目），CLI 才真正能操作画布。
  const mcp = prepareCliMcpBridge(key);
  let launch: CliLaunch;
  let ownsMcpConfig = true;
  try {
    const hasCanvasConnection = () => listConnections().some(connection => connection.state.directory === input.cwd);
    if (mcp.endpoint && input.usesCanvas && !hasCanvasConnection()) {
      input.send({ type: "cliStatus", message: "正在连接画布工具…", connectMcp: true });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !hasCanvasConnection()) {
        await delay(100, undefined, { signal: input.signal });
      }
      if (!hasCanvasConnection()) throw new CliEngineError("画布工具未连接。请保持当前项目打开后重试", engineId);
    }
    input.signal.throwIfAborted();
    launch = await engine.launch({
      prompt: input.prompt,
      model: input.modelId,
      cwd: input.cwd,
      resumeSessionId,
      mcpConfigPath: mcp.configPath,
      codexMcpArgs: mcp.codexArgs,
    });
  } catch (error) {
    mcp.dispose();
    throw error;
  }

  const unregisterProgress = mcp.connectionKey ? registerMcpProgress(mcp.connectionKey, input.send) : undefined;
  try {
    // CodeBuddy 只能走常驻进程：`-p <prompt>` 那条 headless 路径会崩在 lite bundle 的 setProxy。
    if (engine.persistent) {
      const result = await runPersistentStreamJson({
        engineId, key: JSON.stringify([key, mcp.connectionKey]), launch, prompt: input.prompt, cwd: input.cwd,
        retainLaunch: () => { ownsMcpConfig = false; return mcp.dispose; },
        signal: input.signal, send: input.send, firstOutputTimeoutMs: 120_000,
        idleTimeoutMs: 300_000,
      });
      if (!result.text.trim()) {
        input.send({ type: "text", blockId: "0:0", content: "（引擎未返回文本内容）", done: true });
      }
      return result.sessionId;
    }

    if (engine.transport === "stream-json") {
      const result = await runStreamJson({
        engineId,
        launch,
        cwd: input.cwd,
        signal: input.signal,
        send: input.send,
      });
      if (result.sessionId) sessionCache.set(key, result.sessionId);
      if (!result.text.trim()) {
        input.send({ type: "text", blockId: "0:0", content: "（引擎未返回文本内容）", done: true });
      }
      return result.sessionId;
    }

    if (engine.transport === "codex-exec") {
      await runCodexExec({ engineId, launch, cwd: input.cwd, signal: input.signal, send: input.send });
      return undefined;
    }
  } finally {
    unregisterProgress?.();
    if (ownsMcpConfig) mcp.dispose();
  }

  throw new CliEngineError(
    `${engine.label} 使用 ACP 协议，传输层将在下一阶段接入`,
    engineId,
    "当前可先用 Claude Code / CodeBuddy / Codex 三个引擎",
  );
}

/**
 * Codex 的 `exec --json` 事件流（0.167 实测格式）。
 *
 * 行协议：
 *  - {"type":"thread.started","thread_id":"…"}                        会话开始
 *  - {"type":"turn.started"}                                          回合开始
 *  - {"type":"item.started"|"item.updated"|"item.completed","item":…}  条目
 *      item.type: agent_message / reasoning / command_execution / file_change / mcp_tool_call / error
 *  - {"type":"turn.completed","usage":{…}}                            回合结束
 *  - {"type":"turn.failed","error":{…}}                               失败
 */
async function runCodexExec(input: {
  engineId: CliEngineId;
  launch: CliLaunch;
  cwd: string;
  signal: AbortSignal;
  send: (event: AgentEvent) => void;
}): Promise<void> {
  const { launch, cwd, signal, send, engineId } = input;
  if (signal.aborted) throw new DOMException("已停止生成", "AbortError");

  const env: NodeJS.ProcessEnv = { ...process.env, ...launch.env };
  for (const [key, value] of Object.entries(launch.env)) {
    if (value === "" || value === undefined) delete env[key];
  }

  const child = spawn(launch.command, launch.args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let buffer = "";
  let stderrTail = "";
  let text = "";
  const textBlocks = new Map<string, string>();
  let firstTimer: NodeJS.Timeout | undefined;
  const finished = Promise.withResolvers<void>();
  let settled = false;

  const cleanup = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    signal.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    try { child.kill(); } catch { /* 忽略 */ }
    finished.reject(new DOMException("已停止生成", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const fail = (message: string, hint?: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    try { child.kill(); } catch { /* 忽略 */ }
    finished.reject(new CliEngineError(message, engineId, hint));
  };
  const succeed = () => {
    if (settled) return;
    settled = true;
    cleanup();
    finished.resolve();
  };


  firstTimer = setTimeout(
    () => fail(`codex 启动 ${Math.round(CODEX_FIRST_OUTPUT_MS / 1000)} 秒没有任何输出`, "请确认 codex 能在终端独立运行且已登录"),
    CODEX_FIRST_OUTPUT_MS,
  );

  const handleEvent = (msg: Record<string, unknown>) => {
    const type = String(msg.type ?? "");
    const item = msg.item as Record<string, unknown> | undefined;

    if (type === "thread.started") return;

    if (type === "turn.completed") {
      const usage = msg.usage as Record<string, number> | undefined;
      if (usage) {
        send({
          type: "stats",
          stats: {
            tokens: {
              input: usage.input_tokens ?? 0,
              output: usage.output_tokens ?? 0,
              cacheRead: usage.cached_input_tokens ?? 0,
              cacheWrite: usage.cache_write_input_tokens ?? 0,
              total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            },
          },
        });
      }
      if (!text.trim()) send({ type: "text", blockId: "empty", content: "（引擎未返回文本内容）", done: true });
      succeed();
      return;
    }

    if (type === "turn.failed") {
      const error = msg.error as { message?: string } | undefined;
      fail(error?.message ?? "Codex 回合失败");
      return;
    }

    if (!item) return;
    const itemType = String(item.type ?? "");
    const id = String(item.id ?? crypto.randomUUID());

    if (itemType === "agent_message") {
      const full = String(item.text ?? "");
      if (full) {
        textBlocks.set(id, full);
        text = [...textBlocks.values()].join("\n");
        send({ type: "text", blockId: id, content: full, done: type === "item.completed" });
      }
      return;
    }

    if (itemType === "reasoning") {
      const think = String(item.text ?? "");
      if (think) send({ type: "thinking", blockId: `think:${id}`, delta: think });
      return;
    }

    if (itemType === "command_execution") {
      const status = String(item.status ?? "");
      if (type === "item.started" || status === "in_progress") {
        send({
          type: "tool",
          blockId: `tool:${id}`,
          tool: { id, name: "shell", args: { command: item.command }, status: "running" },
        });
      } else if (type === "item.completed") {
        send({
          type: "tool",
          blockId: `tool:${id}`,
          tool: {
            id,
            name: "shell",
            status: Number(item.exit_code ?? 0) === 0 ? "success" : "error",
            result: String(item.aggregated_output ?? "").slice(0, 20000),
          },
        });
      }
      return;
    }

    if (itemType === "file_change") {
      const changes = Array.isArray(item.changes) ? item.changes as Array<Record<string, unknown>> : [];
      const files = changes.map(change => String(change.path ?? "")).filter(Boolean).join(", ");
      send({
        type: "tool",
        blockId: `tool:${id}`,
        tool: {
          id,
          name: "edit",
          args: { files },
          status: type === "item.completed" ? (String(item.status ?? "") === "failed" ? "error" : "success") : "running",
          result: files,
        },
      });
      return;
    }

    if (itemType === "mcp_tool_call") {
      const result = item.result as { isError?: boolean; is_error?: boolean; content?: unknown } | undefined;
      const completed = type === "item.completed";
      const failed = item.error != null || item.status === "failed" || result?.isError === true || result?.is_error === true;
      const toolName = String(item.tool ?? item.name ?? "");
      const toolId = item.server === "markdirector" ? `canvas-cli:${id}` : id;
      send({
        type: "tool", blockId: `tool:${toolId}`,
        tool: {
          id: toolId, name: toolName,
          args: (item.arguments ?? {}) as Record<string, unknown>,
          status: completed ? (failed || result == null ? "error" : "success") : "running",
          result: completed ? JSON.stringify(item.error ?? result?.content ?? result ?? "工具未返回结果").slice(0, 20000) : undefined,
        },
      });
      return;
    }

    if (itemType === "error" && !text) {
      const message = String(item.message ?? "");
      if (message) send({ type: "cliStatus", message: message.split("\n")[0]!.slice(0, 200) });
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // 非 JSON 行忽略。
      }
      if (settled) return;
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderrTail = (stderrTail + chunk).slice(-4000); });

  child.on("error", (error: NodeJS.ErrnoException) => {
    fail(error.code === "ENOENT" ? `找不到可执行文件：${launch.command}` : error.message);
  });

  child.on("close", code => {
    if (settled) return;
    const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
    fail(tail || `Codex 退出（code=${code}），未返回内容`);
  });

  return finished.promise;
}
