import type { AgentToolCall } from "@markdirector/server/agent/types";

const labels: Readonly<Record<string, string>> = {
  getappstate: "查看工作台状态",
  listprojects: "查看项目列表",
  openproject: "打开项目",
  switchproject: "切换项目",
  addcanvas: "新建画布",
  getcanvas: "查看画布",
  findcanvasnodes: "查找画布节点",
  getcanvasnodes: "查看节点详情",
  getcanvasedges: "查看节点连线",
  toolsearch: "查找可用工具",
  js: "尝试操作应用界面",
  listcanvases: "查看画布列表",
  opencanvas: "打开画布",
  switchcanvas: "切换画布",
  renamecanvas: "重命名画布",
  addnode: "添加节点",
  addnodes: "添加节点",
  updatenode: "更新节点",
  movenode: "移动节点",
  movenodes: "移动节点",
  renamenodes: "重命名节点",
  arrangecanvas: "整理画布布局",
  fitcanvas: "调整画布视图",
  selectnodes: "选中节点",
  deletenode: "删除节点",
  removenode: "删除节点",
  addedge: "连接节点",
  connectnodes: "连接节点",
  deleteedge: "移除节点连线",
  getnodetools: "查看节点可用操作",
  getnode: "查看节点内容",
  nodetools: "执行节点操作",
  setcanvasnodetext: "保存文本节点",
  open: "打开文件",
  read: "读取文件",
  readfile: "读取文件",
  write: "保存文件",
  writefile: "保存文件",
  edit: "更新文件",
  multiedit: "更新多个文件",
  filechange: "更新文件",
  list: "查看目录",
  listfiles: "查看文件列表",
  ls: "查看目录",
  find: "查找文件",
  glob: "查找文件",
  grep: "搜索工作区",
  search: "搜索工作区",
  opendocument: "打开文档",
  getdocument: "读取文档",
  writedocument: "保存文档",
  bash: "执行本地任务",
  shell: "执行本地任务",
  commandexecution: "执行本地任务",
  switchpanel: "切换工作区面板",
  websearch: "搜索参考资料",
  webfetch: "读取参考网页",
  browser: "操作网页",
  generateimage: "生成图片",
  generatevideo: "生成视频",
  generateaudio: "生成音频",
  ffmpeg: "处理视频或音频",
  installmarketplugin: "安装插件",
  askuser: "请求确认",
  subagent: "交给协作助手",
  agentteam: "交给协作团队",
  assetoperator: "处理项目素材",
};

const fileActions = new Set(["open", "read", "readfile", "write", "writefile", "edit", "opendocument", "getdocument", "writedocument"]);
const nodeActions = new Set(["addnode", "updatenode", "movenode", "getnode", "nodetools"]);

export function describeToolStep(tool: AgentToolCall): string {
  let name = tool.name.split(/__|[.:/]/).at(-1)?.replace(/[_-]/g, "").toLowerCase() ?? "";
  let args = tool.args ?? {};
  if (name === "deferexecutetool" && typeof args.toolName === "string") {
    name = args.toolName.split(/__|[.:/]/).at(-1)?.replace(/[_-]/g, "").toLowerCase() ?? "";
    let params: unknown = args.params;
    if (typeof params === "string") {
      try { params = JSON.parse(params); } catch { params = undefined; }
    }
    args = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  }
  const request = args.args && typeof args.args === "object" && !Array.isArray(args.args) ? args.args as Record<string, unknown> : args;
  const target = args.target as { canvasId?: unknown } | undefined;
  const label = Object.hasOwn(labels, name) ? labels[name]! : "运行插件操作";
  const quoted = (value: unknown, max = 64) => typeof value === "string" && value.trim() && value.length <= max && !/[\r\n]/.test(value) ? `「${value}」` : "";
  if (name === "getcanvas" || name === "opencanvas") return label + quoted(request.canvasId ?? target?.canvasId);
  if (name === "addnode") {
    const types: Record<string, string> = { textNode: "文本", imageNode: "图片", videoNode: "视频", audioNode: "音频", imageGenerationNode: "图片生成", videoGenerationNode: "视频生成", audioGenerationNode: "音频生成" };
    const type = typeof request.type === "string" ? request.type.replace(/^remote-/, "") : "";
    const typeLabel = Object.hasOwn(types, type) ? types[type] : undefined;
    return (typeLabel ? `添加${typeLabel}节点` : label) + quoted(request.label ?? request.name);
  }
  if (["addcanvas", "renamecanvas"].includes(name)) return label + quoted(request.name);
  if (name === "switchcanvas") return label + quoted(request.canvasId);
  if (name === "nodetools" && typeof request.name === "string") {
    const actions: Record<string, string> = { "node:setText": "保存文本节点", "node:generate": "生成节点素材", "node:getGenerationStatus": "查看生成进度", "node:cancelGeneration": "停止节点生成" };
    if (Object.hasOwn(actions, request.name)) return actions[request.name]!;
  }
  if (name === "findcanvasnodes") return label + quoted(request.query ?? request.label);
  args = request;
  if (fileActions.has(name)) {
    const path = args.file_path ?? args.filePath ?? args.path;
    const file = typeof path === "string" ? path.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
    if (file && file.length <= 80 && !/[\r\n]/.test(file)) return `${label}「${file}」`;
  }
  if (nodeActions.has(name)) {
    const node = args.nodeLabel ?? args.label;
    if (typeof node === "string" && node.length <= 40 && !/[\r\n]/.test(node)) return `${label}「${node}」`;
  }
  return label;
}
