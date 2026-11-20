import useWorkspaceFiles from "./workspaceFiles";

/** 项目档案文件名，固定放在项目根目录。 */
export const PROJECT_META_FILE = "project.json";

export type ProjectStyleId = "3d" | "2d" | "real" | "ink" | "comic" | "custom";
export type ProjectAspect = "16:9" | "9:16" | "1:1";
export type EpisodeStatus = "draft" | "producing" | "done";

export type EpisodeMeta = {
  id: string;
  title: string;
  dir?: string;
  status?: EpisodeStatus;
  duration?: number;
  resolution?: string;
};

export type ProjectAssetItem = {
  id: string;
  name: string;
  role?: string;
  refs?: string[];
  prompt?: string;
  desc?: string;
};

export type ProjectAssets = {
  characters: ProjectAssetItem[];
  scenes: ProjectAssetItem[];
  props: ProjectAssetItem[];
};

export type ProjectMeta = {
  schema: string;
  name: string;
  style: ProjectStyleId;
  aspect: ProjectAspect;
  createdAt: number;
  cover?: string;
  episodes: EpisodeMeta[];
  assets: ProjectAssets;
};

export const PROJECT_META_SCHEMA = "markdirector.project/1";

export const PROJECT_STYLES: { id: ProjectStyleId; name: string; hint: string }[] = [
  { id: "3d", name: "3D 漫剧", hint: "游戏引擎级 3D 渲染，半写实角色" },
  { id: "2d", name: "2D 日漫", hint: "赛璐璐上色，二次元人物" },
  { id: "real", name: "写实电影", hint: "真人质感，胶片级调色" },
  { id: "ink", name: "水墨古风", hint: "国风写意，留白构图" },
  { id: "comic", name: "美漫硬核", hint: "粗描边，高对比，强戏剧性" },
  { id: "custom", name: "自定义", hint: "按项目内 style.md 自由描述" },
];

export const PROJECT_ASPECTS: { id: ProjectAspect; label: string }[] = [
  { id: "16:9", label: "16:9 · 横屏" },
  { id: "9:16", label: "9:16 · 竖屏" },
  { id: "1:1", label: "1:1 · 方形" },
];

export function projectStyleName(id: string | undefined) {
  return PROJECT_STYLES.find(item => item.id === id)?.name ?? PROJECT_STYLES[0]!.name;
}

export function projectStyleHint(id: string | undefined) {
  return PROJECT_STYLES.find(item => item.id === id)?.hint ?? PROJECT_STYLES[0]!.hint;
}

export function emptyProjectAssets(): ProjectAssets {
  return { characters: [], scenes: [], props: [] };
}

export function createProjectMeta(
  name: string,
  style: ProjectStyleId = "3d",
  aspect: ProjectAspect = "16:9",
): ProjectMeta {
  return {
    schema: PROJECT_META_SCHEMA,
    name: name.trim(),
    style,
    aspect,
    createdAt: Date.now(),
    episodes: [],
    assets: emptyProjectAssets(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asAssetList(value: unknown): ProjectAssetItem[] {
  if (!Array.isArray(value)) return [];
  const items: ProjectAssetItem[] = [];
  for (const raw of value) {
    const item = asRecord(raw);
    const name = asString(item.name).trim();
    if (!name) continue;
    items.push({
      id: asString(item.id).trim() || `asset_${items.length + 1}`,
      name,
      ...(asString(item.role) ? { role: asString(item.role) } : {}),
      refs: Array.isArray(item.refs) ? item.refs.filter((ref): ref is string => typeof ref === "string") : [],
      ...(asString(item.prompt) ? { prompt: asString(item.prompt) } : {}),
      ...(asString(item.desc) ? { desc: asString(item.desc) } : {}),
    });
  }
  return items;
}

function asEpisodeList(value: unknown): EpisodeMeta[] {
  if (!Array.isArray(value)) return [];
  const items: EpisodeMeta[] = [];
  for (const raw of value) {
    const item = asRecord(raw);
    const title = asString(item.title).trim();
    if (!title) continue;
    items.push({
      id: asString(item.id).trim() || String(items.length + 1).padStart(2, "0"),
      title,
      ...(asString(item.dir) ? { dir: asString(item.dir) } : {}),
      ...(item.status === "producing" || item.status === "done" || item.status === "draft" ? { status: item.status } : {}),
      ...(typeof item.duration === "number" && Number.isFinite(item.duration) ? { duration: item.duration } : {}),
      ...(asString(item.resolution) ? { resolution: asString(item.resolution) } : {}),
    });
  }
  return items;
}

/** 宽容解析：字段缺失或类型不对一律回退默认值，绝不因为档案损坏而打不开项目。 */
export function normalizeProjectMeta(raw: unknown, fallbackName: string): ProjectMeta {
  const value = asRecord(raw);
  const style = PROJECT_STYLES.find(item => item.id === value.style)?.id ?? "3d";
  const aspect = PROJECT_ASPECTS.find(item => item.id === value.aspect)?.id ?? "16:9";
  const assets = asRecord(value.assets);
  return {
    schema: asString(value.schema) || PROJECT_META_SCHEMA,
    name: asString(value.name).trim() || fallbackName,
    style,
    aspect,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    ...(asString(value.cover) ? { cover: asString(value.cover) } : {}),
    episodes: asEpisodeList(value.episodes),
    assets: {
      characters: asAssetList(assets.characters),
      scenes: asAssetList(assets.scenes),
      props: asAssetList(assets.props),
    },
  };
}

export function directoryDisplayName(directory: string) {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) || directory;
}

/** 读取项目档案；文件不存在或内容损坏都返回 null，由调用方回退到旧行为。 */
export async function readProjectMeta(directory: string, signal?: AbortSignal): Promise<ProjectMeta | null> {
  try {
    const raw = await useWorkspaceFiles(directory).readJson<unknown>(PROJECT_META_FILE, signal);
    signal?.throwIfAborted();
    return normalizeProjectMeta(raw, directoryDisplayName(directory));
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function writeProjectMeta(directory: string, meta: ProjectMeta) {
  await useWorkspaceFiles(directory).writeJson(PROJECT_META_FILE, meta);
}

/** 只改部分字段：先读、合并、再写，尽量不影响别人的改动。 */
export async function patchProjectMeta(directory: string, patch: Partial<ProjectMeta>) {
  const meta = await readProjectMeta(directory) ?? createProjectMeta(directoryDisplayName(directory));
  await writeProjectMeta(directory, { ...meta, ...patch });
}

export function projectEpisodeCount(meta: ProjectMeta | null | undefined) {
  return meta?.episodes.length ?? 0;
}

export function projectAssetCount(meta: ProjectMeta | null | undefined, kind: keyof ProjectAssets) {
  return meta?.assets[kind]?.length ?? 0;
}

export type ProjectStatus = "idle" | "producing" | "done";

export function projectStatus(meta: ProjectMeta | null | undefined): ProjectStatus {
  const episodes = meta?.episodes ?? [];
  if (!episodes.length) return "idle";
  if (episodes.every(item => item.status === "done")) return "done";
  if (episodes.some(item => item.status === "producing" || item.status === "done")) return "producing";
  return "idle";
}

export const PROJECT_STATUS_TEXT: Record<ProjectStatus, string> = {
  idle: "待开始",
  producing: "制作中",
  done: "已完成",
};
