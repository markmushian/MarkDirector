import type { AgentMention } from "@markdirector/server/agent/types";
import { translate } from "@markdirector/i18n/vue";

export function mentionName(mention: AgentMention) {
  if (mention.displayName) return mention.displayName;
  // 命名素材（角色等）的 label 是人名而不是文件名，直接显示；文件素材保留来源前缀避免混淆。
  if (mention.source.kind === "asset") {
    const label = mention.label.trim();
    if (label && !/[\\/]/.test(label) && !/\.[a-z0-9]{2,5}$/i.test(label)) return label;
  }
  return `${mention.source.kind === "asset" ? translate("全局素材") : mention.source.canvasName} / ${mention.label}`;
}

export function mentionThumbnailProps(mention: AgentMention) {
  const value = mention.value as { url?: unknown; mimeType?: unknown } | null;
  return {
    thumbnail: ["IMAGE", "MASK", "VIDEO"].includes(mention.dataType) && typeof value?.url === "string" && typeof value.mimeType === "string"
      ? { url: value.url, mimeType: value.mimeType } : undefined,
    globalAsset: mention.source.kind === "asset" && value?.url === mention.source.path,
  };
}

export function mentionParts(content: string, mentions: AgentMention[] = []) {
  const byId = new Map(mentions.map(mention => [mention.id, mention]));
  return content.split(/(\{\{mention:[^{}]+\}\})/g).filter(Boolean).map(text => {
    const id = /^\{\{mention:([^{}]+)\}\}$/.exec(text)?.[1];
    return { text, mention: id ? byId.get(id) : undefined };
  });
}

export function mentionPlainText(content: string, mentions?: AgentMention[]) {
  return mentionParts(content, mentions).map(part => part.mention ? `@${mentionName(part.mention)}` : part.text).join("");
}
