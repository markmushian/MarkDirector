import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { listCliModelChoices } from "@/agent/engines";

/**
 * 语言模型清单 = 普通供应商 + CLI 引擎。
 * CLI 引擎以 `cli:<engineId>` 作为 providerId 注入，前端模型选择器会按 provider 自动分组，
 * 不需要为 CLI 单独写一套 UI。
 */
export default Router().get("/", async (_req, res) => {
  const models = await u.ai.listAiModels();
  const cli = await listCliModelChoices();
  res.json(success([
    ...models,
    ...cli.flatMap(group => group.models.map(model => ({
      providerId: group.providerId,
      providerLabel: group.providerLabel,
      // 复用已有协议名，避免前端校验枚举失败；CLI 引擎不会真的走这条 HTTP 协议。
      protocol: "openai-completions" as const,
      modelId: model.id,
      label: model.label,
      contextWindow: model.contextWindow ?? 200_000,
      maxOutputTokens: 32_000,
      reasoningLevels: [] as string[],
    }))),
  ]));
});
