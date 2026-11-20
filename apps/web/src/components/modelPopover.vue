<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="340"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="Agent 与模型设置">
          <img class="agentMark" :src="agentMarks[activeAgent?.id ?? ''] ?? logoUrl" width="19" height="19" alt="" />
          <span v-if="activeAgent" class="agentName">{{ agentShortLabel }}</span>
          <span v-if="activeAgent" class="agentDivider" aria-hidden="true">/</span>
          <modelLabel class="modelName" :label="selectedModelChoice?.label ?? '选择模型'" :providerId="selectedModelChoice?.providerId" />
          <template v-if="reasoningLevels.length">
            ·
            <span class="reasoningLabel">{{ reasoningLabel }}</span>
          </template>
          <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item label="Agent">
          <el-select :modelValue="activeAgent?.id ?? ''" :disabled="disabled" :teleported="false" placeholder="选择 Agent" aria-label="选择 Agent" noDataText="请先在设置中添加 Agent" @update:modelValue="selectAgent">
            <el-option v-for="agent in modelGroups" :key="agent.id" :label="agent.label" :value="agent.id">
              <div class="modelOption">
                <img class="agentMark" :src="agentMarks[agent.id] ?? logoUrl" width="17" height="17" alt="" />
                <span class="agentOptionLabel">{{ agent.label }}</span>
                <span class="agentOptionMeta">{{ agent.models.length }} 个模型</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-select :modelValue="selectedModelChoice ? selectedModel : ''" filterable :disabled="disabled || !agentModels.length" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="该 Agent 暂无可用模型" @update:modelValue="selectModel" @change="reasoningEffort = ''">

            <template #label="{ label }"><modelLabel :label="label" :providerId="selectedModelChoice?.providerId" /></template>
            <el-option v-for="model in agentModels" :key="model.value" :label="model.label" :value="model.value">
              <div class="modelOption">
                <modelIcon v-if="model.modelId !== 'auto' && !model.modelId.endsWith('-model')" :model="model.modelId" :size="16" />
                <modelLabel class="modelOptionLabel" :label="model.label" :providerId="model.providerId" />
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item v-if="reasoningLevels.length" label="思考强度">
          <div class="reasoningSettings">
            <div class="reasoningGrid" role="radiogroup" aria-label="思考强度" :aria-describedby="`${reasoningId}Hint`" :style="{ gridTemplateColumns: `repeat(${reasoningColumns}, minmax(0, 1fr))` }">
              <label v-for="option in reasoningOptions" :key="option.value" class="reasoningOption">
                <input v-model="reasoningEffort" type="radio" :name="reasoningId" :value="option.value" :disabled="disabled" />
                <span class="reasoningOptionLabel">{{ option.label }}</span>
              </label>
            </div>
            <div :id="`${reasoningId}Hint`" class="reasoningHint">默认由模型决定</div>
          </div>
        </el-form-item>
      </el-form>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@markdirector/model-icons";
import { useNodeModelSelection } from "@markdirector/nodes-scaffold/nodeAi";
import modelLabel from "@markdirector/node-shared/modelLabel";
import type { ThinkingLevel } from "@markdirector/server/modelReasoning";
import { modelChoices, refreshModelChoices } from "@/stores/settings";

import workBuddyMark from "@/assets/agents/workBuddy.png";
import codexMark from "@/assets/agents/codex.png";
import claudeMark from "@/assets/agents/claudeCode.png";
import grokMark from "@/assets/agents/grok.svg";
import hermesMark from "@/assets/agents/hermes.png";
import logoUrl from "@markdirector/assets/logo.svg";

const agentMarks: Record<string, string> = {
  "cli:codebuddy": workBuddyMark, "cli:codex": codexMark, "cli:claude": claudeMark,
  "cli:grok": grokMark, "cli:hermes": hermesMark,
};
const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const reasoningId = useId();
const reasoningLabels: Record<ThinkingLevel, string> = { off: "关闭", minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };
const selectedModelChoice = useNodeModelSelection(modelChoices, selectedModel);
const modelGroups = computed(() => {
  const groups = new Map<string, { id: string; label: string; models: Array<(typeof modelChoices.value)[number]> }>();
  for (const model of modelChoices.value) {
    const group = groups.get(model.providerId);
    if (group) group.models.push(model);
    else groups.set(model.providerId, { id: model.providerId, label: model.providerLabel, models: [model] });
  }
  return [...groups.values()];
});
// Agent（供应商/引擎）在前、模型在后：先选谁干活，再选它用哪个模型。
const activeAgent = computed(() => modelGroups.value.find(group => group.id === selectedModelChoice.value?.providerId)
  ?? modelGroups.value[0]);
// 按钮上只留 Agent 的短名（去掉「（WorkBuddy）」这类后缀），给模型名留出宽度。
const agentShortLabel = computed(() => (activeAgent.value?.label ?? "").replace(/[（(].*$/, "").trim() || activeAgent.value?.label || "");
const agentModels = computed(() => activeAgent.value?.models ?? []);
function selectAgent(id: string) {
  const agent = modelGroups.value.find(group => group.id === id);
  const first = agent?.models[0];
  if (first) selectedModel.value = first.value;
  reasoningEffort.value = "";
}
function selectModel(value: string) {
  selectedModel.value = value;
  reasoningEffort.value = "";
}
const reasoningLevels = computed(() => selectedModelChoice.value?.reasoningLevels ?? []);
const reasoningOptions = computed(() => [{ label: "默认", value: "" }, ...reasoningLevels.value.map(value => ({ label: reasoningLabels[value], value }))]);
const reasoningColumns = computed(() => Math.min(4, reasoningOptions.value.length > 4 ? Math.ceil(reasoningOptions.value.length / 2) : reasoningOptions.value.length));
const reasoningLabel = computed(() => reasoningOptions.value.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
watch(modelChoices, items => {
  if (!selectedModel.value) selectedModel.value = items[0]?.value ?? "";
}, { immediate: true });
watch([() => selectedModelChoice.value?.reasoningLevels, reasoningEffort], ([levels, effort]) => {
  if (levels && effort && !levels.includes(effort as ThinkingLevel)) reasoningEffort.value = "";
}, { immediate: true, flush: "post" });
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
watch(visible, value => { if (value) void refreshModelChoices().catch(() => {}); });
</script>

<style lang="scss">
.agentMark { flex: none; object-fit: contain; border-radius: 4px; }
.modelPopover {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;

  .modelButton {
    max-width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--el-text-color-regular);

    > span {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    svg {
      flex-shrink: 0;
    }

    .reasoningLabel {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .agentName {
      flex-shrink: 0;
      max-width: 72px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .agentDivider {
      flex-shrink: 0;
      color: var(--el-text-color-placeholder);
    }

    .modelName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  }
}

.agentModelPopover {
  .modelOptions {
    .el-form-item {
      margin-bottom: 20px;

      &:last-child {
        margin-bottom: 0;
      }
      .el-form-item__label {
        margin-bottom: 8px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      .el-select {
        width: 100%;

        .modelOption {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;

          .modelOptionLabel {
            flex: 1;
          }

          .agentOptionLabel {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .agentOptionMeta {
            flex-shrink: 0;
            color: var(--el-text-color-placeholder);
            font-size: 12px;
          }
        }
      }
      .reasoningSettings {
        width: 100%;

        .reasoningGrid {
          display: grid;
          gap: 6px;

          .reasoningOption {
            position: relative;
            min-width: 0;

            input {
              position: absolute;
              width: 1px;
              height: 1px;
              overflow: hidden;
              clip-path: inset(50%);

              &:checked + .reasoningOptionLabel {
                border-color: var(--el-color-primary-light-5);
                background: var(--el-color-primary-light-9);
                color: var(--el-color-primary);
                font-weight: 600;
              }
              &:focus-visible + .reasoningOptionLabel {
                outline: 2px solid var(--el-color-primary);
                outline-offset: 2px;
              }
              &:disabled + .reasoningOptionLabel {
                opacity: .5;
                cursor: not-allowed;
              }
            }
            .reasoningOptionLabel {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 32px;
              padding: 4px 8px;
              border: 1px solid var(--el-border-color-lighter);
              border-radius: var(--el-border-radius-base);
              background: var(--el-fill-color-light);
              color: var(--el-text-color-regular);
              font-size: 12px;
              line-height: 20px;
              cursor: pointer;
              transition: background-color .15s, border-color .15s, color .15s;
            }
            &:hover input:not(:disabled) + .reasoningOptionLabel {
              border-color: var(--el-color-primary-light-5);
              color: var(--el-color-primary);
            }
          }
        }
        .reasoningHint {
          margin-top: 8px;
          color: var(--el-text-color-secondary);
          font-size: 12px;
          line-height: 18px;
        }
      }
    }
  }
}
</style>
