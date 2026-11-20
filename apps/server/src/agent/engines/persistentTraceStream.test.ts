import { expect, test } from "bun:test";
import type { AgentEvent } from "@/agent/runtime/types";
import { disposePersistentSession, runPersistentStreamJson } from "./persistentTraceStream";

const fixture = `
const send = message => console.log(JSON.stringify(message));
for await (const line of console) {
  const prompt = JSON.parse(line).message.content;
  const event = event => send({ type: "stream_event", event });
  event({ type: "message_start" });
  event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "开始检查" } });
  event({ type: "message_stop" });
  send({ type: "assistant", message: { content: [{ type: "text", text: "开始检查" }] } });
  await Bun.sleep(1700);
  send({ type: "assistant", message: { content: [{ type: "tool_use", id: "read", name: "read" }] } });
  send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read", content: "测试素材" }] } });
  send({ type: "assistant", message: { content: [{ type: "text", text: prompt }] } });
  send({ type: "result", result: prompt });
}
`;

test("CLI 按结束事件收尾，保留暂停后的工具结果和下一轮回复", async () => {
  const key = crypto.randomUUID();
  const launch = { command: process.execPath, args: ["-e", fixture], env: {} };
  try {
    for (const prompt of ["第一轮完成", "第二轮完成"]) {
      const events: AgentEvent[] = [];
      await runPersistentStreamJson({
        engineId: "codebuddy", key, launch, prompt, cwd: process.cwd(),
        signal: AbortSignal.timeout(6000), send: event => events.push(event),
      });
      const replies = events.filter(event => event.type === "text" && event.done);
      expect(replies).toEqual([
        { type: "text", blockId: "1:0", content: "开始检查", done: true },
        { type: "text", blockId: "3:0", content: prompt, done: true },
      ]);
      const tools = events.filter(event => event.type === "tool");
      expect(tools.map(event => event.tool.status)).toEqual(["running", "success"]);
      expect(tools[1]?.blockId).toBe(tools[0]?.blockId);
      expect(tools[1]?.tool.result).toBe("测试素材");
    }
    const controller = new AbortController();
    const pending = runPersistentStreamJson({
      engineId: "codebuddy", key, launch, prompt: "停止", cwd: process.cwd(),
      signal: controller.signal, send: () => {},
    });
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
  } finally {
    disposePersistentSession(key);
  }
}, 15000);
