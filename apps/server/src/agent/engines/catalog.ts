import type { CliModelOption } from "./types";

export async function readCliOutput(command: string, args: string[], env = process.env) {
  const signal = AbortSignal.timeout(12_000);
  try {
    const child = Bun.spawn([command, ...args], { env, signal, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err };
  } catch {
    return { out: "", err: "" };
  }
}

export async function discoverCodexModels(command: string): Promise<CliModelOption[]> {
  const signal = AbortSignal.timeout(10_000);
  const models = new Map<string, CliModelOption>();
  const cursors = new Set<string>();
  let child: Bun.Subprocess<"pipe", "pipe", "ignore"> | undefined;
  try {
    child = Bun.spawn([command, "app-server"], { signal, stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true });
    const send = (message: object) => {
      child!.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
      child!.stdin.flush();
    };
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "markdirector", version: "2.0" } } });
    let buffer = "";
    let requestId = 1;
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      const lines = (buffer + chunk).split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame?.id !== requestId) continue;
        if (frame.error) return [...models.values()];
        if (requestId === 1) {
          send({ method: "initialized", params: {} });
          send({ id: ++requestId, method: "model/list", params: { cursor: null, limit: 100 } });
          continue;
        }
        for (const model of frame.result?.data ?? []) {
          if (!model || model.hidden || typeof model.id !== "string" || !/^[\w][\w./:+-]{0,127}$/.test(model.id)) continue;
          models.set(model.id, { id: model.id, label: typeof model.displayName === "string" && model.displayName.trim() ? model.displayName : model.id });
        }
        const cursor = frame.result?.nextCursor;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) return [...models.values()];
        cursors.add(cursor);
        send({ id: ++requestId, method: "model/list", params: { cursor, limit: 100 } });
      }
    }
  } catch {
    return [...models.values()];
  } finally {
    child?.kill();
  }
  return [...models.values()];
}
