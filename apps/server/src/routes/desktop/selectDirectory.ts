import { realpath } from "@markdirector/file";
import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", async (req, res) => {
  const runtime = u.desktop.getDesktopRuntime(req);
  // MarkDirector 本地化：无原生桌面运行时时返回 available=false，前端据此才回退到内置目录浏览器。
  if (!runtime || typeof runtime.selectDirectory !== "function") return res.json(success({ available: false, directory: null }));
  const selected = await runtime.selectDirectory();
  const directory = selected ? await realpath(selected) : null;
  // available=true 且 directory=null 表示用户主动取消了系统选择器，前端应就此结束而不是继续弹内置浏览器。
  res.json(success({ available: true, directory }));
});
