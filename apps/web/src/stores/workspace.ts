import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const project = ref<Project | null>(null);
  const projectList = ref<Project[]>([]);
  const projectLoading = ref(false);
  const projectLoadingDrawn = ref(false);
  const projectLoadingVisible = ref(false);
  const pendingAgentMessage = ref<{ directory: string; prompt: string; attachments?: AgentAttachment[]; model: string; reasoningEffort: string; sessionName?: string; forceNewSession?: boolean } | null>(null);

  async function addProject(path: string, name?: string, signal?: AbortSignal, previousDirectory = path) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" }, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    const checkedDirectory = data.data.directory;
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    const added = { directory: checkedDirectory, name: name?.trim() || existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory, lastOpenedAt: Date.now() };
    // ACT: 项目列表是持久化状态，磁盘写不进去时不能连累「打开项目」本身失败。
    try {
      projectList.value = [
        added,
        ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
      ];
    } catch (error) {
      console.warn("项目列表保存失败，仅影响下次启动的最近项目记录", error);
    }
    return added;
  }

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    const opened = await addProject(path, undefined, signal, previousDirectory);
    try { project.value = opened; }
    catch (error) { console.warn("项目记录保存失败，本次打开不受影响", error); }
    // 只有真的换了项目才清待发消息：同一项目内刷新 / 切页不能把「交给工作区制作」的指令丢掉。
    if (pendingAgentMessage.value && pendingAgentMessage.value.directory !== opened.directory) pendingAgentMessage.value = null;
  }

  function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path);
    if (!target || !name.trim()) return;
    target.name = name.trim();
    if (project.value?.directory === path) project.value = target;
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = null;
  }

  return { project, projectList, projectLoading, projectLoadingDrawn, projectLoadingVisible, pendingAgentMessage, addProject, openProject, renameProject, removeProject };
}, {
  persist: {
    key: "markdirector.projectList",
    pick: ["project", "projectList", "pendingAgentMessage"],
  },
});
