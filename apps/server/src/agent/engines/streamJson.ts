import { spawn } from "node:child_process";
import type { AgentEvent } from "@/agent/runtime/types";
import type { CliEngineId, CliLaunch } from "./types";
import { CliEngineError } from "./types";

/**
 * Claude Code 兼容的 stream-json 传输（Claude Code / CodeBuddy 共用）。
 *
 * 实测确定的契约（2026-11，WorkBuddy 2.176 / Claude Code 2.1）：
 *  - prompt 必须走命令行 `-p "…"`；`--input-format stream-json` 需要完整双向握手，
 *    首包字段不全时进程会静默等 stdin，表现为「一点回应都没有」。
 *  - CodeBuddy 必须带 `--port 0`：WorkBuddy 桌面自带 `codebuddy --serve` 占着固定端口，
 *    子进程不指定端口会在首个 token 前 `listen EADDRINUSE` 秒退。
 *  - 逐行 JSON 事件：system(init/status) / ai-title / assistant / user(tool_result) /
 *    stream_event(增量) / result(本回合结束)。
 */

export type StreamJsonRunInput = {
  engineId: CliEngineId;
  launch: CliLaunch;
  cwd: string;
  signal: AbortSignal;
  send: (event: AgentEvent) => void;
  /** 子进程启动到首条输出的等待上限。实测 init 约 9-12 秒，60 秒足够，超时即报错而不是静默卡住。 */
  firstOutputTimeoutMs?: number;
  /** 有输出后单次静默上限。 */
  idleTimeoutMs?: number;
};

export type StreamJsonResult = {
  sessionId?: string;
  model?: string;
  text: string;
  stopped: boolean;
};

type AssistantContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: string; [key: string]: unknown };

/** 这些环境键会造成 CLI 初始化卡死，启动前清空。 */
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function buildEnv(launch: CliLaunch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...launch.env };
  // registry 里用空串表示「显式删除」，避免平台注入的大小写重复代理变量把 CLI 网络层卡住。
  for (const [key, value] of Object.entries(launch.env)) {
    if (value === "" || value === undefined) delete env[key];
  }
  for (const key of PROXY_KEYS) {
    if (!(key in launch.env)) delete env[key];
  }
  return env;
}

export async function runStreamJson(input: StreamJsonRunInput): Promise<StreamJsonResult> {
  const { engineId, launch, cwd, signal, send } = input;
  const firstOutputTimeoutMs = input.firstOutputTimeoutMs ?? 60_000;
  const idleTimeoutMs = input.idleTimeoutMs ?? 5 * 60_000;

  if (signal.aborted) throw new DOMException("已停止生成", "AbortError");

  const result: StreamJsonResult = { text: "", stopped: false };
  const toolBlocks = new Map<string, string>();
  let messageIndex = 0;
  let buffer = "";
  let stderrTail = "";
  let settled = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let firstTimer: NodeJS.Timeout | undefined;
  let decodeChars = 0;
  const startedAt = Date.now();

  const finished = Promise.withResolvers<StreamJsonResult>();

  const cleanup = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    signal.removeEventListener("abort", onAbort);
  };

  const child = spawn(launch.command, launch.args, {
    cwd,
    env: buildEnv(launch),
    // stdin 保持 ignore：prompt 走命令行，CLI 不会因等输入而挂住。
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  function fail(error: Error) {
    if (settled) return;
    settled = true;
    cleanup();
    try { child.kill(); } catch { /* 进程可能已退出 */ }
    finished.reject(error);
  }

  function succeed() {
    if (settled) return;
    settled = true;
    cleanup();
    finished.resolve(result);
  }

  const onAbort = () => {
    result.stopped = true;
    if (settled) return;
    settled = true;
    cleanup();
    try { child.kill(); } catch { /* 忽略 */ }
    finished.reject(new DOMException("已停止生成", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const touch = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => fail(new CliEngineError(`引擎 ${Math.round(idleTimeoutMs / 1000)} 秒无新输出，已终止`, engineId, "可重发一次；若反复出现请换个模型试试")),
      idleTimeoutMs,
    );
  };

  firstTimer = setTimeout(() => {
    const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-4).join(" | ");
    fail(new CliEngineError(
      `${engineId} 启动 ${Math.round(firstOutputTimeoutMs / 1000)} 秒没有任何输出`,
      engineId,
      tail || "该 CLI 可能卡在初始化，请确认已登录、且在终端能独立运行",
    ));
  }, firstOutputTimeoutMs);

  const emitText = (blockId: string, delta: string) => {
    decodeChars += delta.length;
    result.text += delta;
    send({ type: "text", blockId, delta });
  };

  const handleMessage = (msg: Record<string, unknown>) => {
    const type = msg.type as string | undefined;

    if (type === "system" && msg.subtype === "init") {
      if (typeof msg.session_id === "string") result.sessionId = msg.session_id;
      if (typeof msg.model === "string") result.model = msg.model;
      return;
    }

    // ai-title / status / 计费提示等不产生正文，但已由 touch 证明进程活着。
    if (type === "system" || type === "ai-title" || type === "rate_limit_event") return;

    if (type === "stream_event") {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) return;
      const index = typeof event.index === "number" ? event.index : 0;
      const blockId = `${messageIndex}:${index}`;
      if (event.type === "content_block_start") {
        const block = event.content_block as AssistantContent | undefined;
        if (block?.type === "text") send({ type: "text", blockId, content: "" });
        if (block?.type === "thinking") send({ type: "thinking", blockId, content: "" });
        if (block?.type === "tool_use") {
          const tool = block as { id: string; name: string };
          toolBlocks.set(tool.id, blockId);
          send({ type: "tool", blockId, tool: { id: tool.id, name: tool.name, args: {}, status: "running" } });
        }
        return;
      }
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") emitText(blockId, delta.text);
        else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          send({ type: "thinking", blockId, delta: delta.thinking });
        }
        return;
      }
      if (event.type === "message_start") { messageIndex++; return; }
        return;
    }

    if (type === "assistant") {
      const message = msg.message as { content?: AssistantContent[]; usage?: Record<string, number> } | undefined;
      messageIndex++;
      for (const [index, block] of (message?.content ?? []).entries()) {
        const blockId = `${messageIndex}:${index}`;
        if (block.type === "text" && typeof (block as { text?: string }).text === "string") {
          const text = (block as { text: string }).text;
          // 增量模式下正文已推送；这里只补漏掉的整段，避免重复。
          if (text && !result.text.includes(text)) {
            decodeChars += text.length;
            result.text += text;
            send({ type: "text", blockId, content: text });
          }
          send({ type: "text", blockId, content: text, done: true });
        } else if (block.type === "thinking") {
          send({ type: "thinking", blockId, content: (block as { thinking?: string }).thinking ?? "", done: true });
        } else if (block.type === "tool_use") {
          const tool = block as { id: string; name: string; input?: unknown };
          toolBlocks.set(tool.id, blockId);
          send({ type: "tool", blockId, tool: { id: tool.id, name: tool.name, args: (tool.input ?? {}) as Record<string, unknown>, status: "running" } });
        }
      }
      const usage = message?.usage;
      if (usage) {
        send({
          type: "stats",
          stats: {
            tokens: {
              input: usage.input_tokens ?? 0,
              output: usage.output_tokens ?? 0,
              cacheRead: usage.cache_read_input_tokens ?? 0,
              cacheWrite: usage.cache_creation_input_tokens ?? 0,
              total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            },
          },
        });
      }
      return;
    }

    if (type === "user") {
      const message = msg.message as { content?: Array<Record<string, unknown>> } | undefined;
      for (const part of message?.content ?? []) {
        if (part.type !== "tool_result") continue;
        const id = String(part.tool_use_id ?? "");
        const content = Array.isArray(part.content)
          ? part.content.map(item => (item as { text?: string }).text ?? "").join("")
          : typeof part.content === "string" ? part.content : "";
        send({
          type: "tool",
          blockId: toolBlocks.get(id) ?? id,
          tool: { id, name: "", status: part.is_error ? "error" : "success", result: content.slice(0, 20000) },
        });
      }
      return;
    }

    if (type === "result") {
      if (typeof msg.session_id === "string") result.sessionId = msg.session_id;
      const text = typeof msg.result === "string" ? msg.result : "";
      if (text && !result.text.trim()) {
        result.text = text;
        send({ type: "text", blockId: "1:0", content: text, done: true });
      }
      const usage = msg.usage as Record<string, number> | undefined;
      send({
        type: "stats",
        stats: {
          tokens: {
            input: usage?.input_tokens ?? 0,
            output: usage?.output_tokens ?? 0,
            cacheRead: usage?.cache_read_input_tokens ?? 0,
            cacheWrite: usage?.cache_creation_input_tokens ?? 0,
            total: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
          },
        },
      });
      if (msg.is_error) {
        const reason = String(msg.result ?? "").trim() || "引擎返回错误";
        if (/not logged in|authentication|unauthorized|401|api key/i.test(reason)) {
          fail(new CliEngineError(reason, engineId, "请在终端运行该 CLI 完成登录后重试"));
        } else {
          fail(new CliEngineError(reason, engineId));
        }
        return;
      }
      succeed();
      return;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    touch();
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        handleMessage(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // CLI 偶尔输出非 JSON 行（进度条、警告），忽略不影响协议。
      }
      if (settled) return;
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  child.on("error", (error: NodeJS.ErrnoException) => {
    fail(new CliEngineError(
      error.code === "ENOENT" ? `找不到可执行文件：${launch.command}` : error.message,
      engineId,
      error.code === "ENOENT" ? "请确认该 CLI 已安装并在 PATH 中" : undefined,
    ));
  });

  child.on("close", (code, signalName) => {
    if (settled) return;
    // 正常退出但没收到 result：多半是初始化失败，把 stderr 尾部作为原因。
    const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-4).join(" | ");
    if (code === 0 && result.text.trim()) { succeed(); return; }
    const hint = /EADDRINUSE/i.test(tail)
      ? "端口被 WorkBuddy 占用，请确认已传入 --port 0"
      : /instanceof is not callable|fetch config/i.test(tail)
        ? "该 CLI 需要桌面应用上下文，独立进程不可用"
        : /not logged in|login/i.test(tail) ? "请先在终端运行该 CLI 完成登录" : undefined;
    fail(new CliEngineError(
      tail || `引擎退出（code=${code}${signalName ? `, signal=${signalName}` : ""}），未返回结果`,
      engineId,
      hint,
    ));
  });

  touch();
  return finished.promise;
}
