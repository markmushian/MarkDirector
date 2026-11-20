/** CLI agent 引擎的公共契约。所有引擎最终都翻译成 AgentEvent，前端无需感知差异。 */

export type CliEngineId = "claude" | "codebuddy" | "codex" | "hermes" | "grok";

export type CliTransport = "stream-json" | "codex-exec" | "acp";

export type CliModelOption = {
  id: string;
  label: string;
  /** 上下文窗口，未知则不填。 */
  contextWindow?: number;
};

export type CliEngineStatus = {
  available: boolean;
  authenticated?: boolean;
  models?: CliModelOption[];
  /** 不可用原因，用于设置页展示；可用时不填。 */
  reason?: string;
  version?: string;
  /** 解析出的可执行文件绝对路径。 */
  executable?: string;
};

export type CliLaunch = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type CliLaunchInput = {
  prompt: string;
  model?: string;
  cwd: string;
  systemPrompt?: string;
  /** 复用的会话 id：CLI 侧 --resume，用于多轮上下文。 */
  resumeSessionId?: string;
  /** MarkDirector MCP 的 `--mcp-config` 文件（claude / codebuddy）。 */
  mcpConfigPath?: string;
  /** codex 用 `-c` 覆盖 MCP 配置，不走文件。 */
  codexMcpArgs?: string[];
};

export type CliEngine = {
  id: CliEngineId;
  label: string;
  transport: CliTransport;
  /**
   * 常驻进程传输：prompt 以 stream-json 用户消息写进 stdin，进程跨轮存活。
   * CodeBuddy 只在这条路径上可用（headless `-p <prompt>` 会崩在 lite bundle 的 setProxy）。
   */
  persistent?: boolean;
  /** 该引擎可选模型。ACP 引擎会在 session/new 时以运行时列表覆盖。 */
  models: CliModelOption[];
  /** 探测可执行文件与登录状态。 */
  detect(): Promise<CliEngineStatus>;
  /** 组装启动命令。prompt 只对 headless 传输用得上。 */
  launch(input: CliLaunchInput): Promise<CliLaunch>;
};

/** 引擎调用失败时抛出，带上可读原因。 */
export class CliEngineError extends Error {
  constructor(message: string, readonly engineId: CliEngineId, readonly hint?: string) {
    super(message);
    this.name = "CliEngineError";
  }
}
