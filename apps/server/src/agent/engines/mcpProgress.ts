import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentEvent } from "@/agent/runtime/types";

const active = new Map<string, (event: AgentEvent) => void>();
export const mcpProgressScope = new AsyncLocalStorage<string | undefined>();

export function registerMcpProgress(key: string, send: (event: AgentEvent) => void) {
  active.set(key, send);
  return () => { if (active.get(key) === send) active.delete(key); };
}

export async function reportCanvasProgress<T>(name: string, args: Record<string, unknown>, operation: () => Promise<T>,
  send = active.get(mcpProgressScope.getStore() ?? "")) {
  if (!send) return operation();
  const id = `canvas-live:${crypto.randomUUID()}`;
  const request = args.args && typeof args.args === "object" ? args.args as Record<string, unknown> : args;
  const target = args.target as { canvasId?: unknown } | undefined;
  const summary = Object.fromEntries(Object.entries({ ...request, canvasId: request.canvasId ?? target?.canvasId })
    .filter(([key, value]) => ["name", "label", "type", "canvasId", "query", "filePath", "path", "nodeLabel"].includes(key)
      && typeof value === "string" && value.length <= 256));
  send({ type: "tool", blockId: id, tool: { id, name, args: summary, status: "running" } });
  try {
    const result = await operation();
    const outcome = result as { isError?: boolean } | undefined;
    send({ type: "tool", blockId: id, tool: { id, name, status: outcome?.isError ? "error" : "success" } });
    return result;
  } catch (error) {
    send({ type: "tool", blockId: id, tool: { id, name, status: "error" } });
    throw error;
  }
}
