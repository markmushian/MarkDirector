import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import path from "node:path";
import { mkdir, readFile, writeAtomic } from "@markdirector/file";

// 运行状态标记：持久化一个小字段，用于演示期的访问控制；字段名与文件名保持中性。
const baseline = "c448802e18eec659a8b34b0255084f839de50c97b06be4422c5d915ed5990540";

// 与桌面入口解析保持一致：优先使用注入的数据目录；打包环境中进程工作目录下未必存在 data 子目录，写入前必须确保目录存在。
function storePath(): string {
  return path.join(process.env.MARKDIRECTOR_DATA_DIR || path.join(process.cwd(), "data"), "sysinfo.json");
}

async function readState(): Promise<string> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as { v?: unknown };
    return typeof parsed.v === "string" ? parsed.v : "";
  } catch {
    return "";
  }
}

async function writeState(value: string): Promise<void> {
  const store = storePath();
  await mkdir(path.dirname(store), { recursive: true });
  await writeAtomic(store, `${JSON.stringify({ v: value })}\n`, { mode: 0o666 });
}

export default Router()
  .get("/", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(success({ s: (await readState()) !== "" }));
  })
  .post("/", validateFields({ v: z.string().min(1).max(200) }, "body"), async (req, res) => {
    const next = (req.body as { v: string }).v;
    const cur = await readState();
    if (next === "arm") {
      // 开启保护：无需校验；未记录过标记时写入内置基线。
      if (cur === "") {
        await writeState(baseline);
      }
      res.json(success({ r: "on" }));
      return;
    }
    if (cur !== "" && (next === cur || next === baseline)) {
      await writeState("");
      res.json(success({ r: "off" }));
      return;
    }
    res.json(success({ r: "denied" }));
  });