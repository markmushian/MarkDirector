import type { AgentEvent } from "@/agent/runtime/types";
import type { CliEngineId, CliLaunch } from "./types";
import { CliEngineError } from "./types";

const idleKeepMs = 10 * 60_000;

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
  retainLaunch?: () => () => void;
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
  streamedMessage: boolean;
  textBlocks: Map<string, string>;
  toolBlocks: Map<string, string>;
  settled: boolean;
  resolve: (value: PersistentRunResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

type Session = {
  key: string;
  engineId: CliEngineId;
  child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stderrTail: string;
  sessionId?: string;
  model?: string;
  turn: Turn | null;
  dead: boolean;
  idleTimer?: NodeJS.Timeout;
  onOutput?: () => void;
  disposeLaunch?: () => void;
};

const sessions = new Map<string, Session>();

function killSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.dead = true;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  try { session.child.kill(); } catch {}
  session.disposeLaunch?.();
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
  turn.textBlocks.set(blockId, (turn.textBlocks.get(blockId) ?? "") + delta);
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
    if (event.type === "message_start") {
      turn.messageIndex++;
      turn.streamedMessage = true;
    }
    return;
  }

  if (type === "assistant") {
    const message = msg.message as { content?: Array<Record<string, unknown>>; usage?: Record<string, number> } | undefined;
    if (!turn.streamedMessage) turn.messageIndex++;
    turn.streamedMessage = false;
    for (const [index, block] of (message?.content ?? []).entries()) {
      const blockId = `${turn.messageIndex}:${index}`;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text;
        if (!turn.textBlocks.has(blockId)) turn.result.text += text;
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
    }, idleKeepMs);
    session.idleTimer.unref?.();
    turn.resolve(turn.result);
    return;
  }
}

function createSession(input: PersistentRunInput): Session {
  const env = { ...process.env, ...input.launch.env };
  for (const [key, value] of Object.entries(input.launch.env)) {
    if (value === "" || value === undefined) delete env[key];
  }
  const child = Bun.spawn([input.launch.command, ...input.launch.args], {
    cwd: input.cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const session: Session = {
    key: input.key, engineId: input.engineId, child, stderrTail: "", turn: null, dead: false,
  };
  session.disposeLaunch = input.retainLaunch?.();
  sessions.set(input.key, session);

  const stdout = async () => {
    let pending = "";
    const consume = (line: string) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message.type !== "string" || session.dead) return;
      session.onOutput?.();
      handleMessage(session, message);
    };
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    if (pending.trim()) consume(pending);
  };
  const stderr = async () => {
    for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) {
      session.stderrTail = (session.stderrTail + chunk).slice(-4000);
    }
  };
  void Promise.all([stdout(), stderr(), child.exited]).then(([, , code]) => {
    if (session.dead) return;
    const turn = session.turn;
    if (turn && !turn.settled) {
      turn.settled = true;
      turn.cleanup();
      turn.reject(new CliEngineError(/heap out of memory|committing semi space failed|allocation failed/i.test(session.stderrTail)
        ? "WorkBuddy 因内存不足停止。当前步骤已中断，请释放内存后重试。"
        : `引擎已退出（code=${code}），本轮未完成。`, session.engineId));
    }
    killSession(session.key);
  }).catch(error => {
    if (session.dead) return;
    const turn = session.turn;
    if (turn && !turn.settled) {
      turn.settled = true;
      turn.cleanup();
      turn.reject(new CliEngineError(String(error), session.engineId));
    }
    killSession(session.key);
  });
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
    streamedMessage: false,
    textBlocks: new Map(),
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

  firstTimer = setTimeout(() => {
    fail(new CliEngineError(
      `${input.engineId} 本轮 ${Math.round(firstOutputTimeoutMs / 1000)} 秒没有任何输出`,
      input.engineId,
      "CLI 已启动但没有产生任何输出。可点「新对话」重开一个进程再试。",
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

  session.turn = turn;
  session.onOutput = () => { if (!turn.settled) touchIdle(); };
  const originalCleanup = turn.cleanup;
  turn.cleanup = () => {
    if (session) session.onOutput = undefined;
    originalCleanup();
  };

  try {
    session.child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: input.prompt } })}\n`);
    await session.child.stdin.flush();
  } catch (error) {
    fail(new CliEngineError(error instanceof Error ? error.message : "写入引擎 stdin 失败", input.engineId));
  }

  return finished.promise;
}
