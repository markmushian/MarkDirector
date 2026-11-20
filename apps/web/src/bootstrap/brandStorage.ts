/**
 * 品牌更名：把旧 `markdirector.*` 本地缓存迁到 `markdirector.*`。
 *
 * 只在目标键不存在时复制，旧键保留，避免用户已有的项目列表、开发者确认状态丢失。
 * 需要在任何 Pinia store 初始化之前调用（main.ts 顶部）。
 */
const PREFIX_MAP: ReadonlyArray<readonly [string, string]> = [
  ["markdirector.", "markdirector."],
  ["markdirectorSmsRetry", "markdirectorSmsRetry"],
];

export function migrateLegacyBrandStorage() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      const pair = PREFIX_MAP.find(([from]) => key.startsWith(from));
      if (!pair) continue;
      const [from, to] = pair;
      const nextKey = to + key.slice(from.length);
      if (localStorage.getItem(nextKey) !== null) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      localStorage.setItem(nextKey, value);
      // 迁移成功后删除旧键，避免开发者选项的缓存列表里继续出现上游品牌名。
      if (localStorage.getItem(nextKey) === value) localStorage.removeItem(key);
    }
  } catch {
    // 隐私模式或存储被禁用时忽略迁移，不影响正常使用。
  }
}
