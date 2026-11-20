<template>
  <div class="projectAssets">
    <div class="assetToolbar">
      <div class="assetTabs" role="tablist" aria-label="资产分类">
        <button v-for="item in tabs" :key="item.id" type="button" role="tab" :aria-selected="tab === item.id" :class="{ active: tab === item.id }" @click="tab = item.id">
          {{ item.name }}<span class="tabCount">{{ meta?.assets[item.id].length ?? 0 }}</span>
        </button>
      </div>
      <el-input v-model="search" class="assetSearch" clearable :prefixIcon="IconSearch" :placeholder="`搜索${tabName}`" aria-label="搜索资产" @keydown.esc.stop="search = ''" />
      <el-button v-if="selectedIds.size" class="batchButton" type="primary" plain :icon="IconWand" :loading="batchRunning" :disabled="!directory || loading" @click="runBatchGenerate">
        {{ batchRunning ? `生成中 ${batchProgress}` : `批量生成 ${selectedIds.size} 项` }}
      </el-button>
      <el-button class="addButton" :icon="IconPlus" :disabled="!directory || loading" @click="openAdd">新增{{ tabName }}</el-button>
    </div>

    <p v-if="!directory" class="assetHint">请先打开一个项目，资产会保存在项目根目录的 project.json 里。</p>
    <p v-else-if="loading" class="assetHint">正在读取项目档案…</p>
    <p v-else-if="error" class="assetHint error" role="alert">{{ error }}</p>
    <p v-else-if="!filtered.length" class="assetHint">{{ search ? "没有找到匹配的资产" : `还没有${tabName}，点右上角新增` }}</p>

    <div v-else class="assetGrid">
      <article v-for="item in filtered" :key="item.id" class="assetCard" :class="{ selected: selectedIds.has(item.id) }">
        <div class="assetCover">
          <el-checkbox class="coverCheck" :modelValue="selectedIds.has(item.id)" :aria-label="`选择${item.name}`" @update:modelValue="toggleSelect(item.id)" @click.stop />
          <img v-if="thumb(item)" :src="thumb(item)" :alt="item.name" loading="lazy" @error="dropThumb(item)" />
          <span v-else class="coverPlaceholder">
            <component :is="tab === 'characters' ? IconUser : tab === 'scenes' ? IconMapPin : IconBox" :size="26" aria-hidden="true" />
          </span>
          <span v-if="item.role" class="roleTag">{{ item.role }}</span>
        </div>
        <div class="assetBody">
          <p class="assetName" :title="item.name">{{ item.name }}</p>
          <p class="assetMeta">{{ (item.refs?.length ?? 0) ? `${item.refs!.length} 张参考图` : "暂无参考图" }}</p>
          <div class="assetActions">
            <el-button text size="small" :icon="IconWand" :disabled="busy || generating" @click="openGenerate(item)">{{ item.refs?.length ? "重绘" : "生成" }}</el-button>
            <el-button text size="small" :icon="IconUpload" :disabled="busy" @click="pickFile(item)">上传</el-button>
            <el-button text size="small" :icon="IconPencil" :disabled="busy" @click="rename(item)">重命名</el-button>
            <el-button text size="small" type="danger" :icon="IconTrash" :disabled="busy" @click="remove(item)">删除</el-button>
          </div>
        </div>
      </article>
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="uploadRef" />

    <el-dialog v-model="addOpen" :title="`新增${tabName}`" width="min(420px, 92vw)" alignCenter appendToBody destroyOnClose>
      <el-form labelPosition="top" @submit.prevent="confirmAdd">
        <el-form-item :label="`${tabName}名称`" required>
          <el-input ref="addInput" v-model="draftName" maxlength="40" :placeholder="tab === 'characters' ? '例如：泠崎' : tab === 'scenes' ? '例如：废弃厂区门口' : '例如：旧怀表'" @keydown.enter.prevent="confirmAdd" />
        </el-form-item>
        <el-form-item v-if="tab === 'characters'" label="角色类型">
          <el-select v-model="draftRole">
            <el-option v-for="role in roles" :key="role" :label="role" :value="role" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!draftName.trim()" @click="confirmAdd">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="generateOpen" :title="`${generateTarget?.refs?.length ? '重绘' : '生成'}${tabName}参考图`" width="min(540px, 92vw)" alignCenter appendToBody destroyOnClose>
      <el-form labelPosition="top" @submit.prevent="confirmGenerate">
        <el-form-item label="图片模型">
          <el-select v-model="generateModel" filterable :loading="modelsLoading" placeholder="选择图片模型" aria-label="图片模型">
            <el-option v-for="item in imageModels" :key="`${item.providerId}:${item.modelId}`" :label="`${item.label} · ${item.providerLabel}`" :value="`${item.providerId}:${item.modelId}`" />
          </el-select>
          <p v-if="!modelsLoading && !imageModels.length" class="genHint error">还没有可用的图片模型，请先在设置里配置图片供应商。</p>
        </el-form-item>
        <el-form-item label="提示词" required>
          <el-input v-model="generatePrompt" type="textarea" :rows="4" maxlength="2000" showWordLimit placeholder="描述这个角色/场景/道具长什么样" aria-label="生成提示词" />
        </el-form-item>
        <el-form-item label="画面比例">
          <el-select v-model="generateRatio" aria-label="画面比例">
            <el-option label="竖屏 9:16" value="9:16" />
            <el-option label="横屏 16:9" value="16:9" />
            <el-option label="方形 1:1" value="1:1" />
          </el-select>
        </el-form-item>
      </el-form>
      <p v-if="generateTarget?.refs?.length" class="genHint">会把已有参考图一并交给模型，生成结果追加为新的参考图，不会覆盖旧的。</p>
      <template #footer>
        <el-button :disabled="generating" @click="generateOpen = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="confirmGenerate">{{ generateTarget?.refs?.length ? "开始重绘" : "开始生成" }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { IconBox, IconMapPin, IconPencil, IconPlus, IconSearch, IconTrash, IconUpload, IconUser, IconWand } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { createProjectMeta, directoryDisplayName, normalizeProjectMeta, PROJECT_META_FILE, type ProjectAssetItem, type ProjectAssets, type ProjectMeta } from "@/lib/projectMeta";

const props = defineProps<{ directory?: string }>();
const tabs: { id: keyof ProjectAssets; name: string }[] = [
  { id: "characters", name: "角色" },
  { id: "scenes", name: "场景" },
  { id: "props", name: "道具" },
];
const roles = ["主角", "配角", "龙套"];
const tab = ref<keyof ProjectAssets>("characters");
const search = ref("");
const meta = ref<ProjectMeta | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const addOpen = ref(false);
const draftName = ref("");
const draftRole = ref("配角");
const addInput = ref<InputInstance>();
const fileInput = ref<HTMLInputElement>();
const uploadingFor = ref<ProjectAssetItem>();
const thumbList = ref<Record<string, string>>({});
const releases: (() => void)[] = [];
const pendingThumbs = new Set<string>();
let thumbToken = 0;

type ImageModelItem = { providerId: string; providerLabel: string; modelId: string; label: string; type: string };
const generateOpen = ref(false);
const generateTarget = ref<ProjectAssetItem>();
const generatePrompt = ref("");
const generateModel = ref("");
const generateRatio = ref("9:16");
const generating = ref(false);
const modelsLoading = ref(false);
const modelsLoaded = ref(false);
const imageModels = ref<ImageModelItem[]>([]);
const selectedIds = ref(new Set<string>());
const batchRunning = ref(false);
const batchProgress = ref("");

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedIds.value = next;
}

watch(tab, () => { selectedIds.value = new Set(); });

const tabName = computed(() => tabs.find(item => item.id === tab.value)?.name ?? "资产");
const list = computed<ProjectAssetItem[]>(() => meta.value?.assets[tab.value] ?? []);
const filtered = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase();
  if (!keyword) return list.value;
  return list.value.filter(item => `${item.name} ${item.role ?? ""} ${item.desc ?? ""}`.toLocaleLowerCase().includes(keyword));
});

function files() {
  return useWorkspaceFiles(props.directory!);
}

async function load() {
  if (!props.directory) { meta.value = null; return; }
  loading.value = true;
  error.value = "";
  try {
    let raw: unknown = null;
    try { raw = await files().readJson(PROJECT_META_FILE); } catch { raw = null; }
    meta.value = raw ? normalizeProjectMeta(raw, directoryDisplayName(props.directory)) : createProjectMeta(directoryDisplayName(props.directory));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "读取项目档案失败";
  } finally {
    loading.value = false;
  }
}

watch(() => props.directory, load, { immediate: true });
onBeforeUnmount(() => { thumbToken++; for (const release of releases.splice(0)) release(); });

function thumb(item: ProjectAssetItem) {
  const path = item.refs?.[0];
  if (!path) return "";
  const cached = thumbList.value[path];
  if (cached) return cached;
  if (pendingThumbs.has(path)) return "";
  pendingThumbs.add(path);
  const token = thumbToken;
  const preview = files().acquireUrl(path);
  releases.push(preview.release);
  void preview.url.then(url => {
    if (token !== thumbToken) return;
    thumbList.value = { ...thumbList.value, [path]: url };
  }).catch(() => { pendingThumbs.delete(path); });
  return "";
}

function dropThumb(item: ProjectAssetItem) {
  const path = item.refs?.[0];
  if (!path) return;
  const next = { ...thumbList.value };
  delete next[path];
  thumbList.value = next;
}

async function save() {
  if (!meta.value || !props.directory) return;
  busy.value = true;
  error.value = "";
  try {
    await files().writeJson(PROJECT_META_FILE, meta.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "保存项目档案失败";
  } finally {
    busy.value = false;
  }
}

function openAdd() {
  draftName.value = "";
  draftRole.value = "配角";
  addOpen.value = true;
  void nextTick(() => addInput.value?.focus());
}

async function confirmAdd() {
  const name = draftName.value.trim();
  if (!name || !meta.value) return;
  const prefix = tab.value === "characters" ? "chr" : tab.value === "scenes" ? "scn" : "prp";
  meta.value.assets[tab.value].push({
    id: `${prefix}_${crypto.randomUUID().slice(0, 8)}`,
    name,
    refs: [],
    ...(tab.value === "characters" && draftRole.value ? { role: draftRole.value } : {}),
  });
  await save();
  addOpen.value = false;
}

async function rename(item: ProjectAssetItem) {
  const result = await ElMessageBox.prompt(`请输入${tabName.value}名称`, "重命名", {
    inputValue: item.name,
    confirmButtonText: "保存",
    cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "名称不能为空",
  }).catch(() => null);
  if (!result) return;
  item.name = result.value.trim();
  await save();
}

async function remove(item: ProjectAssetItem) {
  const ok = await ElMessageBox.confirm(`确定从项目资产里移除「${item.name}」？磁盘上的参考图会保留。`, "删除资产", {
    type: "warning", confirmButtonText: "移除", cancelButtonText: "取消",
  }).then(() => true, () => false);
  if (!ok || !meta.value) return;
  meta.value.assets[tab.value] = meta.value.assets[tab.value].filter(entry => entry.id !== item.id);
  await save();
}

async function loadImageModels() {
  if (modelsLoaded.value || modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const { data } = await axios.get<{ data: ImageModelItem[] }>("/api/ai/media/models");
    imageModels.value = (data.data ?? []).filter(item => item.type === "image");
    if (!generateModel.value) {
      const preferred = imageModels.value.find(item => /seedream|gemini|image/i.test(item.modelId)) ?? imageModels.value[0];
      if (preferred) generateModel.value = `${preferred.providerId}:${preferred.modelId}`;
    }
    modelsLoaded.value = true;
  } catch { /* 读取失败时弹窗内提示，不打断操作 */ }
  finally { modelsLoading.value = false; }
}

function defaultPrompt(item: ProjectAssetItem) {
  const kind = tab.value === "characters" ? "角色" : tab.value === "scenes" ? "场景" : "道具";
  return `${kind}「${item.name}」${item.role ? `（${item.role}）` : ""}的标准参考图，正面、完整、中性表情、纯色背景、无文字、无水印`;
}

function openGenerate(item: ProjectAssetItem) {
  generateTarget.value = item;
  generatePrompt.value = item.prompt?.trim() || defaultPrompt(item);
  generateRatio.value = item.refs?.length ? "1:1" : (meta.value?.aspect ?? "9:16");
  generateOpen.value = true;
  void loadImageModels();
}

async function generateForItem(item: ProjectAssetItem, prompt: string, ratio: string) {
  const [providerId, modelId] = generateModel.value.split(":");
  if (!providerId || !modelId) throw new Error("模型选择无效，请重新选择");
  const body: Record<string, unknown> = {
    directory: props.directory,
    mediaType: "image",
    providerId,
    modelId,
    prompt,
    ratio,
  };
  const reference = item.refs?.[0];
  if (reference) {
    const extension = (reference.split(".").pop() ?? "png").toLowerCase();
    body.images = [{ path: reference, mimeType: `image/${extension === "jpg" ? "jpeg" : extension}` }];
  }
  const { data } = await axios.post<{ code: number; data?: { path: string; mimeType: string; mediaType: string }[]; message?: string }>(
    "/api/ai/media/generate", body, { timeout: 300000 },
  );
  if (data.code !== 200) throw new Error(data.message || "生成失败");
  const created = (data.data ?? []).filter(file => file.mediaType === "image" && file.path);
  if (!created.length) throw new Error("模型没有返回图片");
  item.refs = [...(item.refs ?? []), ...created.map(file => file.path)];
  item.prompt = prompt;
  dropThumb(item);
  return created.length;
}

async function runBatchGenerate() {
  if (batchRunning.value || generating.value) return;
  if (!generateModel.value) await loadImageModels();
  if (!generateModel.value) return ElMessage.warning("没有可用图片模型，请先在设置里配置");
  const items = list.value.filter(item => selectedIds.value.has(item.id));
  if (!items.length) return;
  batchRunning.value = true;
  let success = 0;
  let failed = 0;
  let done = 0;
  batchProgress.value = `0/${items.length}`;
  try {
    // ACT: 串行执行，供应商侧并发限制各不相同，批量并发生成最容易触发限流。
    for (const item of items) {
      batchProgress.value = `${++done}/${items.length}`;
      try {
        await generateForItem(item, item.prompt?.trim() || defaultPrompt(item), item.refs?.length ? "1:1" : (meta.value?.aspect ?? "9:16"));
        success++;
      } catch { failed++; }
    }
    if (success) await save();
    ElMessage[failed ? "warning" : "success"](`批量生成完成：成功 ${success} 项${failed ? `，失败 ${failed} 项` : ""}`);
    if (!failed) selectedIds.value = new Set();
  } finally {
    batchRunning.value = false;
    batchProgress.value = "";
  }
}

async function confirmGenerate() {
  const item = generateTarget.value;
  if (!item || generating.value) return;
  if (!generatePrompt.value.trim()) return ElMessage.warning("请填写提示词");
  if (!generateModel.value) return ElMessage.warning("没有可用图片模型，请先在设置里配置");
  generating.value = true;
  try {
    const count = await generateForItem(item, generatePrompt.value.trim(), generateRatio.value);
    await save();
    generateOpen.value = false;
    ElMessage.success(`已生成 ${count} 张参考图`);
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data?.message || "生成失败，请检查模型配置"
      : err instanceof Error ? err.message : "生成失败");
  } finally { generating.value = false; }
}

function pickFile(item: ProjectAssetItem) {
  uploadingFor.value = item;
  fileInput.value?.click();
}

async function uploadRef(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const item = uploadingFor.value;
  uploadingFor.value = undefined;
  if (!file || !item || !meta.value) return;
  if (!file.type.startsWith("image/")) return ElMessage.warning("参考图只能是图片");
  if (file.size > 20 * 1024 * 1024) return ElMessage.warning("参考图不能超过 20 MB");
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `assets/library/${crypto.randomUUID()}.${ext}`;
  busy.value = true;
  try {
    await files().mkdir("assets/library").catch(() => {});
    await files().write(path, file);
    item.refs = [...(item.refs ?? []), path];
    await save();
    ElMessage.success("参考图已添加");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "上传参考图失败");
  } finally {
    busy.value = false;
  }
}
</script>

<style lang="scss" scoped>
.projectAssets {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.assetToolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.assetTabs {
  display: flex;
  gap: 4px;

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--el-text-color-regular);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: color 0.16s ease, background-color 0.16s ease, border-color 0.16s ease;

    .tabCount {
      padding: 0 6px;
      border-radius: 999px;
      background: var(--el-fill-color);
      color: var(--el-text-color-secondary);
      font-size: 11px;
      line-height: 1.6;
    }

    &:hover { color: var(--md-gold); }

    &.active {
      border-color: color-mix(in srgb, var(--md-gold) 45%, transparent);
      background: color-mix(in srgb, var(--md-gold) 8%, transparent);
      color: var(--md-gold);

      .tabCount { background: color-mix(in srgb, var(--md-gold) 16%, transparent); color: var(--md-gold); }
    }
  }
}

.assetSearch {
  flex: 1;
  min-width: 160px;
  max-width: 260px;
}

.addButton { margin-left: auto; }

.assetHint {
  margin: 0;
  padding: 24px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: center;

  &.error { color: var(--el-color-danger); }
}

.assetGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  padding-bottom: 8px;
}

.assetCard {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: calc(var(--ui-radius) * 2);
  background: var(--el-bg-color-overlay);
  transition: border-color 0.18s ease, transform 0.18s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--md-gold) 40%, transparent);
    transform: translateY(-1px);
  }
}

.assetCard.selected {
  border-color: color-mix(in srgb, var(--md-gold) 65%, transparent);
  background: color-mix(in srgb, var(--md-gold) 4%, var(--el-bg-color-overlay));
}

.assetCover {
  position: relative;

  .coverCheck {
    position: absolute;
    top: 6px;
    right: 8px;
    z-index: 1;
    padding: 2px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--el-bg-color) 78%, transparent);
  }
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--el-fill-color-light);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .coverPlaceholder {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: var(--el-text-color-placeholder);
  }

  .roleTag {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--md-gold) 22%, transparent);
    color: var(--md-gold);
    font-size: 11px;
    line-height: 1.6;
  }
}

.assetBody {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px 8px;

  .assetName {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 500;
  }

  .assetMeta {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}

.assetActions {
  display: flex;
  flex-wrap: wrap;
  gap: 0 2px;
  margin-top: auto;

  :deep(.el-button) {
    margin-left: 0;
    padding: 3px 4px;
    font-size: 12px;
  }
}

.genHint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;

  &.error { color: var(--el-color-danger); }
}
</style>
