import { MarkDirector } from "./markdirector";
import type { Channel } from "./types";

const channels = new Map<string, Channel>([["markdirector", new MarkDirector()]]);

export function getChannel(): Channel {
  const source = channels.get(process.env.MARKDIRECTOR_CHANNEL?.trim() || "markdirector");
  if (!source) throw Object.assign(new Error("渠道未配置，请检查 MARKDIRECTOR_CHANNEL"), { status: 503 });
  return source;
}
