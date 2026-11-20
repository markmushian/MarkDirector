import { existsSync, readdirSync, readFileSync } from "@markdirector/file";
import { discoverCodexModels, readCliOutput } from "./catalog";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { CliEngine, CliEngineId, CliEngineStatus, CliLaunch, CliModelOption } from "./types";

/**
 * CLI 引擎注册表。
 *
 * 设计原则（对齐 markbot 的 driv	er 分层）：
 *  - 每个 CLI 一个 driver，负责「去哪找可执行文件」「怎么拼启动参数」「怎么声明模型」
 *  - 传输层（stream-json / codex-exec）与引擎解耦，统一翻译成 AgentEvent
 *  - 探测结果缓存 60 秒，避免每次对话都 fork 一次 --version
 */

const CACHE_MS = 60_000;
const statusCache = new Map<CliEngineId, { at: number; value: CliEngineStatus }>();

/** 沿 PATH 找可执行文件，Windows 额外补 .exe/.cmd/.bat。 */
function which(command: string): string | undefined {
  if (command.includes("/") || command.includes("\\")) return existsSync(command) ? resolve(command) : undefined;
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** 找一个可用的 node 运行时。WorkBuddy 自带的 Node 22 优先：lite bundle 在 Node 22 上实测稳定。 */
function findNode(): string | undefined {
  const wbRoot = join(homedir(), ".workbuddy", "binaries", "node", "versions");
  if (existsSync(wbRoot)) {
    const versions = readdirSync(wbRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    // 22.x 优先（WorkBuddy CLI 实测版本），其余按版本号降序兜底。
    versions.sort((a, b) => {
      const rank = (v: string) => (v.startsWith("22.") ? 0 : 1);
      return rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true });
    });
    for (const version of versions) {
      const candidate = join(wbRoot, version, process.platform === "win32" ? "node.exe" : "bin/node");
      if (existsSync(candidate)) return candidate;
    }
  }
  const direct = which("node");
  if (direct) return direct;
  const roots = [join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name, process.platform === "win32" ? "node.exe" : "bin/node");
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const drive of ["E:", "D:", "C:"]) {
    const base = `${drive}\\Node.js`;
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(base, entry.name, "node.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function findCodeBuddyGitBash(): NodeJS.ProcessEnv {
  if (process.platform !== "win32" || process.env.CODEBUDDY_CODE_GIT_BASH_PATH) return {};
  for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"), process.env.PROGRAMFILES]) {
    if (!root) continue;
    const path = join(root, "WorkBuddy", "resources", "vendor", "PortableGit", "usr", "bin", "bash.exe");
    if (existsSync(path)) return { CODEBUDDY_CODE_GIT_BASH_PATH: path, CODEBUDDY_SKIP_GIT_BASH_CHECK: "1" };
  }
  return {};
}

/** WorkBuddy 桌面版内置的 CodeBuddy CLI。 */
function findCodeBuddy(): { launcher?: string; node?: string } {
  const bases = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
    join(process.env.PROGRAMFILES ?? "", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
  ];
  const launcher = bases.find(path => existsSync(path)) ?? which("codebuddy");
  return { launcher, node: findNode() };
}

/** 收集可能存放全局 CLI 的 node 安装根目录（不依赖 server 进程的 PATH）。 */
function nodeRoots(): string[] {
  const roots = new Set<string>();
  const push = (path?: string) => {
    if (path && existsSync(path)) roots.add(resolve(path));
  };
  // PATH 上 node / npm / claude 所在目录，以及其上一级（npm 全局包通常装在 <node>/node_modules）。
  for (const command of ["node", "npm", "claude"]) {
    const hit = which(command);
    if (!hit) continue;
    const dir = dirname(hit);
    push(dir);
    push(dirname(dir));
  }
  // WorkBuddy 自带的多版本 node。
  const wbRoot = join(homedir(), ".workbuddy", "binaries", "node", "versions");
  if (existsSync(wbRoot)) {
    for (const entry of readdirSync(wbRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) push(join(wbRoot, entry.name));
    }
  }
  // 常见全局安装位置。
  push(join(process.env.APPDATA ?? "", "npm"));
  push(join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs"));
  push(join(process.env.LOCALAPPDATA ?? "", "Programs", "claude"));
  for (const drive of ["E:", "D:", "C:"]) {
    const base = `${drive}\\Node.js`;
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) push(join(base, entry.name, entry.name));
      push(join(base, entry.name));
    }
  }
  return [...roots];
}

/**
 * Claude Code 在 Windows 上装成 <root>\claude.cmd（shim），真正入口是同根 node_modules
 * 里的 claude.exe。裸跑 .cmd 会因引号/编码丢参数，所以优先返回原生 exe。
 */
function findClaude(): string | undefined {
  const pkg = ["node_modules", "@anthropic-ai", "claude-code", "bin", process.platform === "win32" ? "claude.exe" : "claude"];
  const direct = [which("claude.exe"), which("claude")].filter(Boolean) as string[];
  // 1) PATH 命中的 shim 所在目录（含上一级）里找原生 exe。
  for (const hit of direct) {
    const dir = dirname(hit);
    for (const base of [dir, dirname(dir)]) {
      const exe = join(base, ...pkg);
      if (existsSync(exe)) return exe;
      const sibling = join(base, "claude.exe");
      if (existsSync(sibling)) return sibling;
    }
  }
  // 2) 扫已知 node 根目录（server 进程 PATH 常常够不到 WorkBuddy 自带 node 的 bin）。
  for (const root of nodeRoots()) {
    const exe = join(root, ...pkg);
    if (existsSync(exe)) return exe;
    for (const name of ["claude.exe", "claude.cmd", "claude"]) {
      const candidate = join(root, name);
      if (existsSync(candidate) && !/\.cmd$/i.test(candidate)) return candidate;
    }
  }
  // 3) 最后才退回 shim（非 Windows 或只有 .cmd 的情况）。
  return direct.find(path => /\.exe$/i.test(path)) ?? direct[0];
}
/** Codex 的沙箱副本不能自举，优先找正式安装位置。 */
function findCodex(): string | undefined {
  return which("codex")
    ?? [
      join(homedir(), ".codex", ".sandbox-bin", "codex.exe"),
      join(homedir(), ".local", "bin", "codex"),
    ].find(path => existsSync(path));
}

function findHermes(): string | undefined {
  return which("hermes-acp") ?? which("hermes")
    ?? ["E:\\豆包\\Hermes\\bin\\hermes-acp.exe"].find(path => existsSync(path));
}

function findGrok(): string | undefined {
  return which("grok") ?? join(homedir(), ".grok", "bin", "grok.exe");
}

const CLAUDE_MODELS: CliModelOption[] = [
  { id: "opus", label: "Claude Opus（最强）", contextWindow: 200_000 },
  { id: "sonnet", label: "Claude Sonnet（均衡）", contextWindow: 200_000 },
  { id: "haiku", label: "Claude Haiku（最快）", contextWindow: 200_000 },
];

/**
 * 追加给 CodeBuddy 的系统提示（必须纯 ASCII：argv 带中文会让 lite bundle 启动后不产出任何事件）。
 * 目的是把模型的动作收敛到 MarkDirector 的画布 MCP 工具，别在 WorkBuddy 自带编排工具上空转。
 */
const CANVAS_AGENT_PROMPT = [
  "You are the canvas agent inside MarkDirector, a node-canvas app for short-drama production.",
  "",
  "STATE: the MarkDirector page is already connected and a project is already open.",
  "Therefore NEVER call getAppState and NEVER call openProject. They exist for attaching a fresh",
  "browser page and for switching folders; calling them mid-turn loses the real target and the",
  "turn ends with no node created. Also never call workspaceFiles, mkdir, getSettings, updateSettings,",
  "marketSearch or any project/filesystem management tool.",
  "",
  "ALLOWED TOOLS - only these, nothing else:",
  "getCanvas, getCanvasNodes, addNode, connectNodes, moveNodes, renameNodes, deleteNodes,",
  "arrangeCanvas, fitCanvas.",
  "FORBIDDEN: Bash, Read, Grep, Glob, Edit, Write, MultiEdit, NotebookEdit, WebFetch, WebSearch,",
  "DeferExecuteTool, ToolSearch, Agent, Task*, Team*, SendMessage and any other file, terminal,",
  "search or orchestration tool. Reading source files never creates a node.",
  "",
  "RECIPE for creating a text node (this exact parameter shape, no guessing):",
  "1. call getCanvas with args {\"include\": [\"nodeTypes\"]} once, to read availableNodeTypes;",
  "2. call addNode with args {\"type\": \"remote-textNode\", \"position\": {\"x\": 0, \"y\": 0},",
  "   \"label\": \"<the exact text the user asked for, at most 200 characters>\"}.",
  "position is always an object with numeric x and y - never a string, never a node id.",
  "The asset folder is created automatically, so no file tool is needed before or after.",
  "3. reply in one short sentence and stop.",
  "",
  "Hard limits: at most 3 tool calls per turn. Never retry the same failing tool more than once;",
  "if a call fails, report the error text in one sentence instead of exploring the codebase.",
  "Answer in the same language as the user, and stop as soon as the requested change is on the canvas.",
].join(" ");

const CODEBUDDY_MODELS: CliModelOption[] = [
  { id: "auto", label: "自动（WorkBuddy 分配）" },
  // 默认（列表第一项）用 DeepSeek V4.1 Flash：实测工具调用最稳，画布任务能一次跑完。
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "fast-model", label: "fast-model（快速）" },
  { id: "balanced-model", label: "balanced-model（均衡）" },
  { id: "deep-model", label: "deep-model（深度）" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "glm-5.3", label: "GLM-5.3" },
  { id: "glm-5.3-flash", label: "GLM-5.3 Flash" },
  { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
  { id: "minimax-m3.1-flash", label: "MiniMax M3.1 Flash" },
  { id: "step-5-preview", label: "Step-5 Preview" },
  { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro" },
  ...["hy4free", "hy4std", "hy3", "hy3-x", "glm-5.2", "space-bunny", "kimi-k3-1", "kimi-k2.8-preview"].map(id => ({ id, label: id })),
];

const CODEX_MODELS: CliModelOption[] = [{ id: "auto", label: "默认（Codex 设置）" }];

const GROK_MODELS: CliModelOption[] = [
  { id: "grok-4", label: "Grok 4" },
  { id: "grok-4-fast", label: "Grok 4 Fast" },
];

const HERMES_MODELS: CliModelOption[] = [
  { id: "glm-4.5-flash", label: "GLM-4.5 Flash" },
];

function engines(): CliEngine[] {
  return [
    {
      id: "claude",
      label: "Claude Code",
      transport: "stream-json",
      models: CLAUDE_MODELS,
      async detect() {
        const path = findClaude();
        if (!path) return { available: false, reason: "未找到 claude 可执行文件" };
        const auth = await readCliOutput(path, ["auth", "status", "--json"]);
        let authenticated: boolean | undefined;
        try { authenticated = JSON.parse(auth.out)?.loggedIn; } catch {}
        if (authenticated === false) return { available: false, executable: path, reason: "请运行 claude auth login 登录，然后重新检测" };
        let extraModels: unknown;
        try { extraModels = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json"), "utf8")).extraModels; } catch {}
        const extra = Array.isArray(extraModels) ? extraModels.flatMap(row => {
          const id = typeof row === "string" ? row : row?.id;
          return typeof id === "string" && /^[\w][\w./:+-]{0,127}$/.test(id) ? [{ id, label: id }] : [];
        }) : [];
        return { available: true, executable: path, version: "Claude Code", authenticated, models: [...new Map([...CLAUDE_MODELS, ...extra].map(model => [model.id, model])).values()] };
      },
      async launch({ prompt, model, resumeSessionId, mcpConfigPath }) {
        const path = findClaude();
        if (!path) throw new Error("Claude Code 不可用");
        const args = [
          "-p", prompt,
          "--output-format", "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--permission-mode", "bypassPermissions",
        ];
        if (model && model !== "auto") args.push("--model", model);
        if (resumeSessionId) args.push("--resume", resumeSessionId);
        // 挂上 MarkDirector 的 MCP：画布/节点/文档/切项目才真正可用。
        if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
        return { command: path, args, env: { HTTPS_PROXY: "", https_proxy: "", HTTP_PROXY: "", http_proxy: "" } };
      },
    },
    {
      id: "codebuddy",
      label: "WorkBuddy",
      transport: "stream-json",
      persistent: true,
      models: CODEBUDDY_MODELS,
      async detect() {
        const { launcher, node } = findCodeBuddy();
        if (!launcher) return { available: false, reason: "未找到 WorkBuddy 内置的 codebuddy" };
        if (!node) return { available: false, reason: "未找到 node 运行时", executable: launcher };
        const help = await readCliOutput(node, [launcher, "--help"], { ...process.env, CODEBUDDY_FORCE_LITE_WB_BUNDLE: "1", DISABLE_GALILEO: "1" });
        const advertised = /--model[^\r\n]*Currently supported:\s*\(([^)]*)\)/i.exec(help.out + help.err)?.[1];
        const ids = advertised?.split(",").map(id => id.trim()).filter(id => /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) ?? [];
        const fallback = new Map(CODEBUDDY_MODELS.map(model => [model.id, model]));
        const models = ids.length ? [...new Set(["auto", ...ids])].map(id => fallback.get(id) ?? { id, label: id }) : CODEBUDDY_MODELS;
        return { available: true, executable: launcher, version: "WorkBuddy CLI", models };
      },
      async launch({ model, mcpConfigPath }) {
        const { launcher, node } = findCodeBuddy();
        if (!launcher || !node) throw new Error("CodeBuddy 不可用");
        // 与 markbot 的 claudeAgent driver 完全一致（它用这套参数跑 DeepSeek V4.1 Flash）：
        //  - `-p` 后面不跟 prompt，prompt 走 stdin 的 stream-json 用户消息；
        //  - 必须有 --input-format stream-json，否则 stdin 不被解析、首包永远不来；
        //  - `--port 0` 让 lite bundle 起本地随机端口的服务；传固定端口会与 WorkBuddy 自己撞 EADDRINUSE。
        //  - 不能加 --resume：该 bundle 上 resume 会静默卡死（0 事件）。
        const args = [
          launcher,
          "-p",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--permission-mode", "bypassPermissions",
          "--port", "0",
        ];
        if (model && model !== "auto") args.push("--model", model);
        // 该 bundle 自带 WorkBuddy 全套编排工具（DeferExecuteTool / ToolSearch / Team…），
        // 模型很容易一头扎进去空转，几轮下来就是几十秒到几分钟没有可见产出。
        // 追加一段系统提示把工具收敛到画布 MCP 上；文案必须是纯 ASCII——
        // 实测 argv 里带中文会让 lite bundle 启动后 0 事件。
        // ACT: 2026-11-18 A/B 复测推翻了「参数本身不被接受」的判断——同一条启动命令，
        // 带与不带 --append-system-prompt 都能正常起流（无参 891 行事件、带参 1862 行，
        // 均含 init/tools/thinking）。当初观察到的静默另有原因（MCP 配置与宿主模式），
        // 与这个参数无关。
        // 当前仍保持不注入：画布行为已由 MCP 的 instructions + 提示词约束，收敛良好，
        // 不引入未验证的变量。若后续要重新启用，请连同 CANVAS_AGENT_PROMPT 一起压测。
        // args.push("--append-system-prompt", CANVAS_AGENT_PROMPT);
        // 只有在能提供自己那份配置时才开严格模式：实测「--strict-mcp-config 但无 --mcp-config」
        // 会让 lite bundle 卡在 MCP 初始化，0 事件、无 stderr，表现为永远没有回应。
        if (mcpConfigPath) args.push("--strict-mcp-config", "--mcp-config", mcpConfigPath);
        // WorkBuddy 只打包了 lite-wb bundle，必须显式指定；
        // 代理变量用空串表示「显式删除」，平台注入的大小写重复键会让 CLI 网络层卡死。
        return {
          command: node,
          args,
          // 代理不要动：它是沙箱网络出口，删掉 CLI 会静默卡在联网（详见 persistentStreamJson.buildEnv）。
          // DISABLE_GALILEO：lite bundle 的 Galileo 追踪初始化会去 fetch 配置，在非桌面托管的进程里
          // 必崩在 setProxy（instanceof is not callable）并卡住整轮对话；关掉它不影响对话本身。
          env: {
            CODEBUDDY_FORCE_LITE_WB_BUNDLE: "1",
            DISABLE_GALILEO: "1",
            ...findCodeBuddyGitBash(),
          },
        };
      },
    },
    {
      id: "codex",
      label: "Codex",
      transport: "codex-exec",
      models: CODEX_MODELS,
      async detect() {
        const path = findCodex();
        if (!path) return { available: false, reason: "未找到 codex 命令" };
        const auth = await readCliOutput(path, ["login", "status"]);
        const status = auth.out + auth.err;
        if (/not logged in|not authenticated/i.test(status)) return { available: false, executable: path, reason: "请运行 codex login 登录，然后重新检测" };
        return { available: true, executable: path, version: "codex-cli", authenticated: /logged in/i.test(status) || undefined, models: [...CODEX_MODELS, ...await discoverCodexModels(path)] };
      },
      async launch({ prompt, model, cwd, codexMcpArgs }) {
        const path = findCodex();
        if (!path) throw new Error("Codex 不可用");
        // 0.167 实测可用参数：exec --json --skip-git-repo-check -C。<--full-auto> 该版本不支持。
        const args = [
          "exec", "--json", "--skip-git-repo-check", "--disable", "computer_use", "--disable", "plugins",
          "--sandbox", "workspace-write", "-c", 'approval_policy="never"',
        ];
        // codex 的 MCP 只能走 -c 覆盖，且必须放在 exec 之后、prompt 之前。
        if (codexMcpArgs?.length) args.push(...codexMcpArgs);
        if (model && model !== "auto") args.push("-m", model);
        args.push("-C", cwd, prompt);
        return {
          command: path,
          args,
          env: { HTTPS_PROXY: "", https_proxy: "", HTTP_PROXY: "", http_proxy: "" },
        };
      },
    },
    {
      id: "grok",
      label: "Grok Build",
      transport: "acp",
      models: GROK_MODELS,
      async detect() {
        const path = findGrok();
        if (!path || !existsSync(path)) return { available: false, reason: "未找到 grok 命令" };
        return { available: true, executable: path };
      },
      async launch({ prompt, model }) {
        const path = findGrok();
        if (!path) throw new Error("Grok 不可用");
        return { command: path, args: ["agent", prompt, ...(model ? ["--model", model] : [])], env: {} };
      },
    },
    {
      id: "hermes",
      label: "Hermes",
      transport: "acp",
      models: HERMES_MODELS,
      async detect() {
        const path = findHermes();
        if (!path) return { available: false, reason: "未找到 hermes-acp" };
        return { available: true, executable: path };
      },
      async launch() {
        throw new Error("Hermes 走 ACP，需要 ACP 传输层（阶段 3）");
      },
    },
  ];
}

export function listCliEngines(): CliEngine[] {
  return engines();
}

export function getCliEngine(id: string): CliEngine | undefined {
  return engines().find(engine => engine.id === id);
}

/** providerId 约定为 `cli:<engineId>`，避免与普通供应商冲突。 */
export function parseCliProvider(providerId: string): CliEngineId | undefined {
  const match = /^cli:([a-z]+)$/.exec(providerId);
  return match ? match[1] as CliEngineId : undefined;
}

export function cliProviderId(id: CliEngineId): string {
  return `cli:${id}`;
}

export async function detectCliEngine(id: CliEngineId, fresh = false): Promise<CliEngineStatus> {
  const cached = statusCache.get(id);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const engine = getCliEngine(id);
  let value: CliEngineStatus;
  try {
    value = engine ? await engine.detect() : { available: false, reason: "未知引擎" };
  } catch (error) {
    value = { available: false, reason: error instanceof Error ? error.message : "探测失败" };
  }
  statusCache.set(id, { at: Date.now(), value });
  return value;
}

export async function detectAllCliEngines(fresh = false): Promise<Array<{ engine: CliEngine; status: CliEngineStatus }>> {
  return Promise.all(engines().map(async engine => ({ engine, status: await detectCliEngine(engine.id, fresh) })));
}

/** 下拉里的引擎顺序（实测优先级）：codex 官方 CLI 最稳，claude 需已登录，codebuddy 受本机代理影响。 */
const ENGINE_ORDER = ["codebuddy", "codex", "claude", "grok", "hermes"];
function engineRank(id: string) {
  const index = ENGINE_ORDER.indexOf(id);
  return index < 0 ? ENGINE_ORDER.length : index;
}

/** 供 /api/ai/models 注入的虚拟供应商条目。 */
export async function listCliModelChoices(): Promise<Array<{
  providerId: string;
  providerLabel: string;
  models: CliModelOption[];
}>> {
  const detected = await detectAllCliEngines();
  return detected
    .filter(({ engine, status }) => status.available && engine.transport !== "acp")
    // 下拉展示顺序：实测能稳定跑通的引擎在前，模型多的 CodeBuddy 不占首屏，未接协议的最后。
    .sort((a, b) => engineRank(a.engine.id) - engineRank(b.engine.id))
    .map(({ engine, status }) => ({ providerId: cliProviderId(engine.id), providerLabel: engine.label, models: status.models ?? engine.models }));
}

/** 「扫描本机」时额外探测的常见 CLI；未接入的直接列出来，用户知道装了但没被识别。 */
const EXTRA_CLI = [
  "zcode", "gemini", "qwen", "aider", "opencode", "cursor-agent", "amp", "cline",
  "crush", "goose", "droid", "kimi", "iflow", "trae", "continue", "plandex",
];

export function scanUnregisteredClis(): Array<{ name: string; path: string }> {
  const registered = new Set(
    engines().map(engine => {
      const id = engine.id;
      const probe = id === "claude" ? findClaude() : id === "codex" ? findCodex() : id === "grok" ? findGrok() : id === "hermes" ? findHermes() : undefined;
      return probe ? resolve(probe).toLowerCase() : "";
    }).filter(Boolean),
  );
  const found: Array<{ name: string; path: string }> = [];
  for (const name of EXTRA_CLI) {
    const hit = which(name) ?? which(`${name}.cmd`);
    if (!hit) continue;
    if (registered.has(resolve(hit).toLowerCase())) continue;
    found.push({ name, path: hit });
  }
  return found;
}

export type { CliEngine, CliEngineStatus, CliLaunch };
