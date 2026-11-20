import { z } from "zod";
import type { ToolContext, ToolPlugin } from "@markdirector/tools-scaffold/runtime";

const configSchema = z.strictObject({});

type Json = Record<string, unknown>;
type Progress = ((update: { content: { type: "text"; text: string }[]; details?: Json }) => void) | undefined;

const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|flv|ts)$/i;

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(input: string) {
  const cleaned = input.replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim();
  return cleaned.slice(0, 80) || `成片-${nowStamp()}`;
}

function even(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/** 执行一次宿主 ffmpeg 请求，返回 operation 的结果负载。 */
async function runFfmpeg(
  context: ToolContext,
  request: { options?: Json; steps?: { method: string; args: unknown[] }[]; operation?: { method: string; args: unknown[] } },
  signal?: AbortSignal,
) {
  let details: unknown;
  let failure: { message?: string } | undefined;
  let filenames: unknown;
  // ACT: 复用宿主 executeFfmpeg，不自行 spawn，才能沿用插件市场配置的可执行文件与进度事件。
  await context.executeFfmpeg({
    directory: context.cwd,
    requestId: crypto.randomUUID(),
    options: (request.options ?? {}) as never,
    calls: (request.steps ?? []) as never,
    operation: (request.operation ?? { method: "run", args: [] }) as never,
  } as never, event => {
    if (event.event === "error") failure = event.args[0] as { message?: string };
    else if (event.event === "result") details = event.args[0];
    else if (event.event === "filenames") filenames = event.args[0];
    else if (event.event === "end") {
      const extra = filenames ? { filenames } : {};
      details = { stdout: event.args[0], stderr: event.args[1], ...extra };
    }
  }, signal ?? new AbortController().signal);
  if (failure) throw Object.assign(new Error(failure.message ?? "FFmpeg 执行失败"), failure);
  return details as Json | undefined;
}

type ProbeResult = {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
};

async function probeMedia(context: ToolContext, path: string, signal?: AbortSignal): Promise<ProbeResult> {
  const data = await runFfmpeg(context, {
    steps: [{ method: "input", args: [path] }],
    operation: { method: "ffprobe", args: [{ options: [], json: true }] },
  }, signal);
  const raw = (data ?? {}) as Json;
  const streams = (Array.isArray(raw.streams) ? raw.streams : []) as Json[];
  const video = streams.find(item => item.codec_type === "video") as Json | undefined;
  const audio = streams.find(item => item.codec_type === "audio") as Json | undefined;
  const format = (raw.format ?? {}) as Json;
  const duration = Number(format.duration ?? video?.duration ?? 0);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    width: Number(video?.width ?? 0) || 0,
    height: Number(video?.height ?? 0) || 0,
    videoCodec: String(video?.codec_name ?? ""),
    audioCodec: String(audio?.codec_name ?? ""),
  };
}

type Clip = { nodeId?: string; label: string; path: string; url?: string };

function isRemote(url: string) {
  return /^https?:\/\//i.test(url);
}

/** 从节点 outputs 里取出视频地址。 */
function pickVideo(outputs: unknown): string | undefined {
  if (!outputs || typeof outputs !== "object") return undefined;
  for (const entry of Object.values(outputs as Json)) {
    if (!entry || typeof entry !== "object") continue;
    const dataType = String((entry as Json).dataType ?? "").toUpperCase();
    const value = (entry as Json).value;
    const url = typeof value === "string" ? value : (value as Json | undefined)?.url;
    if (typeof url !== "string" || !url.trim()) continue;
    const mime = typeof value === "object" && value ? String((value as Json).mimeType ?? "") : "";
    if (dataType === "VIDEO" || mime.startsWith("video/") || MEDIA_EXT.test(url)) return url.trim();
  }
  return undefined;
}

/** 收集激活画布上的节点摘要；没有画布上下文时返回空数组。 */
async function listCanvasNodes(context: ToolContext, signal?: AbortSignal) {
  const canvas = context.canvas;
  if (!canvas) return [];
  const summaries: { id: string; type: string; label: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const result = await canvas.call({
      name: "findCanvasNodes",
      args: { limit: 100, ...(cursor ? { cursor } : {}) },
    } as never, signal) as Json;
    for (const node of (Array.isArray(result?.nodes) ? result.nodes : []) as Json[]) {
      const id = String(node.id ?? "");
      if (!id) continue;
      summaries.push({
        id,
        type: String(node.type ?? ""),
        label: String(node.label ?? id),
      });
    }
    const next = result?.nextCursor;
    if (!result?.hasMore || typeof next !== "string" || !next) break;
    cursor = next;
  }
  return summaries;
}

async function readNodeOutputs(context: ToolContext, nodeIds: string[], signal?: AbortSignal) {
  const canvas = context.canvas;
  if (!canvas) return new Map<string, { label: string; url?: string; image?: string }>();
  const map = new Map<string, { label: string; url?: string; image?: string }>();
  for (let index = 0; index < nodeIds.length; index += 20) {
    const chunk = nodeIds.slice(index, index + 20);
    const result = await canvas.call({
      name: "getCanvasNodes",
      args: { nodeIds: chunk, fields: ["label", "type", "position", "outputs"] },
    } as never, signal) as Json;
    for (const node of (Array.isArray(result?.nodes) ? result.nodes : []) as Json[]) {
      const id = String(node.id ?? "");
      if (!id) continue;
      map.set(id, {
        label: String(node.label ?? id),
        url: pickVideo(node.outputs),
        image: pickImage(node.outputs),
      });
    }
  }
  return map;
}

/** 把画布节点或显式路径解析为本地片段清单。 */
async function resolveClips(
  context: ToolContext,
  args: { nodeIds?: string[]; paths?: string[] },
  signal?: AbortSignal,
): Promise<Clip[]> {
  if (args.paths?.length && args.nodeIds?.length) throw new Error("nodeIds 与 paths 只能二选一");
  const clips: Clip[] = [];
  if (args.paths?.length) {
    for (const path of args.paths) clips.push({ label: path, path, url: path });
    return clips;
  }
  if (!context.canvas) throw new Error("当前没有激活画布，无法自动识别视频节点；请改用 paths 指定工作区视频文件");
  const summaries = await listCanvasNodes(context, signal);
  if (!summaries.length) throw new Error("激活画布没有节点，或画布未连接；请确认画布已打开");
  const explicit = args.nodeIds?.length ? args.nodeIds : undefined;
  let targetIds: string[];
  if (explicit) {
    const known = new Set(summaries.map(item => item.id));
    const missing = explicit.filter(id => !known.has(id));
    if (missing.length) throw new Error(`画布中找不到节点：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " 等" : ""}`);
    targetIds = explicit;
  } else {
    // ACT: 自动模式只收视频类节点，避免把纯文本、图片节点混进成片清单。
    targetIds = summaries.filter(item => /video/i.test(item.type)).map(item => item.id);
    if (!targetIds.length) throw new Error("画布上没有视频节点；请先完成视频生成，或用 nodeIds / paths 显式指定片段");
  }
  const outputs = await readNodeOutputs(context, targetIds, signal);
  for (const id of targetIds) {
    const info = outputs.get(id);
    if (!info?.url) continue;
    clips.push({ nodeId: id, label: info.label, path: info.url, url: info.url });
  }
  if (!clips.length) throw new Error("选中的节点都没有视频输出；请确认视频已生成完成");
  return clips;
}

/** 远端地址先落到工作区临时目录，ffmpeg 只能处理本地文件。 */
async function localizeClip(context: ToolContext, clip: Clip, index: number, dir: string, signal?: AbortSignal) {
  if (!isRemote(clip.path)) {
    const absolute = await context.resolvePath(clip.path);
    // ACT: 片段缺失要在拼接前就报清楚，否则会等到 ffprobe 才失败，错误信息看不出是哪个文件。
    await context.files.access(absolute).catch(() => {
      throw new Error(`片段不存在或不可读：${clip.label}（${clip.path}）`);
    });
    return { ...clip, path: absolute };
  }
  const response = await fetch(clip.path, { signal });
  if (!response.ok) throw new Error(`下载片段失败（HTTP ${response.status}）：${clip.label}`);
  const mime = response.headers.get("content-type") ?? "";
  const guess = MEDIA_EXT.exec(new URL(clip.path).pathname)?.[0] ?? (mime.includes("webm") ? ".webm" : mime.includes("quicktime") ? ".mov" : ".mp4");
  const target = `${dir}/src-${String(index).padStart(3, "0")}${guess}`;
  await context.files.writeFile(target, new Uint8Array(await response.arrayBuffer()));
  const absolute = await context.resolvePath(target);
  return { ...clip, path: absolute };
}

function concatLine(path: string) {
  // ACT: concat demuxer 用单引号包裹，内部单引号按 ffmpeg 约定转义，Windows 反斜杠统一成正斜杠。
  const normalized = path.replaceAll("\\", "/").replaceAll("'", "'\\''");
  return `file '${normalized}'`;
}

type ExportPlan = {
  nodeIds?: string[];
  paths?: string[];
  outputName?: string;
  mode?: "auto" | "copy" | "reencode";
  resolution?: string;
  fps?: number;
  dryRun?: boolean;
};

async function exportOne(
  context: ToolContext,
  plan: ExportPlan,
  jobId: string,
  progress: Progress,
  signal?: AbortSignal,
) {
  const clips = await resolveClips(context, plan, signal);
  const requestedMode = plan.mode ?? "auto";
  const workDir = `.cache/episodeExport/${jobId}`;
  await context.files.mkdir(workDir, true);

  const localized: Clip[] = [];
  for (let index = 0; index < clips.length; index++) {
    localized.push(await localizeClip(context, clips[index]!, index, workDir, signal));
  }

  const probes: ProbeResult[] = [];
  for (const clip of localized) {
    probes.push(await probeMedia(context, clip.path, signal));
  }
  const totalDuration = probes.reduce((sum, item) => sum + item.duration, 0);

  if (plan.dryRun) {
    return {
      dryRun: true,
      clips: localized.map((clip, index) => ({
        index: index + 1,
        nodeId: clip.nodeId ?? null,
        label: clip.label,
        path: clip.path,
        duration: Number(probes[index]!.duration.toFixed(2)),
        resolution: `${probes[index]!.width}x${probes[index]!.height}`,
        audio: Boolean(probes[index]!.audioCodec),
      })),
      totalDuration: Number(totalDuration.toFixed(2)),
    };
  }

  const base = probes[0]!;
  const resolution = plan.resolution?.match(/^(\d+)x(\d+)$/i);
  // ACT: 默认取面积最大的片段作为目标规格，避免把高清片段降到低清；显式 resolution 时以参数为准。
  const largest = probes.reduce((best, item) => (item.width * item.height > best.width * best.height ? item : best), base);
  const width = even(resolution ? Number(resolution[1]) : (largest.width || 720));
  const height = even(resolution ? Number(resolution[2]) : (largest.height || 1280));
  const fps = plan.fps && plan.fps >= 1 && plan.fps <= 60 ? Math.round(plan.fps) : 30;

  const uniform = (() => {
    if (!probes.length) return false;
    const first = probes[0]!;
    if (!first.width || !first.height) return false;
    return probes.every(item =>
      item.videoCodec === first.videoCodec
      && item.width === first.width
      && item.height === first.height
      && item.audioCodec === first.audioCodec,
    );
  })();

  const outputName = safeName(plan.outputName?.trim() || `成片-${nowStamp()}`);
  const outputPath = `exports/${outputName}.mp4`;
  await context.files.mkdir("exports", true);
  const outputAbsolute = await context.resolvePath(outputPath);
  const listPath = `${workDir}/concat.txt`;

  let used: "copy" | "reencode" = requestedMode === "reencode" ? "reencode" : uniform ? "copy" : "reencode";

  async function concatCopy() {
    await context.files.writeFile(listPath, localized.map(clip => concatLine(clip.path)).join("\n") + "\n");
    await runFfmpeg(context, {
      steps: [
        { method: "input", args: [await context.resolvePath(listPath)] },
        { method: "inputOptions", args: [["-f", "concat", "-safe", "0"]] },
        { method: "outputOptions", args: [["-c", "copy", "-movflags", "+faststart", "-y"]] },
        { method: "output", args: [outputAbsolute] },
      ],
    }, signal);
  }

  async function renderSegments() {
    const segments: string[] = [];
    for (let index = 0; index < localized.length; index++) {
      const clip = localized[index]!;
      const probe = probes[index]!;
      const segmentPath = `${workDir}/seg-${String(index).padStart(3, "0")}.mp4`;
      const segmentAbsolute = await context.resolvePath(segmentPath);
      const hasAudio = Boolean(probe.audioCodec);
      const filters = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
      const outputFlags: string[] = [
        "-map", "0:v:0",
        "-map", hasAudio ? "0:a:0" : "1:a:0",
        "-vf", filters,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
        ...(hasAudio ? [] : ["-shortest"]),
        "-movflags", "+faststart", "-y",
      ];
      await runFfmpeg(context, {
        steps: [
          { method: "input", args: [clip.path] },
          ...(!hasAudio ? [
            { method: "input", args: ["anullsrc=channel_layout=stereo:sample_rate=48000"] },
            { method: "inputOptions", args: [["-f", "lavfi"]] },
          ] : []),
          { method: "outputOptions", args: [outputFlags] },
          { method: "output", args: [segmentAbsolute] },
        ],
      }, signal);
      segments.push(segmentAbsolute);
      progress?.({ content: [{ type: "text", text: `已归一化第 ${index + 1}/${localized.length} 段：${clip.label}` }], details: { stage: "normalize", index: index + 1, total: localized.length } });
    }
    const segmentList = segments.map(concatLine).join("\n") + "\n";
    const segListPath = `${workDir}/segments.txt`;
    await context.files.writeFile(segListPath, segmentList);
    await runFfmpeg(context, {
      steps: [
        { method: "input", args: [await context.resolvePath(segListPath)] },
        { method: "inputOptions", args: [["-f", "concat", "-safe", "0"]] },
        { method: "outputOptions", args: [["-c", "copy", "-movflags", "+faststart", "-y"]] },
        { method: "output", args: [outputAbsolute] },
      ],
    }, signal);
  }

  if (used === "copy") {
    try {
      await concatCopy();
    } catch (error) {
      if (requestedMode === "copy") throw error;
      // ACT: 流拷贝对编码参数极敏感，失败后自动回落到统一规格重编码，不让用户手工判断。
      progress?.({ content: [{ type: "text", text: "流拷贝失败，改为统一规格后重新拼接" }], details: { stage: "fallback" } });
      used = "reencode";
      await renderSegments();
    }
  } else {
    await renderSegments();
  }

  const stat = await context.files.stat(outputAbsolute).catch(() => undefined);
  if (!stat || stat.size <= 0) throw new Error(`拼接完成但输出文件为空：${outputPath}`);
  const finalProbe = await probeMedia(context, outputAbsolute, signal).catch(() => undefined);

  return {
    output: outputPath,
    clips: localized.length,
    mode: used,
    resolution: `${width}x${height}`,
    fps,
    totalDuration: Number((finalProbe?.duration || totalDuration).toFixed(2)),
    size: stat.size,
    sources: localized.map((clip, index) => ({
      index: index + 1,
      nodeId: clip.nodeId ?? null,
      label: clip.label,
      duration: Number((probes[index]?.duration ?? 0).toFixed(2)),
      resolution: `${probes[index]?.width ?? 0}x${probes[index]?.height ?? 0}`,
      audio: Boolean(probes[index]?.audioCodec),
    })),
  };
}

const exportSchema = z.strictObject({
  nodeIds: z.array(z.string().min(1).max(256)).max(200).optional().describe("按数组顺序拼接的节点 ID；省略时自动收集激活画布的视频节点，按创建顺序"),
  paths: z.array(z.string().min(1).max(4096)).max(200).optional().describe("直接指定工作区视频文件，与 nodeIds 二选一"),
  outputName: z.string().max(120).optional().describe("输出文件名，不含扩展名；默认成片-时间戳"),
  mode: z.enum(["auto", "copy", "reencode"]).default("auto").describe("auto 规格一致时无损拷贝，否则统一规格后重编码"),
  resolution: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional().describe("统一规格时的目标分辨率，如 1080x1920；默认取第一段"),
  fps: z.number().int().min(1).max(60).optional().describe("统一规格时的目标帧率，默认 30"),
  dryRun: z.boolean().default(false).describe("只返回片段清单，不执行拼接"),
  retries: z.number().int().min(0).max(3).default(1).describe("失败重试次数"),
  jobs: z.array(z.strictObject({
    nodeIds: z.array(z.string().min(1).max(256)).max(200).optional(),
    paths: z.array(z.string().min(1).max(4096)).max(200).optional(),
    outputName: z.string().max(120).optional(),
    mode: z.enum(["auto", "copy", "reencode"]).default("auto"),
    resolution: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
    fps: z.number().int().min(1).max(60).optional(),
    retries: z.number().int().min(0).max(3).default(1),
  })).max(50).optional().describe("批量任务；提供时忽略顶层片段参数，逐项执行并汇总结果"),
});

const characterSchema = z.strictObject({
  action: z.enum(["list", "sync", "set", "remove", "resolve"]).describe("list 查看；sync 从画布同步；set 手动登记；remove 删除；resolve 展开提示词"),
  name: z.string().min(1).max(64).optional().describe("角色名，作用于 set / remove；resolve 可省略"),
  path: z.string().min(1).max(4096).optional().describe("角色参考图的工作区路径，作用于 set"),
  features: z.string().max(600).optional().describe("稳定特征描述，作用于 set，展开时附在提示词里"),
  prompt: z.string().max(20000).optional().describe("待展开的提示词，作用于 resolve"),
  overwrite: z.boolean().default(false).describe("sync / set 时是否覆盖已有条目"),
});

type CharacterEntry = { name: string; path: string; features?: string; source?: string; updatedAt: string };

const CHARACTER_FILE = ".cache/characterRefs.json";

async function readRegistry(context: ToolContext): Promise<CharacterEntry[]> {
  const buffer = await context.files.readFile(CHARACTER_FILE, false, { maxBytes: 512 * 1024 }).catch(() => undefined);
  if (!buffer) return [];
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as { characters?: CharacterEntry[] };
    return Array.isArray(parsed.characters) ? parsed.characters : [];
  } catch {
    return [];
  }
}

async function writeRegistry(context: ToolContext, entries: CharacterEntry[]) {
  await context.files.mkdir(".cache", true);
  await context.files.writeFile(CHARACTER_FILE, JSON.stringify({ characters: entries }, null, 2));
}

function pickImage(outputs: unknown): string | undefined {
  if (!outputs || typeof outputs !== "object") return undefined;
  for (const entry of Object.values(outputs as Json)) {
    if (!entry || typeof entry !== "object") continue;
    const dataType = String((entry as Json).dataType ?? "").toUpperCase();
    const value = (entry as Json).value;
    const url = typeof value === "string" ? value : (value as Json | undefined)?.url;
    if (typeof url !== "string" || !url.trim()) continue;
    const mime = typeof value === "object" && value ? String((value as Json).mimeType ?? "") : "";
    if (dataType === "IMAGE" || mime.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(url)) return url.trim();
  }
  return undefined;
}

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    return [{
      name: "exportEpisode",
      label: "拼接导出成片",
      description: "把画布上的视频片段按顺序拼成一集成片，规格不一致时自动统一分辨率、帧率与音频；支持批量任务、失败重试和 dryRun 预览。",
      promptSnippet: "需要交付成片时使用 exportEpisode；先 dryRun 核对片段顺序，再正式拼接。",
      promptGuidelines: [
        "不传 nodeIds 时按激活画布节点创建顺序收集视频节点；要指定顺序就显式传 nodeIds，数组顺序即拼接顺序。",
        "输出默认写到 exports/ 目录，不覆盖已有文件；需要固定文件名时用 outputName。",
        "批量出多集用 jobs，每项独立执行，失败会自动重试并在回执里逐项列出。",
      ],
      executionMode: "sequential",
      parameters: z.toJSONSchema(exportSchema, { io: "input", target: "draft-07" }),
      async execute(_id: string, params: unknown, signal?: AbortSignal, onUpdate?: (update: { content: { type: "text"; text: string }[]; details?: Json }) => void) {
        const input = exportSchema.parse(params);
        if (input.dryRun && input.jobs?.length) throw new Error("dryRun 只用于单次任务，不能和 jobs 同时使用");
        if (input.jobs?.length) {
          const results: Json[] = [];
          for (let index = 0; index < input.jobs.length; index++) {
            const job = input.jobs[index]!;
            if (job.nodeIds?.length && job.paths?.length) throw new Error(`第 ${index + 1} 个任务同时给了 nodeIds 与 paths`);
            const retries = job.retries ?? input.retries;
            let attempt = 0;
            let lastError: Error | undefined;
            while (attempt <= retries) {
              try {
                onUpdate?.({ content: [{ type: "text", text: `开始第 ${index + 1}/${input.jobs.length} 个任务：${job.outputName ?? "自动命名"}${attempt ? `（第 ${attempt + 1} 次尝试）` : ""}` }], details: { stage: "job", index: index + 1, attempt } });
                const result = await exportOne(context, job, `job-${nowStamp()}-${index}`, undefined, signal);
                results.push({ index: index + 1, ok: true, ...result });
                lastError = undefined;
                break;
              } catch (error) {
                lastError = error as Error;
                attempt++;
                if (signal?.aborted) throw error;
              }
            }
            if (lastError) results.push({ index: index + 1, ok: false, error: lastError.message, attempts: attempt });
          }
          const ok = results.filter(item => item.ok).length;
          const text = `批量导出完成：成功 ${ok}/${results.length}${results.some(item => !item.ok) ? "，失败项见 details.results" : ""}`;
          return { content: [{ type: "text" as const, text }], details: { results } };
        }
        const result = await exportOne(context, input, `single-${nowStamp()}`, onUpdate, signal);
        const text = result.dryRun
          ? `共 ${(result.clips as unknown[]).length} 段，总时长 ${result.totalDuration} 秒，确认后去掉 dryRun 正式拼接`
          : `已导出成片：${result.output}（${result.clips} 段，${result.totalDuration} 秒，${result.mode === "copy" ? "无损拷贝" : "统一规格重编码"}）`;
        return { content: [{ type: "text" as const, text }], details: result };
      },
    }, {
      name: "resolveCharacterRefs",
      label: "角色参考解析",
      description: "维护工作区角色参考图登记表，从画布同步角色素材，或把提示词里的 @角色名 展开为按顺序的素材清单，供 {{ref N}} 编号使用。",
      promptSnippet: "生成图片或视频前先 resolveCharacterRefs，把 @角色名 展开成按顺序的素材清单。",
      promptGuidelines: [
        "清单第 N 项对应提示词里的 {{ref N}}；连线顺序要与清单一致，否则编号会对错素材。",
        "登记表存放在工作区 .cache/characterRefs.json，属于工作区私有数据。",
        "sync 只补缺不覆盖，除非显式 overwrite。",
      ],
      executionMode: "sequential",
      parameters: z.toJSONSchema(characterSchema, { io: "input", target: "draft-07" }),
      async execute(_id: string, params: unknown, signal?: AbortSignal) {
        const input = characterSchema.parse(params);
        const entries = await readRegistry(context);
        if (input.action === "list") {
          return { content: [{ type: "text" as const, text: entries.length ? `已登记 ${entries.length} 个角色` : "登记表为空，可先用 sync 从画布同步" }], details: { characters: entries } };
        }
        if (input.action === "sync") {
          if (!context.canvas) throw new Error("当前没有激活画布，无法同步角色素材");
          const summaries = await listCanvasNodes(context, signal);
          const candidates = summaries.filter(item => /character|角色|三视图|设定/i.test(`${item.type} ${item.label}`));
          if (!candidates.length) throw new Error("画布上没有识别到角色节点；可用 set 手动登记");
          const outputs = await readNodeOutputs(context, candidates.map(item => item.id), signal);
          let added = 0;
          for (const candidate of candidates) {
            const url = outputs.get(candidate.id)?.image ?? outputs.get(candidate.id)?.url;
            if (!url) continue;
            const name = candidate.label.trim() || candidate.id;
            const existing = entries.find(item => item.name === name);
            if (existing && !input.overwrite) continue;
            if (existing) {
              existing.path = url;
              existing.source = candidate.id;
              existing.updatedAt = new Date().toISOString();
            } else {
              entries.push({ name, path: url, source: candidate.id, updatedAt: new Date().toISOString() });
              added++;
            }
          }
          await writeRegistry(context, entries);
          return { content: [{ type: "text" as const, text: `已同步 ${added} 个角色，登记表共 ${entries.length} 条` }], details: { characters: entries } };
        }
        if (input.action === "set") {
          if (!input.name) throw new Error("set 需要提供角色名 name");
          if (!input.path) throw new Error("set 需要提供参考图路径 path");
          await context.resolvePath(input.path);
          const existing = entries.find(item => item.name === input.name);
          if (existing) {
            existing.path = input.path;
            existing.features = input.features ?? existing.features;
            existing.updatedAt = new Date().toISOString();
          } else {
            entries.push({ name: input.name, path: input.path, features: input.features, updatedAt: new Date().toISOString() });
          }
          await writeRegistry(context, entries);
          return { content: [{ type: "text" as const, text: `已登记角色「${input.name}」` }], details: { characters: entries } };
        }
        if (input.action === "remove") {
          if (!input.name) throw new Error("remove 需要提供角色名 name");
          const next = entries.filter(item => item.name !== input.name);
          await writeRegistry(context, next);
          return { content: [{ type: "text" as const, text: next.length === entries.length ? `登记表里没有「${input.name}」` : `已删除角色「${input.name}」` }], details: { characters: next } };
        }
        if (!input.prompt) throw new Error("resolve 需要提供待展开的提示词 prompt");
        const mentioned: CharacterEntry[] = [];
        for (const entry of entries) {
          if (input.prompt.includes(`@${entry.name}`)) mentioned.push(entry);
        }
        if (!mentioned.length) {
          return { content: [{ type: "text" as const, text: "提示词里没有 @角色名，或登记表里没有对应角色" }], details: { prompt: input.prompt, references: [] } };
        }
        const references = mentioned.map((entry, index) => ({
          ref: index + 1,
          name: entry.name,
          path: entry.path,
          features: entry.features ?? "",
        }));
        let rewritten = input.prompt;
        for (const entry of mentioned) {
          const ref = references.find(item => item.name === entry.name)!;
          rewritten = rewritten.replaceAll(`@${entry.name}`, `{{ref ${ref.ref}}}`);
        }
        // ACT: 按现有制作约定，把 {{ref N}} 的素材定义放在提示词开头，正文只留编号，不重复整段特征。
        const definitions = references
          .map(item => `{{ref ${item.ref}}} ${item.name}${item.features ? `：${item.features}` : ""}`)
          .join("\n");
        rewritten = `${definitions}\n${rewritten}`;
        const unresolved = rewritten.match(/@[\u4e00-\u9fa5A-Za-z0-9_]{1,20}/g);
        const text = `已展开 ${references.length} 个角色${unresolved?.length ? `；未登记：${[...new Set(unresolved)].join("、")}` : ""}`;
        return {
          content: [{ type: "text" as const, text }],
          details: { prompt: rewritten, references, unresolved: unresolved ? [...new Set(unresolved)] : [] },
        };
      },
    }];
  },
};

export default plugin;
