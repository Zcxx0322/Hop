/**
 * 系统剪贴板读写。
 *
 * 打包后的界面是 `file://` 页面，`navigator.clipboard` 会被权限策略拒绝，
 * 因此优先走 preload 暴露的主进程通道；纯浏览器里再退回 Web API。
 */

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  const bridge = window.hop?.clipboard;
  if (bridge) {
    try {
      await bridge.writeText(text);
      return true;
    } catch {
      /* 老版本主进程没有该通道时继续尝试 Web API */
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 读取剪贴板纯文本；失败返回空串。 */
export async function readClipboardText(): Promise<string> {
  const bridge = window.hop?.clipboard;
  if (bridge?.readText) {
    try {
      const text = await bridge.readText();
      if (typeof text === 'string') return text;
    } catch {
      /* 通道不可用时退回 Web API */
    }
  }

  try {
    return (await navigator.clipboard.readText()) ?? '';
  } catch {
    return '';
  }
}
