import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "@markdirector/file";
import { tmpdir } from "node:os";
import { join } from "node:path";
import conf from "@/utils/conf";
import { getMcpSettings } from "@/utils/mcp/control";
import { getMcpRuntime } from "@/utils/mcp/runtime";

/**
 * 把 MarkDirector 自带的 MCP server 挂给 CLI 引擎。
 *
 * MarkDirector 已通过 `@markdirector/mcp` 把「画布 / 节点 / 当前文档 / 切换项目 / 媒体生成」
 * 暴露成 MCP 工具，CLI 只要连上去就能真正操作画布，而不是只会改文件。
 *
 * MCP 默认关闭；这里自动开启（仅 127.0.0.1 监听 + Bearer 凭证），否则 CLI 拿不到画布能力。
 */
export type CliMcpBridge = {
  /** claude / codebuddy 的 `--mcp-config` 文件路径。 */
  configPath?: string;
  /** codex 用 `-c` 覆盖，不走配置文件。 */
  codexArgs: string[];
  endpoint?: string;
  connectionKey?: string;
  dispose: () => void;
};

export function prepareCliMcpBridge(sessionKey: string): CliMcpBridge {
  const endpoint = getMcpRuntime().endpoint;
  if (!endpoint) return { codexArgs: [], dispose: () => {} };

  const { enabled, token: storedToken } = getMcpSettings();
  const token = storedToken.length < 32 ? randomBytes(24).toString("hex") : storedToken;
  if (!enabled || token !== storedToken) {
    const settings = (conf.get("settings") ?? {}) as Record<string, unknown>;
    const mcp = (settings.mcp ?? {}) as Record<string, unknown>;
    conf.set("settings", { ...settings, mcp: { ...mcp, enabled: true, token } });
  }

  const connectionKey = createHmac("sha256", token).update(endpoint).update(sessionKey).digest("hex");
  const toolEndpoint = new URL(endpoint);
  toolEndpoint.searchParams.set("progress", connectionKey);
  const dir = mkdtempSync(join(tmpdir(), "md-cli-mcp-"));
  const configPath = join(dir, "mcp.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        markdirector: { type: "http", url: toolEndpoint.href, headers: { Authorization: `Bearer ${token}` } },
      },
    }, null, 2),
    { mode: 0o600 },
  );

  return {
    configPath,
    endpoint,
    connectionKey,
    codexArgs: [
      "-c", `mcp_servers.markdirector.url="${toolEndpoint.href}"`,
      "-c", `mcp_servers.markdirector.http_headers.Authorization="Bearer ${token}"`,
      "-c", 'mcp_servers.markdirector.default_tools_approval_mode="approve"',
      "-c", 'mcp_servers.markdirector.enabled_tools=["getAppState","getCanvas","addCanvas","switchCanvas","renameCanvas","findCanvasNodes","getCanvasNodes","getCanvasEdges","getNodeTools","addNode","moveNodes","renameNodes","connectNodes","arrangeCanvas","fitCanvas","nodeTools","setCanvasNodeText","openDocument","getDocument","writeDocument","switchPanel","read","list","search"]',
    ],
    dispose: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 目录可能已被清理 */ }
    },
  };
}
