<template>
  <div class="aiPanel">
    <div class="panelHeader">
      <el-text class="panelHint" size="small" type="info">使用本机 CLI 的登录会话。登录后点「重新检查」。</el-text>
      <div class="panelHeaderActions">
        <el-button text :icon="IconRefresh" :loading="loading" @click="load(true)">重新检查</el-button>
        <el-button text :icon="IconRadar2" :loading="scanning" @click="scan">扫描本机</el-button>
      </div>
    </div>

    <el-text class="sectionTitle" tag="strong">你的 AI</el-text>

    <div class="engineList">
      <div v-for="item in engines" :key="item.id" class="engineBlock">
        <div class="engineRow" :class="{ isExpanded: expanded.has(item.id) }" role="button" tabindex="0"
          @click="toggle(item.id)" @keydown.enter.prevent="toggle(item.id)" @keydown.space.prevent="toggle(item.id)">
          <span class="statusDot" :class="item.available ? 'isOk' : 'isFail'" aria-hidden="true" />
          <div class="engineText">
            <div class="engineName">{{ item.label }}</div>
            <div class="engineSub" :title="item.available ? item.executable : item.reason">
              {{ item.available ? (item.version || item.executable) : (item.reason || "未检测到可执行文件") }}
            </div>
          </div>
          <el-tag size="small" :type="item.available ? 'success' : 'info'" effect="plain">{{ item.transport === 'acp' ? "待接入" : item.authenticated ? "已登录" : item.available ? "已检测" : item.executable ? "待登录" : "未安装" }}</el-tag>
          <el-button class="manageButton" text @click.stop="toggle(item.id)">{{ expanded.has(item.id) ? "完成" : "管理" }}</el-button>
        </div>

        <el-collapse-transition>
          <div v-show="expanded.has(item.id)" class="engineDetail">
            <div class="detailLine">
              <span class="detailKey">渠道</span>
              <span class="detailValue">{{ item.providerId }}</span>
            </div>
            <div class="detailLine">
              <span class="detailKey">协议</span>
              <span class="detailValue">{{ transportLabel(item.transport) }}</span>
            </div>
            <div v-if="item.executable" class="detailLine">
              <span class="detailKey">路径</span>
              <span class="detailValue mono" :title="item.executable">{{ item.executable }}</span>
            </div>
            <div class="detailLine">
              <span class="detailKey">模型</span>
              <span class="detailValue modelTags">
                <el-tag v-for="model in item.models" :key="model.id" size="small" type="info" effect="plain">{{ model.label }}</el-tag>
              </span>
            </div>
            <div class="detailActions">
              <el-button text size="small" :icon="IconRefresh" :loading="checking === item.id" @click="checkOne(item.id)">重新检测</el-button>
            </div>
          </div>
        </el-collapse-transition>
      </div>
    </div>

    <el-alert v-if="discovered.length" type="success" :closable="false" show-icon class="discoverAlert">
      <template #title>扫描到 {{ discovered.length }} 个未接入的 CLI</template>
      <div class="discoverList">
        <span v-for="item in discovered" :key="item.name" class="discoverItem">{{ item.name }} · {{ item.path }}</span>
      </div>
    </el-alert>

    <el-collapse class="pathCollapse">
      <el-collapse-item title="CLI 路径与更新" name="paths">
        <div class="pathList">
          <div v-for="item in engines" :key="item.id" class="pathRow">
            <span class="pathName">{{ item.label }}</span>
            <span class="pathValue mono">{{ item.executable || "未找到" }}</span>
          </div>
        </div>
        <el-text size="small" type="info">检测结果缓存 60 秒。装好新 CLI 后点「重新检查」即可识别。</el-text>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { IconRadar2, IconRefresh } from "@tabler/icons-vue";
import http from "@/lib/http";

type CliModelOption = { id: string; label: string; contextWindow?: number };
type CliEngineRow = {
  id: string;
  providerId: string;
  label: string;
  transport: string;
  models: CliModelOption[];
  available: boolean;
  authenticated?: boolean;
  executable?: string;
  version?: string;
  reason?: string;
};
type Discovered = { name: string; path: string };

const engines = ref<CliEngineRow[]>([]);
const discovered = ref<Discovered[]>([]);
const loading = ref(false);
const scanning = ref(false);
const checking = ref("");
const expanded = ref(new Set<string>());

const TRANSPORT_LABELS: Record<string, string> = { "stream-json": "流式 JSON（Claude 兼容）", "codex-exec": "codex exec", acp: "ACP 协议" };
function transportLabel(transport: string) {
  return TRANSPORT_LABELS[transport] ?? transport;
}

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

async function load(fresh = false) {
  loading.value = true;
  try {
    engines.value = await http<CliEngineRow[]>({ method: "GET", url: "/api/agent/engines", params: fresh ? { fresh: "1" } : undefined });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "读取 AI 列表失败");
  } finally {
    loading.value = false;
  }
}

async function checkOne(id: string) {
  checking.value = id;
  try {
    engines.value = await http<CliEngineRow[]>({ method: "GET", url: "/api/agent/engines", params: { fresh: "1" } });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "检测失败");
  } finally {
    checking.value = "";
  }
}

async function scan() {
  scanning.value = true;
  try {
    const result = await http<{ engines: CliEngineRow[]; discovered: Discovered[] }>({ method: "GET", url: "/api/agent/engines", params: { fresh: "1", scan: "1" } });
    engines.value = result.engines;
    discovered.value = result.discovered;
    if (!result.discovered.length) ElMessage.success(`已完成扫描，识别到 ${result.engines.filter(item => item.available).length} 个可用 AI`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "扫描失败");
  } finally {
    scanning.value = false;
  }
}

onMounted(() => void load());
</script>

<style lang="scss" scoped>
.aiPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .panelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;

    .panelHeaderActions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }
  }

  .sectionTitle {
    margin-top: 12px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    font-weight: 500;
  }

  .engineList {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    overflow: hidden;
  }

  .engineBlock + .engineBlock {
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .engineRow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    cursor: pointer;
    transition: background-color .15s;

    &:hover,
    &.isExpanded {
      background: var(--el-fill-color-light);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: -2px;
    }

    .statusDot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;

      &.isOk { background: var(--el-color-success); }
      &.isFail { background: var(--el-color-info-light-5); }
    }

    .engineText {
      flex: 1;
      min-width: 0;
    }

    .engineName {
      font-size: 14px;
      color: var(--el-text-color-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .engineSub {
      margin-top: 2px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .manageButton {
      flex-shrink: 0;
    }
  }

  .engineDetail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 14px 14px 32px;
    background: var(--el-fill-color-lighter);

    .detailLine {
      display: flex;
      gap: 10px;
      font-size: 12px;
      line-height: 18px;
    }

    .detailKey {
      flex-shrink: 0;
      width: 32px;
      color: var(--el-text-color-secondary);
    }

    .detailValue {
      min-width: 0;
      color: var(--el-text-color-regular);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .modelTags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      white-space: normal;
    }

    .detailActions {
      display: flex;
      justify-content: flex-end;
    }
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .discoverAlert {
    margin-top: 4px;

    .discoverList {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 6px;
      font-size: 12px;
    }

    .discoverItem {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }
  }

  .pathCollapse {
    margin-top: 8px;

    .pathList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 10px;
    }

    .pathRow {
      display: flex;
      gap: 12px;
      font-size: 12px;
    }

    .pathName {
      flex-shrink: 0;
      width: 120px;
      color: var(--el-text-color-secondary);
    }

    .pathValue {
      min-width: 0;
      word-break: break-all;
    }
  }
}
</style>
