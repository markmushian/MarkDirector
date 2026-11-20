import { createToolConfig } from "@markdirector/tools-scaffold";

await createToolConfig({
  name: "episodeExport",
  displayName: "成片拼接与角色参考",
  description: "把画布上已生成的视频片段按顺序拼成一集成片，支持批量任务、失败重试与进度回执；并维护角色参考图登记表，把提示词里的 @角色名 解析为可连线的素材清单。",
  prompt: `成片拼接前先用 exportEpisode 的 dryRun 预览片段清单，确认顺序和数量无误后再正式执行。
不传 nodeIds 时按激活画布的节点创建顺序收集视频节点；需要指定顺序时显式传 nodeIds，数组顺序就是拼接顺序。
批量任务用 jobs 数组，一次提交多集成片；失败会自动重试 retries 次，单个任务失败不影响其他任务，最终回执里逐项列出成功与失败原因。
输出默认写到工作区 exports 目录，文件名由用户指定或自动生成，不覆盖已有文件。
拼接口径：所有片段规格一致时走无损流拷贝；规格不一致时自动统一分辨率、帧率与音频（无音轨补静音）后拼接。
角色参考：生成前用 resolveCharacterRefs 的 sync 从画布同步角色素材，再用 resolve 把 @角色名 展开为按顺序的素材清单，提示词里的 {{ref N}} 与清单第 N 项一一对应。`,
  author: "MarkDirector",
  github: "https://github.com/markmushian/MarkDirector",
  configRules: [],
}, import.meta.url);
