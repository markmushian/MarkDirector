<template>
  <el-dialog v-model="visible" class="newProjectDialog" width="min(520px, 92vw)" alignCenter appendToBody :closeOnClickModal="!submitting" :closeOnPressEscape="!submitting" :showClose="!submitting" @closed="reset">
    <template #header>
      <div class="dialogHeading">
        <span class="headingIcon"><icon-plus :size="18" aria-hidden="true" /></span>
        <span class="headingText">
          <strong>新建项目</strong>
          <small>创建后进入项目页选择集</small>
        </span>
      </div>
    </template>

    <el-form class="projectForm" labelPosition="top" @submit.prevent="submit">
      <el-form-item label="项目名称" required :error="nameError">
        <el-input v-model="name" maxlength="60" showWordLimit placeholder="例如：都市情感短剧《时光邮局》" :disabled="submitting" aria-label="项目名称" @input="nameError = ''" @keydown.enter.prevent="submit" />
      </el-form-item>

      <el-form-item label="视觉风格">
        <el-select v-model="style" :disabled="submitting" aria-label="视觉风格">
          <el-option v-for="item in PROJECT_STYLES" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <p class="fieldHint">{{ styleHint }}</p>
      </el-form-item>

      <el-form-item label="画面比例">
        <el-select v-model="aspect" :disabled="submitting" aria-label="画面比例">
          <el-option v-for="item in PROJECT_ASPECTS" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
        <p class="fieldHint">创建后固定，视频生成统一使用该比例</p>
      </el-form-item>

      <el-form-item v-if="!baseDirectory" label="保存位置" required :error="directoryError">
        <div class="locationRow">
          <span class="locationPath" :title="directory">{{ directory || "尚未选择文件夹" }}</span>
          <workspacePicker ref="picker" v-model="directory" :disabled="submitting" @update:modelValue="directoryError = ''" />
        </div>
        <p class="fieldHint">会在所选位置下新建以项目名命名的文件夹，原有文件不会被删除</p>
      </el-form-item>
      <el-form-item v-else label="创建位置">
        <div class="locationRow">
          <span class="locationPath" :title="baseDirectory + ' / ' + (name.trim() || '剧名')">{{ baseDirectory }} / {{ name.trim() || "剧名" }}</span>
        </div>
        <p class="fieldHint">使用你刚才选择的文件夹，并自动新建以项目名命名的子文件夹</p>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button type="primary" :icon="IconPlus" :loading="submitting" :disabled="submitting" @click="submit">创建项目</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconPlus } from "@tabler/icons-vue";
import { PROJECT_ASPECTS, PROJECT_STYLES, projectStyleHint, type ProjectAspect, type ProjectStyleId } from "@/lib/projectMeta";
import workspacePicker from "./workspacePicker.vue";

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ submitting?: boolean; baseDirectory?: string }>();
const emit = defineEmits<{ submit: [payload: { name: string; style: ProjectStyleId; aspect: ProjectAspect; directory: string }] }>();

const name = ref("");
const style = ref<ProjectStyleId>("3d");
const aspect = ref<ProjectAspect>("16:9");
const directory = ref("");
const nameError = ref("");
const directoryError = ref("");
const picker = ref<{ chooseDirectory: () => Promise<string | null> } | null>(null);
const styleHint = computed(() => projectStyleHint(style.value));

watch(visible, open => {
  if (open) nameError.value = "";
});

function reset() {
  name.value = "";
  style.value = "3d";
  aspect.value = "16:9";
  directory.value = "";
  nameError.value = "";
  directoryError.value = "";
}

// 保存位置不合法时（如非空文件夹），父级会调用这里重新唤起选择器，避免用户再点一次。
async function reopenDirectoryPicker() {
  directory.value = "";
  directoryError.value = "";
  await picker.value?.chooseDirectory();
}

defineExpose({ reopenDirectoryPicker });

function submit() {
  if (props.submitting) return;
  const target = props.baseDirectory?.trim() || directory.value;
  nameError.value = name.value.trim() ? "" : "请填写项目名称";
  directoryError.value = target ? "" : "请选择保存位置";
  if (nameError.value || directoryError.value) return;
  emit("submit", { name: name.value.trim(), style: style.value, aspect: aspect.value, directory: target });
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

.projectForm {
  :deep(.el-form-item) { margin-bottom: 16px; }
  :deep(.el-form-item__label) { padding-bottom: 4px; font-size: 13px; color: var(--el-text-color-regular); }
  :deep(.el-select) { width: 100%; }

  .fieldHint {
    margin: 4px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .locationRow {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;

    .locationPath {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 10px;
      line-height: 32px;
      border: 1px solid var(--el-border-color);
      border-radius: var(--ui-radius);
      background: var(--el-fill-color-blank);
      color: var(--el-text-color-regular);
      font-size: 13px;
    }
  }
}
</style>
