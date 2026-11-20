import { Router } from "express";
import { success } from "@/lib/responseFormat";
import { cliProviderId, detectAllCliEngines } from "@/agent/engines";

/**
 * CLI 引擎自检。设置页用它显示「已装/未登录/启动失败 + 原因」。
 * fresh=1 强制重新探测（用户刚装完 CLI 时用）。
 */
export default Router().get("/", async (req, res) => {
  const fresh = req.query.fresh === "1";
  const list = await detectAllCliEngines(fresh);
  res.json(success(list.map(({ engine, status }) => ({
    id: engine.id,
    providerId: cliProviderId(engine.id),
    label: engine.label,
    transport: engine.transport,
    models: engine.models,
    ...status,
  }))));
});
