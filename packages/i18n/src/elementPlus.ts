import type { Locale } from "./index";
import zhCn from "./elementPlus/zhCn.json";

export const elementLocales = {
  "zh-CN": zhCn,
} satisfies Record<Locale, typeof zhCn>;
