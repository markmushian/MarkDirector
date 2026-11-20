// MarkDirector 本地化：禁用所有匿名遥测，所有接口保持空实现以兼容调用点。
type UsageEvent = "onboarding.complete" | "onboarding.skip" | "workspace.canvas" | "workspace.document";
type AgentOutcome = "success" | "failed" | "cancelled";
type CanvasSnapshot = { nodes: readonly { type?: string }[]; edgeCount: number };

const anonymousData = {
  track(_event: UsageEvent) {},
  startAgent() { return (_outcome: AgentOutcome) => {}; },
  observeCanvas(_read: () => CanvasSnapshot | undefined) { return () => {}; },
};
export default anonymousData;

export function registerAnonymousData() { return () => {}; }
