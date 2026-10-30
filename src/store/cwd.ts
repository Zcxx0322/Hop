/**
 * 终端当前目录的轻量共享状态。
 *
 * 终端会在两种时机上报路径：
 *  1. shell 输出 OSC 7（`\x1b]7;file://host/path\x07`，zsh/fish 和配置过的 bash 都会发）；
 *  2. 用户敲回车时，前端从输入行里认出 `cd` 一类的命令，按当前目录推算目标路径。
 *
 * 左侧文件栏打开「跟随终端目录」时订阅这里，`cd` 完自动跳过去。
 */

type Listener = (path: string) => void;

const paths = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

/**
 * 归一化远端路径：处理 `~`、相对路径、`.`、`..`、重复斜杠与结尾斜杠。
 *
 * 必须做这一步的原因：在 `/` 下敲 `cd ..` 会推出 `/..`，原样交给 SFTP 会报
 * 「No such file」，并且这个坏路径会被记成当前目录，之后每一次相对 `cd`
 * 都基于它拼接、连环失败。归一化后 `/..` 稳定退回 `/`。
 */
export function normalizeRemotePath(input: string, base = '~'): string {
  const raw = (input ?? '').trim();
  if (!raw) return base;

  const fromHome = raw === '~' || raw.startsWith('~/');
  const absolute = raw.startsWith('/');
  const seed = fromHome || absolute ? '' : base;
  const combined = seed ? `${seed}/${raw}` : raw;

  const homeLike = combined === '~' || combined.startsWith('~/');
  const body = homeLike ? combined.slice(1) : combined;
  const stack: string[] = [];
  for (const part of body.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  const joined = stack.join('/');
  if (homeLike) return joined ? `~/${joined}` : '~';
  return joined ? `/${joined}` : '/';
}

export const terminalCwd = {
  get(hostId: string): string | undefined {
    return paths.get(hostId);
  },

  set(hostId: string, path: string): void {
    if (!path) return;
    const clean = normalizeRemotePath(path);
    if (paths.get(hostId) === clean) return;
    paths.set(hostId, clean);
    listeners.get(hostId)?.forEach((listener) => listener(clean));
  },

  subscribe(hostId: string, listener: Listener): () => void {
    const bucket = listeners.get(hostId) ?? new Set<Listener>();
    bucket.add(listener);
    listeners.set(hostId, bucket);
    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) listeners.delete(hostId);
    };
  },

  clear(hostId: string): void {
    paths.delete(hostId);
  },
};

const OSC7 = /\u001b\]7;file:\/\/[^/]*(\/[^\u0007\u001b]*)(?:\u0007|\u001b\\)/;

/** 从一段终端输出里找 OSC 7 上报的绝对路径。 */
export function extractOsc7(chunk: string): string | null {
  const match = OSC7.exec(chunk);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * 从一行已输入的命令里推断目录变化。
 * 只覆盖最常见的 `cd` 形式——认不出来时返回 null，交给 OSC 7 或用户手输。
 */
export function inferCd(current: string, line: string): string | null {
  const command = line.trim().replace(/^.*?(?:\$|#|>)\s+/, '');
  const match = /^(?:cd|pushd|j)\s*(.*)$/.exec(command);
  if (!match) return null;

  let target = match[1].trim();
  if (!target || target === '~') return '~';
  if (target === '-') return null;

  // 去掉引号与常见尾随参数
  target = target.replace(/^["']|["']$/g, '');
  if (/\s/.test(target) || target.startsWith('$') || target.includes('`')) return null;

  if (target.startsWith('/')) return normalizeRemotePath(target, current);
  if (target.startsWith('~/')) return normalizeRemotePath(target, current);
  return normalizeRemotePath(target, current);
}
