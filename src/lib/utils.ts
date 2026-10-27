/** 生成唯一 ID，优先使用浏览器原生 crypto.randomUUID。 */
export function createId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${suffix}`;
}

/** 提取可展示的错误文案。 */
export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** 平台修饰键：macOS 用 ⌘，其余用 Ctrl。 */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const modKey = isMac ? '⌘' : 'Ctrl';

/** 是否为「修饰键 + 某键」的组合键事件。 */
export function isModCombo(event: KeyboardEvent, key: string): boolean {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  return modifier && event.key.toLowerCase() === key.toLowerCase();
}

