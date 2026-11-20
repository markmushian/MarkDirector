import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { CanvasInfo } from "@markdirector/tools-scaffold/runtime";
import type { AgentEvent, AgentToolCall } from "@/agent/runtime/types";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";
import { isLocalWorkspaceRequest } from "@/utils/workspace";
import { translateError, translateMessage } from "@/lib/i18n";
import { thinkingLevels } from "@/lib/modelReasoning";
import { getAgentModelConfiguration } from "@/agent/runtime/model";
import { reportCanvasProgress } from "@/agent/engines/mcpProgress";
import { parseCliProvider, runCliAgent } from "@/agent/engines";
const inputSchema = z.object({
  prompt: z.string().trim(), directory: z.string().min(1),
  runId: z.uuid().optional(),
  expectedRunId: z.uuid().optional(),
  attachments: u.agent.agentAttachmentsSchema.optional(),
  mentions: u.agent.agentMentionsSchema.optional(),
  providerId: z.string().min(1), modelId: z.string().min(1),
  thinkingLevel: z.enum(thinkingLevels).optional(),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(),
  // ACT: 新建会话时可直接指定名字，分集制作等自动任务不再共用「首条消息前 60 字」。
  sessionName: z.string().trim().min(1).max(80).optional(),
  resendFrom: z.string().min(1).max(128).optional(),
  streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  canvas: z.strictObject({
    // 允许空 id：尚未打开画布时前端仍会带上画布上下文，Agent 可据此调用 addCanvas/getCanvas。
    id: z.string().max(256),
    tools: z.array(z.strictObject({
      nodeId: z.string().min(1).max(256),
      name: z.string().max(101).regex(/^node:[a-z][a-zA-Z0-9]*$/),
      nodeLabel: z.string().max(200).optional(),
      description: z.string().max(4000),
      parameters: z.record(z.string(), z.json()).refine(value => value.type === "object", "函数参数必须是 object JSON Schema"),
    })).max(1000),
  }).optional(),
});

/**
 * CLI 引擎只接受纯文本 prompt，附件与提及在这里展开成可读路径说明，
 * 让 CLI 自己的 read 工具去取内容（它本来就有文件能力）。
 */
function cliPrompt(options: {
  prompt: string;
  attachments?: Array<{ name: string; path: string }>;
  mentions?: Array<{ label: string; source?: { kind: string; path?: string } }>;
}) {
  const sections = [options.prompt.trim(), "工具执行过程由工作台自动展示。请直接执行任务，最终只向用户交代实际结果与未完成的事项。不要输出内部推理、命令、参数或调试过程。如果任务要求修改画布，使用 markdirector MCP 工具实际执行，避免直接写画布文件。先用 getAppState 获取当前画布和连接 ID。创建空画布用 addCanvas；如需搜索工具，搜索 mcp__markdirector__addCanvas。画布工具失败时报告原因，禁止改用 shell 或直接写 JSON。新建节点用 addNode，写入文本用 setCanvasNodeText。检查工具结果并重新读取画布确认变更后才能报告完成。"];
  if (options.attachments?.length) {
    sections.push(
      "以下附件已保存在工作区，路径为相对路径，可直接用文件工具读取：\n" +
      options.attachments.map(item => `- ${item.name}：${item.path}`).join("\n"),
    );
  }
  if (options.mentions?.length) {
    sections.push("引用素材：" + options.mentions.map(item => item.source?.path ? `${item.label}（${item.source.path}）` : item.label).join("、"));
  }
  return sections.filter(Boolean).join("\n\n");
}

const activeCliConversations = new Set<string>();

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const { directory, canvas, runId = crypto.randomUUID(), ...options } = req.body as z.infer<typeof inputSchema>;
  // CLI 引擎（claude/codebuddy/codex…）由独立子进程承载，不经过原生模型配置。
  const cliEngineId = parseCliProvider(options.providerId);
  if (options.streamingBehavior && !options.expectedRunId) {
    throw Object.assign(new Error("排队或引导需要指定当前任务标识，请刷新对话后重试"), { status: 400 });
  }
  if (cliEngineId && !isLocalWorkspaceRequest(req)) {
    throw Object.assign(new Error("本机 CLI Agent 仅供此设备上的工作台使用"), { status: 403 });
  }
  if (cliEngineId && (options.streamingBehavior || options.resendFrom)) {
    throw Object.assign(new Error("CLI 会话当前仅支持发送新消息，请在本轮结束后继续"), { status: 400 });
  }
  const controller = new AbortController();
  let bridge: ReturnType<typeof u.canvas.createCanvasContext> | undefined;
  let questions: ReturnType<typeof u.question.createQuestionContext> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let send: ((event: AgentEvent) => void) | undefined;
  let unregister = () => {};
  const finished = Promise.withResolvers<void>();
  const close = () => { clearInterval(heartbeat); bridge?.dispose(); questions?.dispose(); controller.abort(); };
  const stop = () => { controller.abort(new DOMException("已停止生成", "AbortError")); close(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    if (req.aborted || res.destroyed || req.socket.destroyed) close();
    controller.signal.throwIfAborted();
    const workspace = u.workspace.resolveWorkspace(req, directory);
    const run = { runId, directory: workspace.then(cwd => cwd, () => undefined), abort: stop, finished: finished.promise };
    unregister = u.agent.registerAgentRun(run);
    const cwd = await workspace;
    controller.signal.throwIfAborted();
    if (!cliEngineId) await getAgentModelConfiguration(options.providerId, options.modelId, options.thinkingLevel);
    res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    send = (event: AgentEvent) => {
      if (event.type === "error") event = { ...event, message: translateMessage(event.message) };
      if (event.type === "session") options.sessionFile = event.file;
      u.agent.trackAgentEvent(cwd, options.sessionFile, event);
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    bridge = canvas ? u.canvas.createCanvasContext(cwd, canvas as CanvasInfo, send, reason => controller.abort(reason)) : undefined;
    questions = u.question.createQuestionContext(cwd, send, stop);
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n");
    }, 20000);
    if (cliEngineId) {
      const file = options.sessionFile ?? (await u.agent.createAgentConversation(cwd)).file;
      if (!options.sessionFile && options.sessionName) {
        await u.agent.renameAgentSession(cwd, join(cwd, ".agent", "sessions", file), options.sessionName).catch(() => {});
      }
      const key = JSON.stringify([cwd, file]);
      if (activeCliConversations.has(key)) throw new Error("该会话已有一个 Agent 回合");
      activeCliConversations.add(key);
      const tools = new Map<string, { id: string; type: "tool"; tool: AgentToolCall }>();
      const text = new Map<string, { id: string; type: "text"; content: string }>();
      const finalText: { id: string; type: "text"; content: string }[] = [];
      let accepted = false;
      let failure: string | undefined;
      try {
        controller.signal.throwIfAborted();
        const id = await u.agent.appendCliUserMessage(cwd, file, {
          content: options.prompt, attachments: options.attachments ?? [], mentions: options.mentions,
        }, options.providerId, options.modelId);
        accepted = true;
        send({ type: "session", file, runId });
        send({ type: "userMessage", id, content: options.prompt, attachments: options.attachments, mentions: options.mentions });
        const rawCalls = new Map<string, AgentToolCall>();
        const canvasCalls = new Map<string, number>();
        const emitCli = (event: AgentEvent) => {
            if (event.type === "thinking") return;
            if (event.type === "text") {
              const id = event.blockId;
              const content = event.content ?? (text.get(id)?.content ?? "") + (event.delta ?? "");
              text.set(id, { id, type: "text", content });
              return;
            }
            if (event.type === "tool") {
              const id = event.tool.id;
              if (id.startsWith("canvas-live:") && event.tool.status === "running") {
                canvasCalls.set(event.tool.name, (canvasCalls.get(event.tool.name) ?? 0) + 1);
              }
              const previousRaw = rawCalls.get(id);
              if (previousRaw || id.startsWith("canvas-cli:") || event.tool.name === "DeferExecuteTool") {
                const raw = { ...previousRaw, ...event.tool, name: event.tool.name || previousRaw?.name || "" };
                if (event.tool.status === "running") { rawCalls.set(id, raw); return; }
                rawCalls.delete(id);
                const target = raw.args?.toolName;
                const canvasName = id.startsWith("canvas-cli:") ? raw.name
                  : typeof target === "string" && target.startsWith("mcp__markdirector__") ? target.slice("mcp__markdirector__".length) : "";
                const observed = canvasCalls.get(canvasName) ?? 0;
                if (observed) {
                  canvasCalls.set(canvasName, observed - 1);
                  return;
                }
                event = { ...event, tool: raw };
              }
              const tool = tools.get(id)?.tool;
              if (!tool || (tool.status === "running" && event.tool.status !== "running")) text.clear();
              tools.set(id, { id, type: "tool", tool: { ...tool, ...event.tool, name: event.tool.name || tool?.name || "工具" } });
            }
            send?.(event);
        };
        const canvasContext = bridge?.context;
        const createBlankCanvas = canvasContext && !options.attachments?.length && !options.mentions?.length
          && /^(?:(?:请|帮我|给我|请帮我|帮我重新|重新)\s*)?(?:新建|创建)(?:一个|一张|个)?(?:空白)?画布[。！!]?$/u.test(options.prompt);
        if (canvasContext && createBlankCanvas) {
          await reportCanvasProgress("addCanvas", {}, () => canvasContext.call({ name: "addCanvas", args: {} }, controller.signal), emitCli);
          emitCli({ type: "text", blockId: "canvas-created", content: "已创建并打开新画布。", done: true });
        } else {
          send({ type: "cliStatus", message: "正在连接 Agent…" });
          await runCliAgent({ providerId: options.providerId, modelId: options.modelId, sessionFile: file,
            prompt: cliPrompt(options), usesCanvas: !!canvas, cwd, signal: controller.signal, send: emitCli });
        }
        controller.signal.throwIfAborted();
        const delivered = new Set<string>();
        for (const part of text.values()) {
          const content = part.content.trim();
          if (!content || delivered.has(content)) continue;
          delivered.add(content);
          finalText.push(part);
          send({ type: "text", blockId: part.id, content: part.content, done: true });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          failure = error instanceof Error ? translateError(error) : "Agent 运行失败";
          throw error;
        }
      } finally {
        try {
          if (accepted) await u.agent.appendCliReply(cwd, file, options.providerId, options.modelId, [...tools.values(), ...(failure || controller.signal.aborted ? [] : finalText)],
            controller.signal.aborted ? "aborted" : failure ? "error" : "stop",
            controller.signal.aborted ? "已停止生成" : failure);
        } finally {
          activeCliConversations.delete(key);
        }
      }
    } else {
      await u.agent.run({ ...options, runId, cwd, canvas: bridge?.context, question: questions.context, signal: controller.signal, onCancel: stop }, send);
    }
    send({ type: "done" });
  } catch (error) {
    if (!res.headersSent) throw error;
    send?.({ type: "error", message: error instanceof Error ? translateError(error) : translateMessage("Agent 运行失败") });
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    bridge?.dispose();
    questions?.dispose();
    unregister();
    finished.resolve();
    if (res.headersSent && !res.writableEnded) res.end();
  }
});
