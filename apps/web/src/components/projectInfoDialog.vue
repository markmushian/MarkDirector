<template>
  <el-dialog v-model="visible" class="projectInfoDialog" width="min(480px, 92vw)" alignCenter appendToBody :closeOnClickModal="!saving" :closeOnPressEscape="!saving" :showClose="!saving" @open="reset">
    <template #header>
      <div class="dialogHeading">
        <span class="headingIcon"><icon-settings :size="18" aria-hidden="true" /></span>
        <span class="headingText">
          <strong>项目信息</strong>
          <small>修改项目名称、视觉风格和画面比例</small>
        </span>
      </div>
    </template>

    <el-form class="infoForm" labelPosition="top" @submit.prevent="submit">
      <el-form-item label="项目名称" required :error="nameError">
        <el-input v-model="name" maxlength="60" showWordLimit placeholder="例如：都市情感短剧《时光邮局》" :disabled="saving" aria-label="项目名称" @input="nameError = ''" @keydown.enter.prevent="submit" />
      </el-form-item>

      <el-form-item label="视觉风格">
        <el-select v-model="style" :disabled="saving" aria-label="视觉风格">
          <el-option v-for="item in PROJECT_STYLES" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <p class="fieldHint">{{ styleHint }}</p>
      </el-form-item>

      <el-form-item label="画面比例">
        <el-select v-model="aspect" :disabled="saving" aria-label="画面比例">
          <el-option v-for="item in PROJECT_ASPECTS" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconSettings } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import {
  createProjectMeta, directoryDisplayName, normalizeProjectMeta, patchProjectMeta, PROJECT_ASPECTS, PROJECT_META_FILE,
  PROJECT_STYLES, projectStyleHint, readProjectMeta, type ProjectAspect, type ProjectMeta, type ProjectStyleId,
} from "@/lib/projectMeta";
import { useWorkspaceStore } from "@/stores/workspace";
import useWorkspaceFiles from "@/lib/workspaceFiles";

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ directory: string; meta?: ProjectMeta | null }>();
const emit = defineEmits<{ saved: [meta: ProjectMeta] }>();

const store = useWorkspaceStore();
const name = ref("");
const style = ref<ProjectStyleId>("3d");
const aspect = ref<ProjectAspect>("16:9");
const nameError = ref("");
const saving = ref(false);
const styleHint = computed(() => projectStyleHint(style.value));

async function reset() {
  const meta = props.meta;
  name.value = meta?.name || directoryDisplayName(props.directory);
  style.value = meta?.style ?? "3d";
  aspect.value = meta?.aspect ?? "16:9";
  nameError.value = "";
  // 列表里的档案还没加载完时，直接读磁盘，避免把名称/风格显示成默认值。
  if (!meta) {
    const loaded = await readProjectMeta(props.directory).catch(() => null);
    if (loaded) {
      name.value = loaded.name;
      style.value = loaded.style;
      aspect.value = loaded.aspect;
    }
  }
}

async function submit() {
  if (saving.value) return;
  const nextName = name.value.trim();
  nameError.value = nextName ? "" : "请填写项目名称";
  if (nameError.value || !props.directory) return;
  saving.value = true;
  try {
    // 以磁盘上的最新档案为准，避免用列表里的旧快照覆盖别处的改动。
    let base: ProjectMeta;
    try {
      const raw = await useWorkspaceFiles(props.directory).readJson<unknown>(PROJECT_META_FILE);
      base = normalizeProjectMeta(raw, directoryDisplayName(props.directory));
    } catch {
      base = props.meta ? { ...props.meta } : createProjectMeta(directoryDisplayName(props.directory));
    }
    const updated: ProjectMeta = { ...base, name: nextName, style: style.value, aspect: aspect.value };
    await patchProjectMeta(props.directory, updated);
    store.renameProject(props.directory, nextName);
    emit("saved", updated);
    visible.value = false;
    ElMessage.success("项目信息已更新");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存项目信息失败");
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.dialogHeading {
  display: flex;
  align-items: center;
  gap: 10px;

  .headingIcon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--md-gold-faint);
    color: var(--md-gold);
  }

  .headingText {
    display: flex;
    flex-direction: column;
    gap: 2px;

    strong { font-size: 15px; font-weight: 600; line-height: 1.4; }
    small { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.4; }
  }
}

.infoForm {
  :deep(.el-form-item) { margin-bottom: 16px; }
  :deep(.el-form-item__label) { padding-bottom: 4px; font-size: 13px; color: var(--el-text-color-regular); }
  :deep(.el-select) { width: 100%; }

  .fieldHint {
    margin: 4px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
  }
}
</style>
