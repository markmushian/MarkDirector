import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@/agent/runtime/types";
import type { CliEngineId, CliLaunch } from "./types";
import { CliEngineError } from "./types";

/**
 * CodeBuddy / WorkBuddy 用的「长驻 stream-json」传输。
 *
 * 与 streamJson.ts 的关键差别（2026-11 实测，对照 markbot 的 claudeAgent driver）：
 *  - `-p` 后面**不跟 prompt**；prompt 必须作为 stream-json 用户消息写进 stdin。
 *    命令行传 prompt 会走进 lite bundle 的另一条初始化分支，必崩在
 *    `fetch config failed → setProxy: instanceof is not callable`。
 *  - 必须带 `--input-format stream-json`，否则 stdin 不被解析。
 *  - stdin 写完**不能 end**：结束流会让进程当作「没有下一轮」而不再输出；
 *    保持管道打开才能多轮对话，且上下文天然留在同一会话里。
 *  - `--resume` 在该 bundle 上会静默卡死（0 事件），所以多轮只靠进程常驻，
 *    不靠 session id 续接；进程被回收后用新会话重开。
 */

/**
 * CLI 中继 worker（node 脚本）。
 *
 * 为什么需要它：宿主（bun 主进程，桌面版 electrobun 也是 bun）直接 spawn node 时，
 * codebuddy-lite 拿到的标准句柄与独立终端里不同，会卡在自身初始化（事件循环阻塞数十秒、
 * 一个事件都不发）。让 node 再起一层来 spawn 就完全正常——实测 12 秒返回。
 *
 * 协议：第一行是启动配置 {command,args,cwd}；之后的每一行原样转发给 CLI 的 stdin，
 * 因此同一个 worker 可以承载多轮对话，上下文留在 CLI 进程里。
 */
const WORKER_SOURCE = `import { spawn } from "node:child_process";
let buf = "";
let child = null;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    if (!child) {
      const req = JSON.parse(line);
      child = spawn(req.command, req.args, {
        cwd: req.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.on("error", (error) => {
        process.stderr.write("[cli-worker] " + error.message + "\\n");
        process.exit(1);
      });
      child.on("exit", (code) => process.exit(code ?? 0));
    } else {
      try { child.stdin.write(line + "\\n"); } catch { /* 子进程已退出 */ }
    }
  }
});
process.stdin.on("end", () => { if (child) { try { child.stdin.end(); } catch { /* 忽略 */ } } });
`;

let workerPath: string | undefined;
function ensureWorkerFile(): string {
  if (workerPath && existsSync(workerPath)) return workerPath;
  const dir = join(tmpdir(), "markdirector-cli");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "cli-worker.mjs");
  writeFileSync(file, WORKER_SOURCE, "utf8");
  workerPath = file;
  return file;
}

const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
/** 一轮结束后进程闲置多久自动回收，避免长期占内存。 */
const IDLE_KEEP_MS = 10 * 60_000;

export type PersistentRunInput = {
  engineId: CliEngineId;
  /** 会话键：同键复用同一进程（cwd + 引擎 + 模型 + MCP 配置）。 */
  key: string;
  launch: CliLaunch;
  prompt: string;
  cwd: string;
  signal: AbortSignal;
  send: (event: AgentEvent) => void;
  /** 本轮首条输出的等待上限。 */
  firstOutputTimeoutMs?: number;
  /** 首条输出之后的静默上限。 */
  idleTimeoutMs?: number;
};

export type PersistentRunResult = {
  sessionId?: string;
  model?: string;
  text: string;
  stopped: boolean;
};

type Turn = {
  send: (event: AgentEvent) => void;
  result: PersistentRunResult;
  messageIndex: number;
  toolBlocks: Map<string, string>;
  settled: boolean;
  resolve: (value: PersistentRunResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

type Session = {
  key: string;
  engineId: CliEngineId;
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  stderrTail: string;
  sessionId?: string;
  model?: string;
  turn: Turn | null;
  dead: boolean;
  idleTimer?: NodeJS.Timeout;
  /** 每收到一段 stdout 时通知当前轮重置超时计时。 */
  onOutput?: () => void;
  /** 已回传的非 JSON stdout 行数，用于限流。 */
  stdoutNoise: number;
};

const sessions = new Map<string, Session>();

/**
 * 环境处理（实测结论，2026-11）：
 *  - 必须整份继承 process.env。WorkBuddy 的 HTTP_PROXY/HTTPS_PROXY 指向本地代理（如 127.0.0.1:61200），
 *    那是沙箱的网络出口；把它删掉 CLI 就连不上模型，表现为「进程活着、stderr 空、0 事件」，
 *    看起来像卡死，其实是在等一个永远连不通的请求。
 *  - 只删小写重复变体，避免同一份代理配置被读两遍（大小写键同时存在时 CLI 网络层会混乱）。
 *  - 引擎自己的 env 里空串表示「不要覆盖」，不再当作删除指令。
 */
function buildEnv(launch: CliLaunch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["https_proxy", "http_proxy", "all_proxy", "no_proxy"]) delete env[key];
  for (const [key, value] of Object.entries(launch.env)) {
    if (value === "" || value === undefined) continue;
    env[key] = value;
  }
  return env;
}

function killSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.dead = true;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  try { session.child.kill(); } catch { /* 可能已退出 */ }
  if (session.turn && !session.turn.settled) {
    session.turn.settled = true;
    session.turn.cleanup();
    session.turn.reject(new CliEngineError("引擎进程已回收", session.engineId, "请重新发送一次"));
  }
  session.turn = null;
}

/** 前端点「新对话」/ 切模型时清掉对应进程。 */
export function disposePersistentSession(key: string): void {
  killSession(key);
}

export function disposeAllPersistentSessions(): void {
  for (const key of [...sessions.keys()]) killSession(key);
}

function emitText(turn: Turn, blockId: string, delta: string): void {
  turn.result.text += delta;
  turn.send({ type: "text", blockId, delta });
}

function handleMessage(session: Session, msg: Record<string, unknown>): void {
  const turn = session.turn;
  const type = msg.type as string | undefined;

  if (type === "system" && msg.subtype === "init") {
    if (typeof msg.session_id === "string") { session.sessionId = msg.session_id; if (turn) turn.result.sessionId = msg.session_id; }
    if (typeof msg.model === "string") { session.model = msg.model; if (turn) turn.result.model = msg.model; }
    return;
  }
  if (type === "system" || type === "ai-title" || type === "rate_limit_event") return;

  if (!turn || turn.settled) return;

  if (type === "stream_event") {
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event) return;
    const index = typeof event.index === "number" ? event.index : 0;
    const blockId = `${turn.messageIndex}:${index}`;
    if (event.type === "content_block_start") {
      const block = event.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (block?.type === "text") turn.send({ type: "text", blockId, content: "" });
      if (block?.type === "thinking") turn.send({ type: "thinking", blockId, content: "" });
      if (block?.type === "tool_use" && block.id && block.name) {
        turn.toolBlocks.set(block.id, blockId);
        turn.send({ type: "tool", blockId, tool: { id: block.id, name: block.name, args: {}, status: "running" } });
      }
      return;
    }
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") emitText(turn, blockId, delta.text);
      else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        turn.send({ type: "thinking", blockId, delta: delta.thinking });
      }
      return;
    }
    if (event.type === "message_start") { turn.messageIndex++; return; }
    if (event.type === "message_stop") {
      turn.send({ type: "text", blockId: `${Math.max(turn.messageIndex, 1)}:0`, content: "", done: true });
      return;
    }
    return;
  }

  if (type === "assistant") {
    const message = msg.message as { content?: Array<Record<string, unknown>>; usage?: Record<string, number> } | undefined;
    turn.messageIndex++;
    for (const [index, block] of (message?.content ?? []).entries()) {
      const blockId = `${turn.messageIndex}:${index}`;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text;
        if (text && !turn.result.text.includes(text)) emitText(turn, blockId, text);
        turn.send({ type: "text", blockId, content: text, done: true });
      } else if (block.type === "thinking") {
        turn.send({ type: "thinking", blockId, content: typeof block.thinking === "string" ? block.thinking : "", done: true });
      } else if (block.type === "tool_use") {
        const id = String(block.id ?? "");
        turn.toolBlocks.set(id, blockId);
        turn.send({ type: "tool", blockId, tool: { id, name: String(block.name ?? ""), args: (block.input ?? {}) as Record<string, unknown>, status: "running" } });
      }
    }
    const usage = message?.usage;
    if (usage) {
      turn.send({
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
        ? part.content.map(item => String((item as { text?: string }).text ?? "")).join("")
        : typeof part.content === "string" ? part.content : "";
      turn.send({
        type: "tool",
        blockId: turn.toolBlocks.get(id) ?? id,
        tool: { id, name: "", status: part.is_error ? "error" : "success", result: content.slice(0, 20000) },
      });
    }
    return;
  }

  if (type === "result") {
    if (typeof msg.session_id === "string") { session.sessionId = msg.session_id; turn.result.sessionId = msg.session_id; }
    const text = typeof msg.result === "string" ? msg.result : "";
    if (text && !turn.result.text.trim()) {
      turn.result.text = text;
      turn.send({ type: "text", blockId: "1:0", content: text, done: true });
    }
    const usage = msg.usage as Record<string, number> | undefined;
    turn.send({
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
      const hint = /not logged in|authentication|unauthorized|401|api key/i.test(reason)
        ? "请先在 WorkBuddy 桌面里登录对应账号再重试"
        : undefined;
      turn.settled = true;
      turn.cleanup();
      killSession(session.key);
      turn.reject(new CliEngineError(reason, session.engineId, hint));
      return;
    }
    turn.settled = true;
    turn.cleanup();
    session.turn = null;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      const live = sessions.get(session.key);
      if (live && !live.turn) killSession(session.key);
    }, IDLE_KEEP_MS);
    session.idleTimer.unref?.();
    turn.resolve(turn.result);
    return;
  }
}

function createSession(input: PersistentRunInput): Session {
  // 经 node worker 中转启动（见 WORKER_SOURCE 注释）：直接 spawn 会让 CLI 卡在自身初始化。
  const worker = ensureWorkerFile();
  const command = input.launch.command;
  const args = [worker];

  const child = spawn(command, args, {
    cwd: input.cwd,
    env: buildEnv(input.launch),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  // 第一行：worker 用它启动 CLI，后续行才是对话消息。
  child.stdin.write(`${JSON.stringify({ command: input.launch.command, args: input.launch.args, cwd: input.cwd })}\n`);
  console.log(`[cli-launch] pid=${child.pid} model=${input.launch.args.join(" ").match(/--model\s+(\S+)/)?.[1] ?? "default"} cwd=${input.cwd}`);

  const session: Session = {
    key: input.key,
    engineId: input.engineId,
    child,
    buffer: "",
    stderrTail: "",
    turn: null,
    dead: false,
    stdoutNoise: 0,
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    session.onOutput?.();
    session.buffer += chunk;
    let index: number;
    while ((index = session.buffer.indexOf("\n")) >= 0) {
      const line = session.buffer.slice(0, index).trim();
      session.buffer = session.buffer.slice(index + 1);
      if (!line) continue;
      try {
        handleMessage(session, JSON.parse(line) as Record<string, unknown>);
      } catch {
        // 非 JSON 行（进度、警告、错误堆栈）也可能有价值，首轮时回传给前端。
        const turn = session.turn;
        if (turn && !turn.settled && !turn.result.text && session.stdoutNoise < 3) {
          session.stdoutNoise++;
          turn.send({ type: "status", message: line.slice(0, 300) } as unknown as AgentEvent);
        }
      }
    }
  });

  let stderrLines = 0;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    session.stderrTail = (session.stderrTail + chunk).slice(-8000);
    const turn = session.turn;
    if (turn && !turn.settled && !turn.result.text && stderrLines < 6) {
      for (const line of String(chunk).split("\n").map(l => l.trim()).filter(Boolean)) {
        if (stderrLines >= 6) break;
        stderrLines++;
        turn.send({ type: "status", message: line.slice(0, 300) } as unknown as AgentEvent);
      }
    }
  });

  child.on("error", (error: NodeJS.ErrnoException) => {
    console.log(`[cli-error] pid=${child.pid} ${error.code} ${error.message}`);
    const turn = session.turn;
    if (turn && !turn.settled) {
      turn.settled = true;
      turn.cleanup();
      turn.reject(new CliEngineError(
        error.code === "ENOENT" ? `找不到可执行文件：${input.launch.command}` : error.message,
        input.engineId,
      ));
    }
    killSession(session.key);
  });

  child.on("exit", (code, signalName) => {
    if (code !== 0 && !session.turn?.result.text) {
      console.warn(`[cli-exit] pid=${child.pid} code=${code} signal=${signalName} stderr=${session.stderrTail.slice(-400)}`);
    }
    const live = sessions.get(session.key);
    if (live === session) sessions.delete(session.key);
    session.dead = true;
    const turn = session.turn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    turn.cleanup();
    if (turn.result.text.trim()) { turn.resolve(turn.result); return; }
    const tail = session.stderrTail.trim().split("\n").filter(Boolean).slice(-12).join(" | ");
    const hint = /instanceof is not callable|fetch config/i.test(tail)
      ? "缺少 --port 0 或 --input-format stream-json，CLI 走了桌面专用初始化分支"
      : /EADDRINUSE/i.test(tail) ? "端口被 WorkBuddy 占用，需要 --port 0"
        : /not logged in|login/i.test(tail) ? "请先在 WorkBuddy 桌面登录" : undefined;
    turn.reject(new CliEngineError(
      tail || `引擎退出（code=${code}${signalName ? `, signal=${signalName}` : ""}），未返回结果`,
      session.engineId,
      hint,
    ));
  });

  sessions.set(input.key, session);
  return session;
}

export async function runPersistentStreamJson(input: PersistentRunInput): Promise<PersistentRunResult> {
  if (input.signal.aborted) throw new DOMException("已停止生成", "AbortError");
  const firstOutputTimeoutMs = input.firstOutputTimeoutMs ?? 60_000;
  // 5 分钟太长：卡住时用户只能对着「正在思考」干等。工具调用会让事件断断续续，
  // 所以 90 秒没有新事件基本就是模型在空转或网关没响应，直接报错让用户看到原因。
  const idleTimeoutMs = input.idleTimeoutMs ?? 90_000;

  let session = sessions.get(input.key);
  if (!session || session.dead) session = createSession(input);
  if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = undefined; }
  if (session.turn) {
    // 同一会话上一轮还没结束：直接换新进程，避免消息串在一起。
    killSession(input.key);
    session = createSession(input);
  }

  const finished = Promise.withResolvers<PersistentRunResult>();
  let firstTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;

  const cleanupTimers = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    input.signal.removeEventListener("abort", onAbort);
  };

  const turn: Turn = {
    send: input.send,
    result: { text: "", stopped: false },
    messageIndex: 0,
    toolBlocks: new Map(),
    settled: false,
    resolve: finished.resolve,
    reject: finished.reject,
    cleanup: cleanupTimers,
  };

  const fail = (error: Error) => {
    if (turn.settled) return;
    turn.settled = true;
    cleanupTimers();
    killSession(input.key);
    finished.reject(error);
  };

  const onAbort = () => {
    turn.result.stopped = true;
    fail(new DOMException("已停止生成", "AbortError"));
  };
  input.signal.addEventListener("abort", onAbort, { once: true });

  // 先给前端会话锚点，避免长驻进程预热期间界面空白。
  input.send({ type: "session", file: `cli-${input.engineId}.jsonl`, runId: crypto.randomUUID() });

  firstTimer = setTimeout(() => {
    const tail = session?.stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
    fail(new CliEngineError(
      `${input.engineId} 本轮 ${Math.round(firstOutputTimeoutMs / 1000)} 秒没有任何输出`,
      input.engineId,
      tail || "CLI 已启动但被卡在初始化。若在桌面版里仍复现，请把这条信息发给 Mark：codebuddy-lite 在当前进程树里无法完成自身 sandbox 初始化。",
    ));
  }, firstOutputTimeoutMs);

  const touchIdle = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = undefined; }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => fail(new CliEngineError(`引擎 ${Math.round(idleTimeoutMs / 1000)} 秒无新输出，已终止`, input.engineId, "可重发一次")),
      idleTimeoutMs,
    );
  };

  session.stdoutNoise = 0;
  session.turn = turn;
  session.onOutput = () => { if (!turn.settled) touchIdle(); };
  const originalCleanup = turn.cleanup;
  turn.cleanup = () => {
    if (session) session.onOutput = undefined;
    originalCleanup();
  };

  // 一条 user 消息一行 JSON 写进 stdin，**不关闭管道**：管道保持打开，CLI 才会在同一进程里接着
  // 收下一轮（上下文自然保留）。写入用 write 而非 end，多轮靠常驻进程实现。
  try {
    session.child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: input.prompt } })}\n`);
  } catch (error) {
    fail(new CliEngineError(error instanceof Error ? error.message : "写入引擎 stdin 失败", input.engineId));
  }

  return finished.promise;
}
