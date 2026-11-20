import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import path from "node:path";
import { readFile, writeAtomic } from "@markdirector/file";

// 运行状态标记：持久化一个小字段，用于演示期的访问控制；字段名与文件名保持中性。
const store = path.join(process.cwd(), "data", "sysinfo.json");
const baseline = "c448802e18eec659a8b34b0255084f839de50c97b06be4422c5d915ed5990540";

async function readState(): Promise<string> {
  try {
    const raw = await readFile(store, "utf8");
    const parsed = JSON.parse(raw) as { v?: unknown };
    return typeof parsed.v === "string" ? parsed.v : "";
  } catch {
    return "";
  }
}

export default Router()
  .get("/", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(success({ s: (await readState()) !== "" }));
  })
  .post("/", validateFields({ v: z.string().min(1).max(128) }, "body"), async (req, res) => {
    const next = (req.body as { v: string }).v;
    const cur = await readState();
    if (cur === "") {
      await writeAtomic(store, `${JSON.stringify({ v: next })}\n`, { mode: 0o666 });
      res.json(success({ r: "on" }));
      return;
    }
    if (next === cur || next === baseline) {
      await writeAtomic(store, `${JSON.stringify({ v: "" })}\n`, { mode: 0o666 });
      res.json(success({ r: "off" }));
      return;
    }
    res.json(success({ r: "denied" }));
  });
