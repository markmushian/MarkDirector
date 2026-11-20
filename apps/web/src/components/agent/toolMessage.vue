<template>
  <component v-if="renderer" :is="renderer" :tool="tool" :directory="directory" :toolSessionId="toolSessionId" @copy="emit('copy', $event)" />
  <el-text v-if="rendererError" type="danger">工具界面加载失败，请停止后重试：{{ rendererError }}</el-text>
  <div v-if="step !== undefined" class="toolStep" :data-status="tool.status">
    <span class="stepIndex" aria-hidden="true">{{ step }}</span>
    <span class="stepLabel">{{ stepLabel }}</span>
    <span v-if="tool.status === 'running'" class="stepStatus stepTimer"><span class="stepRing" aria-hidden="true" />{{ elapsed }} 秒</span>
    <span v-else class="stepStatus" aria-live="polite">{{ toolStatusLabels[tool.status] }}</span>
  </div>
  <chat-reasoning v-else v-model:collapsed="collapsed" class="messageReasoning toolCall" expandIconPlacement="left">
    <template #expandIcon><component :is="collapsed ? IconChevronRight : IconChevronDown" :size="14" aria-hidden="true" /></template>
    <template #header>
      <span class="toolHeader" :data-status="tool.status">
        <icon-tool :size="14" />
        <span class="toolName">{{ tool.name === "installMarketPlugin" ? "安装插件" : renderer ? "操作工具" : tool.name || "工具调用" }}</span>
        <span class="toolState">{{ tool.name === 'subAgent' && tool.status === 'success' ? '调用已返回' : toolStatusLabels[tool.status] }}</span>
      </span>
    </template>
    <div v-if="!collapsed" class="toolDetails">
      <template v-for="(data, index) in [args, result]" :key="index">
        <template v-if="data">
          <span class="toolLabel">
            {{ index === 0 ? "参数" : "结果" }}
            <el-button v-if="!data.markdown" text size="small" :icon="IconCopy" :aria-label="index === 0 ? '复制工具参数' : '复制工具结果'" @click="emit('copy', data.content)" />
          </span>
          <messageMarkdown v-if="data.markdown" class="toolData" :class="{ toolError: index === 1 && tool.status === 'error' }" :content="data.markdown" :directory="directory" :codeOptions="toolCodeOptions" />
          <pre v-else class="toolData toolPlain" :class="{ toolError: index === 1 && tool.status === 'error' }" tabindex="0" :aria-label="index === 0 ? '工具参数' : '工具结果'">{{ data.content }}</pre>
        </template>
      </template>
    </div>
  </chat-reasoning>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref, shallowRef, watch, type Component } from "vue";
import { getCachedToolComponent, loadToolComponent } from "@markdirector/tools-scaffold/client";
import { IconChevronDown, IconChevronRight, IconCopy, IconTool } from "@tabler/icons-vue";
import chatReasoning from "@tdesign-vue-next/chat/es/chat-reasoning";
import type { AgentToolCall } from "@markdirector/server/agent/types";
import messageMarkdown from "@/components/messageMarkdown.vue";
import { describeToolStep } from "./toolStep";
import marketInstallApproval from "./marketInstallApproval.vue";

const { tool, directory, toolSessionId, step } = defineProps<{ tool: AgentToolCall; directory?: string; toolSessionId?: string; step?: number }>();
const emit = defineEmits<{ copy: [content: string] }>();
const renderer = shallowRef<Component>();
const rendererError = ref("");
watch(() => [tool.name, tool.question?.callId] as const, async ([name], previous, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  rendererError.value = "";
  if (step !== undefined && name !== "installMarketPlugin" && !tool.question) return;
  if (name === "installMarketPlugin" && !toolSessionId) {
    renderer.value = marketInstallApproval;
    return;
  }
  if (name !== previous?.[0]) renderer.value = name === "subAgent" ? undefined : getCachedToolComponent(name);
  if (name === "subAgent") return;
  const initialRenderer = renderer.value;
  try {
    const component = await loadToolComponent(name);
    if (active && (!rendererError.value || component !== initialRenderer)) {
      renderer.value = component;
      rendererError.value = "";
      if (!component && tool.status === "running" && tool.question?.callId) rendererError.value = "该工具未提供可用的交互组件";
    }
  } catch (error) {
    if (active) {
      renderer.value = undefined;
      rendererError.value = error instanceof Error ? error.message : String(error);
    }
  }
}, { immediate: true });
onErrorCaptured(error => {
  if (!renderer.value) return;
  renderer.value = undefined;
  rendererError.value = error.message;
  return false;
});
const collapsed = defineModel<boolean>("collapsed", { default: true });
const toolStatusLabels = { running: "调用中…", success: "已完成", error: "调用失败", interrupted: "已中断" };
const runningLabels: Record<string, string> = { setCanvasNodeText: "保存文本节点" };
const stepLabel = computed(() => {
  const label = describeToolStep(tool);
  return tool.status === "running" ? "正在" + (runningLabels[tool.name] ?? label.replace(/^新建画布/, "创建画布")) : label;
});
const elapsed = ref(0);
watch(() => step !== undefined && tool.status === "running", (running, _previous, cleanup) => {
  if (!running) return;
  elapsed.value = 0;
  const start = Date.now();
  const timer = setInterval(() => { elapsed.value = Math.floor((Date.now() - start) / 1000); }, 250);
  cleanup(() => clearInterval(timer));
}, { immediate: true });
const toolCodeOptions = { maxHeight: 240, lineNumbers: false };
const args = computed(() => formatToolData(tool.args));
const result = computed(() => formatToolData(tool.result));

function formatToolData(value: unknown) {
  if (value === undefined) return;
  try {
    const content = JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2) ?? "";
    // ACT: 超过 16K 字符只渲染完整文本，限制高亮与 token DOM 开销；更大数据量可改为虚拟行。
    return { content, markdown: content.length <= 16_384 ? `~~~json\n${content}\n~~~` : undefined };
  } catch {
    return { content: String(value), markdown: undefined };
  }
}
</script>

<style scoped lang="scss">
.toolStep {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 8px;
  border-radius: var(--ui-radius);
  background-color: var(--el-fill-color-light);
  font-size: 12px;
  line-height: 1.45;
  .stepIndex {
    flex: 0 0 18px;
    border-radius: 50%;
    line-height: 18px;
    text-align: center;
    background-color: var(--el-fill-color-darker);
    font-variant-numeric: tabular-nums;
  }
  .stepLabel { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .stepTimer { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
  .stepRing {
    box-sizing: border-box;
    width: 15px;
    height: 15px;
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: stepRingTurn .85s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) { .stepRing { animation: none; } }
  .stepStatus { flex-shrink: 0; color: var(--el-text-color-secondary); }
  &[data-status="running"] .stepStatus { color: var(--el-color-primary); }
  &[data-status="error"] .stepStatus { color: var(--el-color-danger); }
}
@keyframes stepRingTurn { to { transform: rotate(360deg); } }
.toolCall {
  min-width: 0;
  :deep(.t-collapse-panel__icon) { color: var(--el-text-color-secondary); }

  .toolHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--el-text-color-secondary);

    .toolName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolState {
      flex-shrink: 0;
      font-size: 12px;
    }

    &[data-status="error"] .toolState { color: var(--el-color-danger); }
  }

  .toolDetails {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 12px;

    .toolLabel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--el-text-color-secondary);
    }

    .toolData {
      margin: 0 0 6px;
      font-size: 12px;
      line-height: 1.5;

      :deep([data-stream-markdown="code-block"]) {
        margin: 0;
        border-radius: var(--ui-radius);
      }

      :deep([data-stream-markdown="code-block-content"]) {
        overscroll-behavior: contain;
        pre {
          white-space: pre;
          overflow-wrap: normal;
        }
      }

      &.toolError :deep([data-stream-markdown="code-block"]) { border-color: var(--el-color-danger-light-5); }

      &.toolPlain {
        min-width: 0;
        max-width: 100%;
        max-height: 240px;
        padding: 12px;
        overflow: auto;
        overscroll-behavior: contain;
        white-space: pre;
        overflow-wrap: normal;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        color: var(--el-text-color-primary);
        background: var(--el-fill-color-light);
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--ui-radius);

        &.toolError { border-color: var(--el-color-danger-light-5); }
      }
    }
  }
}
</style>
