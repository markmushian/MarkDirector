<template>
  <div class="home" :class="{ sidebarCollapsed }" :inert="creating || opening || workspaceStore.projectLoadingVisible">
    <bg class="pageBackground" :scrollTop="backgroundScrollTop" />
    <aside id="homeSidebar" class="homeSidebar" aria-label="首页侧栏">
      <div class="sidebarHeader">
        <div class="sidebarBrand">
          <el-image class="sidebarLogo" :src="logoUrl" fit="contain" alt="MarkDirector" />
          <span class="brandName">MarkDirector</span>
        </div>
        <button class="sidebarToggle" type="button" :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :aria-expanded="!sidebarCollapsed" aria-controls="homeSidebar" @click="sidebarCollapsed = !sidebarCollapsed">
          <icon-layout-sidebar-left-expand v-if="sidebarCollapsed" :size="18" aria-hidden="true" />
          <icon-layout-sidebar-left-collapse v-else :size="18" aria-hidden="true" />
        </button>
      </div>
      <nav class="sidebarNav" aria-label="首页导航">
        <button v-for="section in homeSections" :key="section.id" class="sidebarItem" :class="{ active: activeSection === section.id }" type="button" :aria-current="activeSection === section.id ? 'location' : undefined" :aria-label="translate(section.label)" :title="translate(section.label)" @click="scrollToSection(section.id)">
          <component :is="section.icon" :size="18" aria-hidden="true" />
          <span class="sidebarText">{{ translate(section.label) }}</span>
        </button>
        <hr v-if="currentUser?.role !== 'user'" class="sidebarDivider" />
        <button v-if="currentUser?.role !== 'user'" class="sidebarItem" :class="{ active: assetsVisible }" type="button" aria-label="素材库" title="素材库" aria-haspopup="dialog" :aria-expanded="assetsVisible" @click="assetsVisible = true">
          <icon-library-photo :size="18" aria-hidden="true" />
          <span class="sidebarText">素材库</span>
        </button>
      </nav>
      <div class="sidebarFooter">
        <button class="sidebarItem" type="button" :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" :title="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" @click="settingsVisible = true">
          <span class="sidebarIcon">
            <icon-settings :size="18" aria-hidden="true" />
            <span v-if="hasDesktopUpdate" class="updateDot" />
          </span>
          <span class="sidebarText">设置</span>
        </button>
        <a class="sidebarItem githubLink" href="https://github.com/markmushian/MarkDirector" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">
          <icon-brand-github :size="18" aria-hidden="true" />
          <span class="sidebarText">GitHub</span>
        </a>
      </div>
    </aside>
    <el-scrollbar ref="pageScroll" class="pageScroll" @scroll="updateActiveSection">
      <div class="pageBody">
        <el-main class="pageContent">
          <section class="creationPanel" data-home-section="home" aria-label="创建项目">
            <div class="brand">
              <el-image class="brandLogo" :src="logoUrl" fit="contain" alt="MarkDirector" />
              <h1>今天要做点什么？</h1>
            </div>
            <div class="promptArea">
              <el-card class="promptCard" :class="{ draggingAttachments }" shadow="never" @dragenter.capture="dragEnterAttachments" @dragover.capture="dragOverAttachments" @dragleave.capture="dragLeaveAttachments" @drop.capture="dropAttachments">
                <div v-if="draggingAttachments" class="attachmentDropOverlay" role="status" aria-live="polite">
                  <icon-paperclip :size="20" aria-hidden="true" />
                  <strong>松开添加附件</strong>
                  <span>图片、视频、文档或代码文件</span>
                </div>
                <input ref="attachmentInput" type="file" :accept="attachmentAccept" multiple hidden :disabled="creating || opening" @change="selectAttachments" />
                <attachmentList v-if="promptAttachments.length" class="promptAttachments" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" />
                <el-input ref="promptInput" v-model="prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" resize="none" :disabled="creating || opening" :placeholder="promptPlaceholder" aria-label="创作描述" @keydown="handlePromptKeydown" @paste.capture="pasteAttachments" />
                <template #footer>
                  <div class="composerFooter">
                    <div class="composerTools">
                      <el-button class="attachmentButton" text circle :icon="IconPaperclip" :disabled="creating || opening" aria-label="添加附件" title="添加附件" @click="attachmentInput?.click()" />
                      <workspacePicker ref="promptWorkspacePicker" v-model="workspaceDirectory" :disabled="creating || opening" />
                    </div>
                    <div class="sendActions">
                      <span class="sendHint" aria-hidden="true">Enter 发送 · Shift + Enter 换行</span>
                      <modelPopover v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" class="modelSelect" :disabled="creating || opening" />
                      <el-button class="sendButton" type="primary" :circle="!!workspaceDirectory" :icon="workspaceDirectory ? IconArrowUp : IconFolder" :loading="creating" :disabled="creating || opening" :aria-label="workspaceDirectory ? '发送' : '选择工作目录'" @click="workspaceDirectory ? startComposerProject() : promptWorkspacePicker?.chooseDirectory()">
                        <template v-if="!workspaceDirectory" #default>选择工作目录</template>
                      </el-button>
                    </div>
                  </div>
                </template>
              </el-card>
              <p v-if="!workspaceDirectory" class="workspaceHint" role="status">先选一个保存位置；点发送后会让你填写项目名、风格与比例，并自动新建以项目名命名的文件夹。</p>
            </div>
          </section>
          <section class="projectList" data-home-section="projects" aria-labelledby="projectListTitle">
            <h2 id="projectListTitle" class="projectTabs">
              <button type="button" :class="{ active: projectType === 'local' }" :aria-pressed="projectType === 'local'" aria-controls="projectListContent" @click="projectType = 'local'">项目</button>
              <button type="button" :class="{ active: projectType === 'team' }" :aria-pressed="projectType === 'team'" aria-controls="projectListContent" @click="projectType = 'team'">团队项目</button>
            </h2>
            <div v-if="projectType === 'local'" id="projectListContent" class="projectItems">
              <el-card class="projectLaunchCard" shadow="never" :bodyStyle="{ padding: '0', height: '100%' }">
                <div class="projectLaunch">
                  <button class="launchPrimary" type="button" :disabled="creating || opening" :aria-busy="creating" title="新建项目" @click="openNewProjectDialog">
                    <span class="launchIcon">
                      <icon-loader-2 v-if="creating" class="isLoading" :size="22" aria-hidden="true" />
                      <icon-plus v-else :size="22" aria-hidden="true" />
                    </span>
                    <span class="launchText">
                      <span class="launchTitle">新建项目</span>
                      <span class="launchDescription">设置风格与画面比例</span>
                    </span>
                  </button>
                  <button class="launchSecondary" type="button" :disabled="creating || opening || relocationPicker?.selecting" :aria-busy="relocationPicker?.selecting" @click="openExistingProject">
                    <icon-folder-open :size="15" aria-hidden="true" />
                    <span>打开已有项目</span>
                  </button>
                </div>
              </el-card>
              <projectCard v-for="project in sortedProjects" :key="project.directory" :project="project" :meta="projectMetas[project.directory] ?? null" :disabled="creating || opening" :actionsLoading="exportingDirectory === project.directory" @select="openProject(project)">
                <template #actions>
                  <el-dropdown-item :icon="IconSettings" :disabled="creating || opening" @click="openProjectInfo(project)">项目信息</el-dropdown-item>
                  <el-dropdown-item :icon="IconMovie" :disabled="creating || opening" @click="manageProject(project)">剧集与资产</el-dropdown-item>
                  <el-dropdown-item :icon="IconEdit" :disabled="creating || opening || exportingDirectory === project.directory" @click="renameProject(project)">重命名</el-dropdown-item>
                  <el-dropdown-item :icon="IconFileZip" :disabled="creating || opening || !!exportingDirectory" @click="exportProject(project)">打包导出 ZIP</el-dropdown-item>
                  <el-dropdown-item class="removeAction" :icon="IconTrash" divided :disabled="creating || opening || exportingDirectory === project.directory" title="从列表移除，不删除文件" @click="workspaceStore.removeProject(project.directory)">移除项目</el-dropdown-item>
                </template>
              </projectCard>
            </div>
            <div v-else id="projectListContent" class="teamProjects" />
          </section>
        </el-main>
      </div>
    </el-scrollbar>
    <assetLibraryDialog v-if="currentUser?.role !== 'user'" v-model="assetsVisible" />
    <newProjectDialog ref="newProjectDialogRef" v-model="newProjectVisible" :submitting="creating" :base-directory="dialogBaseDirectory" @submit="createProjectFromMeta" />
    <projectInfoDialog v-model="infoVisible" :directory="infoDirectory" :meta="infoMeta" @saved="onProjectInfoSaved" />
    <settings ref="settingsDialog" v-model="settingsVisible" />
    <workspacePicker ref="relocationPicker" hideTrigger />
  </div>
</template>

<script setup lang="ts">
import { locale, translate } from "@markdirector/i18n/vue";
import axios from "axios";
import { storeToRefs } from "pinia";
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type InputInstance, type ScrollbarInstance } from "element-plus";
import { getReadableFileMimeType, readableFileAccept } from "@markdirector/server/documentFormats";
import {
  IconHome,
  IconArrowUp, IconPlus, IconLoader2,
  IconFolder, IconFolderOpen, IconEdit, IconFileZip, IconMovie, IconSettings,
  IconTrash, IconPaperclip,
} from "@tabler/icons-vue";
import modelPopover from "@/components/modelPopover.vue";
import attachmentList from "@/components/agent/attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "@/components/agent/textAttachments";
import type { AgentAttachment } from "@/components/agent/types";
import logoUrl from "@markdirector/assets/logo.svg";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { currentUser, publicWeb } from "@/stores/multiTenant";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { isCanvasFile } from "@/pages/workspace/canvasFile";
import saveFile from "@/lib/saveFile";
import { waitForControlValue } from "@/lib/mcpControl";
import settings from "@/components/settings/index.vue";
import assetLibraryDialog from "./assetLibraryDialog.vue";
import bg from "./bg.vue";
import newProjectDialog from "./newProjectDialog.vue";
import projectInfoDialog from "@/components/projectInfoDialog.vue";
import projectCard from "./projectCard.vue";
import workspacePicker from "./workspacePicker.vue";
import {
  PROJECT_META_FILE, createProjectMeta, directoryDisplayName, patchProjectMeta, readProjectMeta,
  type ProjectAspect, type ProjectMeta, type ProjectStyleId,
} from "@/lib/projectMeta";

const settingsVisible = ref(false);
const settingsDialog = ref<InstanceType<typeof settings>>();
const assetsVisible = ref(false);
const newProjectVisible = ref(false);
const newProjectDialogRef = ref<{ reopenDirectoryPicker: () => Promise<void> }>();
const dialogBaseDirectory = ref("");
const composerCreate = ref(false);
const infoVisible = ref(false);
const infoDirectory = ref("");
const infoMeta = ref<ProjectMeta | null>(null);
const projectMetas = ref<Record<string, ProjectMeta | null>>({});
const sidebarCollapsed = ref(false);
const pageScroll = ref<ScrollbarInstance>();
const backgroundScrollTop = ref(0);
const activeSection = ref("home");
const projectType = ref<"local" | "team">("local");
const homeSections = [
  { id: "home", label: "首页", icon: IconHome },
  { id: "projects", label: "项目", icon: IconFolder },
];
const router = useRouter();
const pageLifetime = new AbortController();
const creating = ref(false);
const opening = ref(false);
const exportingDirectory = ref("");
const promptWorkspacePicker = ref<InstanceType<typeof workspacePicker>>();
const relocationPicker = ref<InstanceType<typeof workspacePicker>>();
const prompt = ref("");
const promptInput = ref<InputInstance>();
const promptAttachments = ref<AgentAttachment[]>([]);
const attachmentInput = ref<HTMLInputElement>();
const attachmentAccept = `image/*,video/*,${readableFileAccept}`;
const draggingAttachments = ref(false);
let attachmentDragDepth = 0;
const workspaceStore = useWorkspaceStore();
const { project, projectList } = storeToRefs(workspaceStore);
const workspaceDirectory = ref(project.value?.directory ?? "");
const placeholderPhrases = [
  "描述你想创作的内容，让灵感从这里开始…",
  "把一个故事灵感，变成一段精彩的短片…",
  "为你的主角设计独特的外形和性格…",
  "创作一段雨夜街头的电影感镜头…",
  "把这段文字拆解成连贯的分镜画面…",
  "为一场奇幻冒险生成场景和角色…",
  "为你的画面配上一段合适的音乐…",
  "写一段温暖的旁白，讲述这个故事…",
  "设计一支富有想象力的产品宣传片…",
  "从一句话开始，搭建你的创作工作流…",
];
const promptPlaceholder = ref(translate(placeholderPhrases[0]!));

onMounted(() => {
  // MarkDirector 本地化：清理 localStorage 中失效的旧工作区路径（如从源码版切换到独立封装），避免列目录时反复报 403。
  const restoredDirectory = workspaceDirectory.value;
  if (restoredDirectory) {
    void axios.get("/api/workspaces/check", {
      params: { directory: restoredDirectory }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
    }).catch((error: unknown) => {
      if (axios.isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0) && workspaceDirectory.value === restoredDirectory) {
        workspaceDirectory.value = "";
        workspaceStore.removeProject(restoredDirectory);
      }
    });
  }
  window.addEventListener("dragend", clearAttachmentDrag, true);
  window.addEventListener("drop", clearAttachmentDrag, true);
  window.addEventListener("blur", clearAttachmentDrag);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let phraseIndex = 0;
  watch([() => !!prompt.value, locale], ([hasInput], _previous, onCleanup) => {
    if (reduceMotion) {
      promptPlaceholder.value = translate(placeholderPhrases[0]!);
      return;
    }
    if (hasInput) return;
    const segmenter = new Intl.Segmenter(locale.value, { granularity: "grapheme" });
    const phrases = placeholderPhrases.map(phrase => [...segmenter.segment(translate(phrase))].map(part => part.segment));
    let characterCount = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    promptPlaceholder.value = "";

    function typePlaceholder() {
      const phrase = phrases[phraseIndex]!;
      characterCount += deleting ? -1 : 1;
      promptPlaceholder.value = phrase.slice(0, characterCount).join("");
      let delay = deleting ? 35 : 85;
      if (characterCount === phrase.length) {
        deleting = true;
        delay = 1800;
      } else if (characterCount === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % placeholderPhrases.length;
        delay = 300;
      }
      timer = setTimeout(typePlaceholder, delay);
    }

    timer = setTimeout(typePlaceholder, 300);
    onCleanup(() => clearTimeout(timer));
  }, { immediate: true });
});

onUnmounted(() => {
  pageLifetime.abort();
  if (router.currentRoute.value.path !== "/workspace") workspaceStore.projectLoading = false;
  window.removeEventListener("dragend", clearAttachmentDrag, true);
  window.removeEventListener("drop", clearAttachmentDrag, true);
  window.removeEventListener("blur", clearAttachmentDrag);
});
watch([creating, opening], ([creating, opening]) => {
  if (creating || opening) {
    clearAttachmentDrag();
    workspaceStore.projectLoadingDrawn = false;
    workspaceStore.projectLoading = true;
  } else if (router.currentRoute.value.path !== "/workspace") {
    workspaceStore.projectLoading = false;
  }
}, { flush: "sync" });

const selectedModel = ref("");
const reasoningEffort = ref("");
const sortedProjects = computed(() => [...projectList.value].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt));

// 项目档案按需读取：串行排队，避免一次开十几个请求把本地服务打满。
const metaQueue: string[] = [];
let metaRunning = false;
async function drainProjectMetas() {
  if (metaRunning) return;
  metaRunning = true;
  try {
    while (metaQueue.length) {
      const directory = metaQueue.shift()!;
      if (directory in projectMetas.value) continue;
      const meta = await readProjectMeta(directory, pageLifetime.signal).catch(() => null);
      if (pageLifetime.signal.aborted) return;
      projectMetas.value = { ...projectMetas.value, [directory]: meta };
    }
  } finally { metaRunning = false; }
}
watch(sortedProjects, list => {
  for (const item of list) {
    if (!(item.directory in projectMetas.value) && !metaQueue.includes(item.directory)) metaQueue.push(item.directory);
  }
  void drainProjectMetas();
}, { immediate: true });

function scrollToSection(section: string) {
  const wrap = pageScroll.value?.wrapRef;
  const target = wrap?.querySelector<HTMLElement>(`[data-home-section="${section}"]`);
  if (!wrap || !target) return;
  activeSection.value = section;
  pageScroll.value?.scrollTo({
    top: section === "home" ? 0 : wrap.scrollTop + target.getBoundingClientRect().top - wrap.getBoundingClientRect().top - 32,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
}

function updateActiveSection() {
  const wrap = pageScroll.value?.wrapRef;
  if (!wrap) return;
  backgroundScrollTop.value = wrap.scrollTop;
  const top = wrap.getBoundingClientRect().top + 120;
  for (const section of wrap.querySelectorAll<HTMLElement>("[data-home-section]")) {
    if (section.getBoundingClientRect().top <= top) activeSection.value = section.dataset.homeSection!;
  }
}

function pasteAttachments(event: ClipboardEvent) {
  if (creating.value || opening.value) return;
  try {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) {
      const file = createPastedTextFile(event.clipboardData?.getData("text/plain") ?? "");
      if (file) files.push(file);
    }
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addAttachments(files);
  } catch (error) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ElMessage.error(error instanceof Error ? error.message : "添加附件失败，请重试");
  }
}

function selectAttachments(event: Event) {
  const input = event.target as HTMLInputElement;
  addAttachments(Array.from(input.files ?? []));
  input.value = "";
}

function clearAttachmentDrag() {
  attachmentDragDepth = 0;
  draggingAttachments.value = false;
}

function dragEnterAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  if (creating.value || opening.value) return clearAttachmentDrag();
  attachmentDragDepth++;
  draggingAttachments.value = true;
}

function dragOverAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = creating.value || opening.value ? "none" : "copy";
  if (creating.value || opening.value) return clearAttachmentDrag();
  attachmentDragDepth = Math.max(1, attachmentDragDepth);
  draggingAttachments.value = true;
}

function dragLeaveAttachments(event: DragEvent) {
  if (!draggingAttachments.value) return;
  attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
  const target = event.currentTarget;
  if (!attachmentDragDepth || (target instanceof Node && event.relatedTarget instanceof Node && !target.contains(event.relatedTarget))) clearAttachmentDrag();
}

function dropAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  clearAttachmentDrag();
  addAttachments(Array.from(event.dataTransfer.files));
}

function addAttachments(files: File[]) {
  if (creating.value || opening.value) return;
  for (const file of files) {
    const readableMimeType = getReadableFileMimeType(file.name, file.type);
    const mimeType = readableMimeType ?? file.type.split(";")[0]!.trim().toLowerCase();
    if (!readableMimeType && !/^(image|video)\//.test(mimeType)) {
      ElMessage.warning("只支持图片、视频和受支持的文本或文档文件");
      continue;
    }
    if (!file.size || file.size > 100 * 1024 * 1024) {
      ElMessage.warning("附件不能为空且不能超过 100 MB");
      continue;
    }
    if (mimeType === "text/plain" && file.size > 400000) {
      ElMessage.warning("文本附件不能超过 400 KB（400000 字节），请缩减内容后重试。");
      continue;
    }
    if (promptAttachments.value.length >= 20) {
      ElMessage.warning("每条消息最多添加 20 个附件");
      break;
    }
    promptAttachments.value.push({ name: file.name, path: "", mimeType, file });
  }
}

async function restoreAttachment(index: number) {
  const attachment = promptAttachments.value[index];
  if (attachment?.mimeType !== "text/plain" || creating.value || opening.value) return;
  try {
    const text = await readTextAttachment(attachment);
    const currentIndex = promptAttachments.value.indexOf(attachment);
    if (currentIndex < 0 || creating.value || opening.value) return;
    prompt.value += `${prompt.value ? "\n" : ""}${text}`;
    promptAttachments.value.splice(currentIndex, 1);
    await nextTick();
    promptInput.value?.focus();
    promptInput.value?.textarea?.setSelectionRange(prompt.value.length, prompt.value.length);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取回文本失败，请重试");
  }
}

async function enterWorkspace() {
  await waitForControlValue(() => workspaceStore.projectLoadingDrawn || undefined, pageLifetime.signal).catch(error => {
    if (!pageLifetime.signal.aborted) throw error;
  });
  if (pageLifetime.signal.aborted) return;
  if (!document.hidden) await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (pageLifetime.signal.aborted) return;
  await router.push("/workspace");
}

async function openProject(project: Project) {
  if (creating.value || opening.value) return;
  opening.value = true;
  try {
    const directory = project.directory;
    try { await workspaceStore.openProject(directory); }
    catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status !== 404 && status !== 403) throw err;
      const reselect = await ElMessageBox.confirm(`项目“${project.name}”的文件夹不存在或不在当前工作区内，是否重新选择文件夹？`, "工作目录不可用", {
        confirmButtonText: "重新选择", cancelButtonText: "取消", type: "warning",
      }).then(() => true, () => false);
      if (!reselect) return;
      const directory = await relocationPicker.value?.chooseDirectory();
      if (!directory) return;
      await workspaceStore.openProject(directory, project.directory);
    }
    await enterWorkspace();
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally { opening.value = false; }
}

async function manageProject(project: Project) {
  if (creating.value || opening.value) return;
  opening.value = true;
  try {
    await workspaceStore.openProject(project.directory);
    await router.push("/project");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally { opening.value = false; }
}

async function exportProject(project: Project) {
  if (creating.value || opening.value || exportingDirectory.value) return;
  const directory = project.directory;
  exportingDirectory.value = directory;
  try {
    let name = project.name.replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, "_").slice(0, 120).replace(/[. ]+$/, "");
    if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "MarkDirector";
    const files = useWorkspaceFiles(directory);
    await saveFile(() => files.exportZip(pageLifetime.signal), `${name}.zip`);
  } catch (error) {
    if (pageLifetime.signal.aborted) return;
    let message = error instanceof Error ? error.message : translate("导出项目失败，请重试");
    if (axios.isAxiosError(error)) {
      const data = error.response?.data instanceof Blob
        ? await error.response.data.text().then(JSON.parse).catch(() => null) : error.response?.data;
      if (typeof data?.message === "string") message = data.message;
    }
    ElMessage.error(message);
  } finally { exportingDirectory.value = ""; }
}

async function renameProject(project: Project) {
  const result = await ElMessageBox.prompt("请输入项目名称", "重命名项目", {
    inputValue: project.name, confirmButtonText: "保存", cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "项目名称不能为空",
  }).catch(() => null);
  if (result) {
    workspaceStore.renameProject(project.directory, result.value);
    void patchProjectMeta(project.directory, { name: result.value.trim() }).catch(() => {});
    const meta = projectMetas.value[project.directory];
    if (meta) projectMetas.value = { ...projectMetas.value, [project.directory]: { ...meta, name: result.value.trim() } };
  }
}

// Enter 直接发送（等同点发送按钮），Shift+Enter 换行；输入法组词中的回车不拦截。
function handlePromptKeydown(event: Event) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (creating.value || opening.value) return;
  if (workspaceDirectory.value) startComposerProject();
  else promptWorkspacePicker.value?.chooseDirectory();
}

function openNewProjectDialog() {
  if (creating.value || opening.value) return;
  dialogBaseDirectory.value = "";
  composerCreate.value = false;
  newProjectVisible.value = true;
}

// 输入区已经选好文件夹：先让用户填项目名/风格/比例，再在所选目录下建同名子文件夹。
function startComposerProject() {
  if (creating.value || opening.value || !workspaceDirectory.value) return;
  dialogBaseDirectory.value = workspaceDirectory.value;
  composerCreate.value = true;
  newProjectVisible.value = true;
}

function openProjectInfo(project: Project) {
  if (creating.value || opening.value) return;
  infoDirectory.value = project.directory;
  infoMeta.value = projectMetas.value[project.directory] ?? null;
  infoVisible.value = true;
}

function onProjectInfoSaved(updated: ProjectMeta) {
  if (!infoDirectory.value) return;
  projectMetas.value = { ...projectMetas.value, [infoDirectory.value]: updated };
}

const BLANK_CANVAS = { markdirectorCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
type ProjectEntry = { name: string; path: string; type: "file" | "directory" };

function hasProjectMetaFile(entries: { name: string }[]) {
  return entries.some(entry => entry.name.toLowerCase() === PROJECT_META_FILE.toLowerCase());
}

/** 保证项目里至少有一张能打开的画布：进入项目即可开工，不用先手动建文件。 */
async function ensureCanvasFile(directory: string, entries: ProjectEntry[]) {
  const files = useWorkspaceFiles(directory);
  const jsonFiles = entries.filter(entry => entry.type === "file" && /\.json$/i.test(entry.name)).slice(0, 40);
  for (const entry of jsonFiles) {
    if (await isCanvasFile(files, entry.path).catch(() => false)) return;
  }
  const names = new Set(entries.map(entry => entry.name.toLowerCase()));
  let number = 1;
  while (names.has(`画布${number}.json`.toLowerCase())) number += 1;
  await files.writeJson(`画布${number}.json`, BLANK_CANVAS, true).catch(error => {
    if (axios.isAxiosError(error) && error.response?.status === 409) return;
    throw error;
  });
}

/** 打开或新建项目的统一收尾：缺项目档案就补，缺画布就补，已有文件一律不动。 */
async function prepareProjectDirectory(directory: string, meta?: ProjectMeta) {
  const files = useWorkspaceFiles(directory);
  const { entries } = await files.list();
  let finalMeta: ProjectMeta | null;
  if (hasProjectMetaFile(entries)) {
    finalMeta = await readProjectMeta(directory);
  } else {
    finalMeta = meta ?? createProjectMeta(directoryDisplayName(directory));
    await files.writeJson(PROJECT_META_FILE, finalMeta, true).catch(error => {
      if (axios.isAxiosError(error) && error.response?.status === 409) return;
      throw error;
    });
  }
  if (finalMeta) projectMetas.value = { ...projectMetas.value, [directory]: finalMeta };
  // 只在本次新建项目时补画布；已有项目交给画布面板按需创建，避免多出空画布。
  if (!hasProjectMetaFile(entries)) await ensureCanvasFile(directory, entries);
  return finalMeta;
}

function sanitizeProjectFolder(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/[\r\n\t]/g, " ").replace(/[. ]+$/, "").slice(0, 60).trim() || "未命名项目";
}

/** 在所选位置下新建“剧名”子文件夹；重名时自动加序号，绝不覆盖已有目录。 */
async function createProjectFolder(base: string, name: string) {
  const files = useWorkspaceFiles(base);
  const folder = sanitizeProjectFolder(name);
  for (let index = 1; index <= 99; index++) {
    const candidate = index === 1 ? folder : `${folder} (${index})`;
    try {
      await files.mkdir(candidate);
      return `${base.replace(/[\\/]+$/, "")}/${candidate}`;
    } catch (error) {
      const exists = axios.isAxiosError<{ data?: { code?: string } }>(error)
        && (error.response?.data?.data?.code === "EEXIST" || error.response?.status === 409);
      if (!exists) throw error;
    }
  }
  throw new Error("同名文件夹过多，请换一个项目名");
}

async function createProjectFromMeta(payload: { name: string; style: ProjectStyleId; aspect: ProjectAspect; directory: string }) {
  if (creating.value || opening.value) return;
  creating.value = true;
  try {
    const { directory: base } = await useWorkspaceFiles(payload.directory).list();
    const projectDirectory = await createProjectFolder(base, payload.name);
    const meta = createProjectMeta(payload.name, payload.style, payload.aspect);
    const saved = await prepareProjectDirectory(projectDirectory, meta);
    newProjectVisible.value = false;
    dialogBaseDirectory.value = "";
    await workspaceStore.openProject(projectDirectory);
    workspaceStore.renameProject(projectDirectory, saved?.name || meta.name);
    // 从输入区发起时才把草稿带进新项目；从项目列表新建则不受输入框残留影响。
    if (composerCreate.value && (prompt.value.trim() || promptAttachments.value.length)) {
      workspaceStore.pendingAgentMessage = { directory: projectDirectory, prompt: prompt.value, attachments: [...promptAttachments.value], model: selectedModel.value, reasoningEffort: reasoningEffort.value };
    }
    composerCreate.value = false;
    await enterWorkspace();
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法创建项目，请重试"
      : err instanceof Error ? err.message : "无法创建项目，请重试");
  } finally {
    creating.value = false;
  }
}

async function openExistingProject() {
  if (creating.value || opening.value) return;
  const path = await relocationPicker.value?.chooseDirectory();
  if (!path || creating.value || opening.value || pageLifetime.signal.aborted) return;
  creating.value = true;
  try {
    const files = useWorkspaceFiles(path);
    const { directory, empty, entries } = await files.list();
    if (!empty) {
      const looksLikeProject = hasProjectMetaFile(entries)
        || entries.some(entry => entry.type === "directory" && entry.name.toLowerCase() === "assets")
        || entries.some(entry => entry.type === "file" && /\.json$/i.test(entry.name));
      const proceed = looksLikeProject || await ElMessageBox.confirm(
        `「${directoryDisplayName(directory)}」里没有找到项目档案或画布，可能不是 MarkDirector 项目文件夹。继续会补建项目档案与画布后打开，原有文件不会被删除。`,
        "打开这个文件夹",
        { type: "warning", confirmButtonText: "继续打开", cancelButtonText: "重新选择", closeOnClickModal: false },
      ).then(() => true, () => false);
      if (!proceed) {
        creating.value = false;
        await nextTick();
        await relocationPicker.value?.chooseDirectory();
        return;
      }
    }
    await prepareProjectDirectory(directory);
    await workspaceStore.openProject(directory);
    await enterWorkspace();
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally {
    creating.value = false;
  }
}
</script>

<style lang="scss" scoped>
.home {
  --sidebarWidth: 240px;
  --sidebarMotion: 220ms;
  --sidebarFade: 140ms;
  position: relative;
  display: grid;
  grid-template-columns: var(--sidebarWidth) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
  color: var(--el-text-color-primary);
  background: color-mix(in srgb, var(--el-bg-color) 96%, var(--el-text-color-primary));
  transition: grid-template-columns var(--sidebarMotion) ease;

  @media (prefers-reduced-motion: reduce) { transition: none; }

  .topPromotion { grid-column: 1 / -1; grid-row: 1; z-index: 1; }

  .pageBackground {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--sidebarWidth);
    width: calc(100% - var(--sidebarWidth));
    transition: inset-inline-start var(--sidebarMotion) ease, width var(--sidebarMotion) ease;

    @media (prefers-reduced-motion: reduce) { transition: none; }
  }

  &.sidebarCollapsed {
    --sidebarWidth: 72px;

    .homeSidebar {
      .sidebarPromotion { display: none; }
      .sidebarHeader {
        .sidebarBrand {
          gap: 0;

          .brandName { max-width: 0; opacity: 0; }
        }

        .sidebarToggle { inset-inline-start: 9px; opacity: 0; }

        @media (min-width: 901px) {
          &:hover, &:has(.sidebarToggle:focus-visible) {
            .sidebarLogo { opacity: 0; }
            .sidebarToggle { opacity: 1; }
          }
        }
      }

      .sidebarItem {
        gap: 0;
        padding-inline: 14px;

        .sidebarText { max-width: 0; opacity: 0; }
      }
    }
  }

  .homeSidebar {
    position: relative;
    grid-column: 1;
    grid-row: 2;
    min-height: 0;
    display: flex;
    flex: 0 0 var(--sidebarWidth);
    flex-direction: column;
    width: var(--sidebarWidth);
    padding: 20px 12px 16px;
    overflow-x: hidden;
    overflow-y: auto;
    border-inline-end: 1px solid var(--el-border-color-lighter);
    background: inherit;
    transition: flex-basis var(--sidebarMotion) ease, width var(--sidebarMotion) ease;

    .sidebarHeader {
      position: relative;
      display: flex;
      align-items: center;
      flex-shrink: 0;
      height: 30px;
      gap: 8px;
      margin-bottom: 24px;
      padding: 0 8px;

      .sidebarBrand {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 9px;
        overflow: hidden;
        transition: gap var(--sidebarMotion) ease;

        .sidebarLogo {
          flex-shrink: 0;
          width: 30px;
          height: 30px;
          transition: opacity var(--sidebarFade) ease;
        }

        .brandName {
          max-width: 150px;
          overflow: hidden;
          font-size: 20px;
          font-weight: 600;
          letter-spacing: -0.5px;
          white-space: nowrap;
          transition: max-width var(--sidebarMotion) ease, opacity var(--sidebarFade) ease;
        }
      }

      .sidebarToggle {
        position: absolute;
        top: 1px;
        inset-inline-start: calc(100% - 32px);
        display: grid;
        flex-shrink: 0;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: var(--ui-radius);
        background: transparent;
        color: var(--el-text-color-secondary);
        cursor: pointer;
        transition: inset-inline-start var(--sidebarMotion) ease, opacity var(--sidebarFade) ease;

        &:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
        &:dir(rtl) svg { transform: scaleX(-1); }
      }
    }

    .sidebarItem {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      min-height: 42px;
      width: 100%;
      gap: 10px;
      padding: 10px 12px;
      border: 0;
      border-radius: var(--ui-radius);
      background: transparent;
      color: var(--el-text-color-regular);
      font: inherit;
      font-size: 14px;
      line-height: 1.5;
      text-align: start;
      text-decoration: none;
      cursor: pointer;
      transition: gap var(--sidebarMotion) ease, padding var(--sidebarMotion) ease;

      > svg { flex-shrink: 0; }
      .sidebarText {
        min-width: 0;
        max-width: 180px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        transition: max-width var(--sidebarMotion) ease, opacity var(--sidebarFade) ease;
      }

      .sidebarIcon {
        position: relative;
        display: inline-flex;
        flex-shrink: 0;

        .connectionDot, .updateDot {
          position: absolute;
          top: -2px;
          inset-inline-end: -3px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--el-color-success);
          box-shadow: 0 0 0 2px var(--el-bg-color);
        }

        .updateDot { background: var(--el-color-danger); }
      }

      &:hover:not(:disabled) { background: var(--el-fill-color); color: var(--el-text-color-primary); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
      &:disabled { cursor: wait; opacity: 0.6; }
      &.active { background: var(--el-fill-color-darker); color: var(--el-text-color-primary); font-weight: 500; }
      &.connected { color: var(--el-color-success); }
    }

    .sidebarNav, .sidebarFooter { display: flex; flex-direction: column; gap: 4px; }
    .sidebarNav {
      .sidebarDivider { margin: 12px 8px; border: 0; border-top: 1px solid var(--el-border-color-lighter); }
    }
    .sidebarFooter { margin-top: auto; padding-top: 24px; }

    @media (prefers-reduced-motion: reduce) {
      --sidebarMotion: 0ms;
      --sidebarFade: 0ms;
    }
  }

  .pageScroll {
    grid-column: 2;
    grid-row: 2;
    position: relative;
    flex: 1;
    min-width: 0;
    height: 100%;

    :deep(.el-scrollbar__view) { min-height: 100%; }

    .pageBody {
      position: relative;
      min-height: 100%;

      .pageContent {
        padding: 24px clamp(20px, 4vw, 56px) 56px;

        .creationPanel {
          max-width: 800px;
          margin: clamp(36px, 6vh, 76px) 0 54px;

          .brand {
            display: flex;
            align-items: center;
            gap: clamp(8px, 1vw, 12px);
            margin-bottom: 28px;

            .brandLogo {
              flex-shrink: 0;
              width: clamp(28px, 3.4vw, 44px);
              height: clamp(28px, 3.4vw, 44px);
            }

            h1 {
              margin: 0;
              font-size: clamp(22px, 3vw, 34px);
              font-weight: 500;
              line-height: 1.3;
              letter-spacing: -0.5px;
            }
          }

          .promptArea {
            position: relative;

            .promptCard {
              position: relative;
              border-radius: calc(var(--ui-radius) * 3);
              border-color: var(--el-border-color-light);
              background: var(--el-bg-color-overlay);
              box-shadow: 0 12px 36px rgb(0 0 0 / 6%), inset 0 1px 0 color-mix(in srgb, var(--el-text-color-primary) 4%, transparent);
              transition: border-color 0.2s, box-shadow 0.2s;

              &:focus-within, &.draggingAttachments {
                border-color: var(--el-color-primary-light-5);
                box-shadow: 0 12px 36px rgb(0 0 0 / 6%), 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
              }

              :deep(.el-card__body) {
                padding: 20px 22px 8px;
              }

              .attachmentDropOverlay {
                position: absolute;
                inset: 0;
                z-index: 2;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                border-radius: inherit;
                background: var(--el-bg-color);
                color: var(--el-text-color-primary);
                pointer-events: none;

                > svg { color: var(--el-text-color-secondary); }
                strong { font-size: 14px; font-weight: 500; }
                span { color: var(--el-text-color-secondary); font-size: 12px; }
              }

              .promptAttachments {
                margin-bottom: 12px;
              }

              :deep(.el-textarea__inner) {
                padding: 4px 0;
                box-shadow: none;
                background: transparent;
                font-size: 15px;
                line-height: 1.9;
              }

              :deep(.el-card__footer) {
                padding: 8px 14px 14px;
                border-top: 0;
                background: transparent;
              }

              .composerFooter {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;

                .composerTools {
                  display: flex;
                  align-items: center;
                  flex: 1 1 160px;
                  min-width: 0;
                  gap: 6px;

                  .attachmentButton {
                    flex-shrink: 0;
                    width: 36px;
                    height: 36px;
                    margin: 0;
                    background: var(--el-fill-color-light);
                    color: var(--el-text-color-regular);

                    &:hover:not(:disabled) {
                      background: var(--el-color-primary-light-9);
                      color: var(--el-color-primary);
                    }
                  }

                  :deep(.workspaceButton) {
                    max-width: calc(100% - 42px);
                    height: 36px;
                    margin: 0;
                    padding: 0 10px;
                    border-radius: calc(var(--ui-radius) * 2);
                    color: var(--el-text-color-secondary);
                  }
                }

                .sendActions {
                  display: flex;
                  align-items: center;
                  justify-content: flex-end;
                  min-width: 0;
                  max-width: 100%;
                  margin-inline-start: auto;
                  gap: 8px;

                  .sendHint {
                    flex-shrink: 0;
                    color: var(--el-text-color-placeholder);
                    font-size: 12px;
                    white-space: nowrap;
                  }

                  .modelSelect {
                    min-width: 0;
                    max-width: 280px;

                    :deep(.modelButton) {
                      height: 36px;
                      border-radius: calc(var(--ui-radius) * 2);
                    }
                  }

                  .sendButton {
                    flex-shrink: 0;
                    height: 38px;
                    margin: 0;
                    border-radius: calc(var(--ui-radius) * 2);

                    &.is-circle { width: 38px; border-radius: 50%; }
                  }
                }

                @media (max-width: 560px) {
                  .composerTools { flex-basis: 100%; }

                  .sendActions {
                    width: 100%;
                    justify-content: space-between;

                    .modelSelect { flex: 1; }
                  }
                }
              }

              @media (prefers-reduced-motion: reduce) {
                transition: none;
              }
            }

            .workspaceHint {
              margin: 12px 16px 0;
              color: var(--el-text-color-secondary);
              font-size: 12px;
              line-height: 1.7;
            }
          }
        }

        .projectList {
          max-width: 1280px;
          margin: 0 auto;

          .projectTabs {
            display: flex;
            flex-wrap: wrap;
            gap: 28px;
            margin: 0 0 20px;
            font-size: 22px;
            font-weight: 600;
            line-height: 1.5;

            button {
              min-height: 44px;
              padding: 0;
              border: 0;
              border-radius: var(--ui-radius);
              background: transparent;
              color: var(--el-text-color-secondary);
              font: inherit;
              text-align: start;
              cursor: pointer;

              &.active { color: var(--el-text-color-primary); }
              &:hover { color: var(--el-color-primary); }
              &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 4px; }
            }
          }

          .teamProjects { min-height: 240px; }

          .projectItems {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
            grid-auto-rows: 1fr;
            gap: 20px;

            .projectLaunchCard {
              position: relative;
              border-radius: calc(var(--ui-radius) * 2.5);
              border-color: var(--el-border-color-lighter);
              background: var(--el-bg-color-overlay);
              box-shadow: var(--el-box-shadow-lighter);

              &:focus-within {
                border-color: var(--el-color-primary-light-5);
              }

              .projectLaunch {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                justify-content: center;
                gap: 8px;
                width: 100%;
                height: 100%;
                min-height: 214px;
                padding: 16px;
                border-radius: calc(var(--ui-radius) * 2.5);

                .launchPrimary {
                  display: flex;
                  flex: 1;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  gap: 10px;
                  width: 100%;
                  padding: 16px 12px;
                  border: 1px dashed var(--el-border-color);
                  border-radius: calc(var(--ui-radius) * 2);
                  background: transparent;
                  color: inherit;
                  font: inherit;
                  text-align: center;
                  cursor: pointer;
                  transition: border-color 0.18s ease, background-color 0.18s ease;

                  &:hover:not(:disabled) {
                    border-color: color-mix(in srgb, var(--md-gold) 55%, transparent);
                    background: color-mix(in srgb, var(--md-gold) 7%, transparent);
                  }
                  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
                  &:disabled { cursor: wait; opacity: 0.6; }

                  .launchIcon {
                    display: grid;
                    place-items: center;
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    background: var(--md-gold-faint);
                    color: var(--md-gold);

                    .isLoading { animation: launchSpin 1.5s linear infinite; }

                    @media (prefers-reduced-motion: reduce) {
                      .isLoading { animation: none; }
                    }
                  }

                  .launchText {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;

                    .launchTitle { font-size: 15px; font-weight: 500; line-height: 1.6; }
                    .launchDescription { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
                  }
                }

                .launchSecondary {
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  gap: 6px;
                  width: 100%;
                  padding: 8px;
                  border: 0;
                  border-radius: var(--ui-radius);
                  background: transparent;
                  color: var(--el-text-color-secondary);
                  font: inherit;
                  font-size: 12px;
                  cursor: pointer;

                  &:hover:not(:disabled) { color: var(--md-gold); }
                  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
                  &:disabled { cursor: wait; opacity: 0.6; }
                }
              }
            }
          }
        }
      }
    }
  }

  @media (max-width: 900px) {
    --sidebarWidth: 72px;

    .homeSidebar {
      .sidebarPromotion { display: none; }
      .sidebarHeader {
        .sidebarBrand {
          gap: 0;

          .brandName { max-width: 0; opacity: 0; }
        }

        .sidebarToggle { display: none; }
      }

      .sidebarItem {
        gap: 0;
        padding-inline: 14px;

        .sidebarText { max-width: 0; opacity: 0; }
      }
    }
  }

  @media (max-width: 560px) {
    .pageScroll .pageBody .pageContent { padding: 24px 16px 40px; }
    .homeSidebar .sidebarItem { min-height: 44px; }
  }
}
@keyframes launchSpin {
  to { transform: rotate(360deg); }
}
</style>
