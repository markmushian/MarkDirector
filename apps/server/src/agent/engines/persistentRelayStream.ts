import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@/agent/runtime/types";
import type { CliEngineId, CliLaunch } from "./types";
import { CliEngineError } from "./types";

/**
 * 常驻 stream-json 传输（文件中继版）。
 *
 * 背景：桌面版是 bun 编译的单文件宿主。实测在 bun 进程树下把 CLI 的 stdout 接成 pipe，
 * 写端会永久卡在背压——CLI 自己的日志显示模型已返回、
 * `StreamJsonView turn complete, final result sent to client`，宿主却一个字节都收不到，
 * 界面永远停在「正在思考」，CLI 进程 CPU 长时间接近 0。
 *
 * 对照实验（同一 CLI、同一参数、同一 cwd，只换宿主）：
 *   node 宿主 → 直接 spawn CLI（pipe）        13793 B，含 text_delta / result
 *   node 宿主 → worker 中转 → CLI（pipe）      13793 B ✓
 *   bun  宿主 → worker 中转 → CLI（pipe）      0 B ✗
 *   bun  宿主 → worker 中转 → CLI（写文件）    13800 B ✓
 *
 * 所以 CLI 的 stdout/stderr 直接写入文件，宿主轮询增量读取，绕开 pipe。
 *
 * 启动配置走**环境变量**而不是 stdin 首行：编译后的 bun 宿主里 child.stdin 可能不可用，
 * 走 stdin 传配置会让 worker 一直等首行、CLI 永远不启动。环境变量里的内容全是 ASCII
 * 路径与英文参数，规避中文编码风险。
 *
 * 其他约束（实测）：`-p` 后不跟 prompt；prompt 作为 stream-json 用户消息写 stdin；
 * stdin 写入后不能 end；环境必须整份继承（代理是沙箱网络出口）。
 */

const WORKER_SOURCE = `import { spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";
const NL = String.fromCharCode(10);
const DBG = process.env.MD_RELAY_DEBUG || "";
const dbg = (m) => { if (DBG) { try { appendFileSync(DBG, Date.now() + " " + m + NL); } catch {} } };
dbg("boot");
let req;
try { req = JSON.parse(process.env.MD_RELAY_CONFIG || "{}"); }
catch (error) { dbg("config parse fail " + error.message); process.exit(2); }
dbg("config out=" + req.out);
let outFd, errFd;
try { outFd = openSync(req.out, "a"); errFd = openSync(req.err, "a"); }
catch (error) { dbg("open fail " + error.message); process.exit(3); }
dbg("fds ok");
const child = spawn(req.command, req.args, {
  env: process.env,
  stdio: ["pipe", outFd, errFd],
  windowsHide: true,
});
dbg("spawned " + child.pid);
child.on("error", (error) => { dbg("child error " + error.message); process.exit(4); });
child.on("exit", (code) => { dbg("child exit " + code); process.exit(code === null ? 0 : code); });
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  dbg("stdin " + chunk.length);
  buf += chunk;
  let i;
  while ((i = buf.indexOf(NL)) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { child.stdin.write(line + NL); dbg("fwd " + line.length); }
    catch (error) { dbg("fwd fail " + error.message); }
  }
});
dbg("ready");
`;

const IDLE_KEEP_MS = 10 * 60_000;
/** 中继文件轮询间隔。100ms 对打字机效果足够。 */
const POLL_MS = 100;
const MAX_READ = 2_000_000;

export type PersistentRunInput = {
  engineId: CliEngineId;
  key: string;
  launch: CliLaunch;
  prompt: string;
  cwd: string;
  signal: AbortSignal;
  send: (event: AgentEvent) => void;
  firstOutputTimeoutMs?: number;
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
  child: ReturnType<typeof spawn>;
  stdin: NodeJS.WritableStream;
  buffer: string;
  stderrTail: string;
  sessionId?: string;
  model?: string;
  turn: Turn | null;
  dead: boolean;
  idleTimer?: NodeJS.Timeout;
  onOutput?: () => void;
  stdoutNoise: number;
  stderrLines: number;
  outPath: string;
  errPath: string;
  outPos: number;
  errPos: number;
  pollTimer?: NodeJS.Timeout;
};

const sessions = new Map<string, Session>();

function buildEnv(launch: CliLaunch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["https_proxy", "http_proxy", "all_proxy", "no_proxy"]) delete env[key];
  for (const [key, value] of Object.entries(launch.env)) {
    if (value === "" || value === undefined) continue;
    env[key] = value;
  }
  return env;
}

function cliDir(): string {
  const dir = join(tmpdir(), "markdirector-cli");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function sweepOldFiles(dir: string, keepWorker: string): void {
  const now = Date.now();
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const managed = /^(out|err|relay-debug)-.*\.(log|txt)$/.test(name) || /^cli-relay-.*\.mjs$/.test(name);
    if (!managed) continue;
    const path = join(dir, name);
    if (isWorkerPath(path, keepWorker)) continue;
    try {
      if (now - statSync(path).mtimeMs > 3_600_000) unlinkSync(path);
    } catch {}
  }
}

function isWorkerPath(path: string, keep: string): boolean {
  return path === keep;
}

/** worker 文件名带内容哈希：内容变化就换新文件，避开「已存在文件不能覆盖」的写入限制。 */
function ensureWorkerFile(dir: string): string {
  const hash = createHash("sha256").update(WORKER_SOURCE).digest("hex").slice(0, 10);
  const file = join(dir, `cli-relay-${hash}.mjs`);
  if (!existsSync(file)) {
    try { writeFileSync(file, WORKER_SOURCE, "utf8"); } catch {}
  }
  return file;
}

function killSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.dead = true;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (session.pollTimer) clearInterval(session.pollTimer);
  try { session.child.kill(); } catch {}
  for (const path of [session.outPath, session.errPath]) {
    try { unlinkSync(path); } catch {}
  }
  if (session.turn && !session.turn.settled) {
    session.turn.settled = true;
    session.turn.cleanup();
    session.turn.reject(new CliEngineError("引擎进程已回收", session.engineId, "请重新发送一次"));
  }
  session.turn = null;
}

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

/**
 * 从 pos 起读新增内容。只返回「最后一个换行符之前」的字节：未写完的半行留到下次，
 * 既不会把 UTF-8 多字节字符切成半个，也不会让 JSON 解析看到截断的行。
 */
function readNew(path: string, pos: number): { text: string; next: number } {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (size <= pos) return { text: "", next: pos };
    const length = Math.min(size - pos, MAX_READ);
    const raw = Buffer.allocUnsafe(length);
    const read = readSync(fd, raw, 0, length, pos);
    if (read <= 0) return { text: "", next: pos };
    const usable = raw.subarray(0, read);
    const lastNewline = usable.lastIndexOf(0x0a);
    if (lastNewline < 0) return { text: "", next: pos };
    return { text: usable.subarray(0, lastNewline + 1).toString("utf8"), next: pos + lastNewline + 1 };
  } catch {
    return { text: "", next: pos };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
  }
}

function startPolling(session: Session): void {
  session.pollTimer = setInterval(() => {
    if (session.dead) return;

    const out = readNew(session.outPath, session.outPos);
    if (out.text) {
      session.outPos = out.next;
      session.onOutput?.();
      session.buffer += out.text;
      let index: number;
      while ((index = session.buffer.indexOf("\n")) >= 0) {
        const line = session.buffer.slice(0, index).trim();
        session.buffer = session.buffer.slice(index + 1);
        if (!line) continue;
        try {
          handleMessage(session, JSON.parse(line) as Record<string, unknown>);
        } catch {
          const turn = session.turn;
          if (turn && !turn.settled && !turn.result.text && session.stdoutNoise < 3) {
            session.stdoutNoise++;
            turn.send({ type: "status", message: line.slice(0, 300) } as unknown as AgentEvent);
          }
        }
      }
    }

    const err = readNew(session.errPath, session.errPos);
    if (err.text) {
      session.errPos = err.next;
      session.stderrTail = (session.stderrTail + err.text).slice(-8000);
      const turn = session.turn;
      if (turn && !turn.settled && !turn.result.text && session.stderrLines < 6) {
        for (const line of err.text.split("\n").map(l => l.trim()).filter(Boolean)) {
          if (session.stderrLines >= 6) break;
          session.stderrLines++;
          turn.send({ type: "status", message: line.slice(0, 300) } as unknown as AgentEvent);
        }
      }
    }
  }, POLL_MS);
}

function createSession(input: PersistentRunInput): Session {
  const dir = cliDir();
  const worker = ensureWorkerFile(dir);
  sweepOldFiles(dir, worker);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outPath = join(dir, `out-${stamp}.log`);
  const errPath = join(dir, `err-${stamp}.log`);
  const debugPath = join(dir, `relay-debug-${stamp}.txt`);

  const child = spawn(input.launch.command, [worker], {
    cwd: input.cwd,
    env: {
      ...buildEnv(input.launch),
      MD_RELAY_CONFIG: JSON.stringify({ command: input.launch.command, args: input.launch.args, out: outPath, err: errPath }),
      MD_RELAY_DEBUG: debugPath,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdin = (child.stdin ?? (child.stdio?.[0] as NodeJS.WritableStream | null | undefined)) ?? null;
  console.log(`[cli-launch] pid=${child.pid} model=${input.launch.args.join(" ").match(/--model\s+(\S+)/)?.[1] ?? "default"} stdin=${stdin ? "ok" : "null"} relay=${outPath}`);

  const session: Session = {
    key: input.key,
    engineId: input.engineId,
    child,
    stdin: (stdin ?? { write: () => false }) as NodeJS.WritableStream,
    buffer: "",
    stderrTail: "",
    turn: null,
    dead: false,
    stdoutNoise: 0,
    stderrLines: 0,
    outPath,
    errPath,
    outPos: 0,
    errPos: 0,
  };

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    session.stderrTail = (session.stderrTail + chunk).slice(-8000);
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
    if (session.pollTimer) clearInterval(session.pollTimer);
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

  startPolling(session);
  sessions.set(input.key, session);
  return session;
}

export async function runPersistentStreamJson(input: PersistentRunInput): Promise<PersistentRunResult> {
  if (input.signal.aborted) throw new DOMException("已停止生成", "AbortError");
  const firstOutputTimeoutMs = input.firstOutputTimeoutMs ?? 60_000;
  const idleTimeoutMs = input.idleTimeoutMs ?? 90_000;

  let session = sessions.get(input.key);
  if (!session || session.dead) session = createSession(input);
  if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = undefined; }
  if (session.turn) {
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

  input.send({ type: "session", file: `cli-${input.engineId}.jsonl`, runId: crypto.randomUUID() });

  firstTimer = setTimeout(() => {
    const tail = session?.stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
    fail(new CliEngineError(
      `${input.engineId} 本轮 ${Math.round(firstOutputTimeoutMs / 1000)} 秒没有任何输出`,
      input.engineId,
      tail || "CLI 已启动但没有产生任何输出。可点「新对话」重开一个进程再试。",
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

  try {
    session.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: input.prompt } })}\n`);
  } catch (error) {
    fail(new CliEngineError(error instanceof Error ? error.message : "写入引擎 stdin 失败", input.engineId));
  }

  return finished.promise;
}
