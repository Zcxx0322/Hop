/**
 * 运行时配置与后端发现。
 *
 * 优先级：
 *   1. `.env.local` 中的 VITE_HOP_API_BASE / VITE_HOP_WS_BASE（显式指定）
 *   2. 自动探测本机 Hop 网关（127.0.0.1:47100 起，最多 20 个端口）
 *   3. 都没有 → 进入「演示模式」：内置示例主机 + 模拟 shell，界面完整可用
 *
 * 探测是异步的，由 store 在首次加载主机前 await，因此仓库/传输层必须在
 * 调用时才读取 runtimeConfig，而不能在模块加载时固化成布尔值。
 */
const trimBase = (value: string | undefined): string =>
  (value ?? '').trim().replace(/\/+$/, '');

export const runtimeConfig: { apiBase: string; wsBase: string } = {
  apiBase: trimBase(import.meta.env.VITE_HOP_API_BASE),
  wsBase: trimBase(import.meta.env.VITE_HOP_WS_BASE),
};

const GATEWAY_DEFAULT_PORT = 47100;
const GATEWAY_PORT_ATTEMPTS = 20;
const PROBE_TIMEOUT_MS = 900;

const toWs = (httpBase: string): string => httpBase.replace(/^http/i, 'ws');
const toHttp = (wsBase: string): string => wsBase.replace(/^ws/i, 'http');

if (runtimeConfig.apiBase && !runtimeConfig.wsBase) {
  runtimeConfig.wsBase = toWs(runtimeConfig.apiBase);
}
if (!runtimeConfig.apiBase && runtimeConfig.wsBase) {
  runtimeConfig.apiBase = toHttp(runtimeConfig.wsBase);
}

let probe: Promise<void> | null = null;

/** 探测本机网关；显式配置了地址或已探测过时立即返回。 */
export function ensureTransportConfig(): Promise<void> {
  if (probe) return probe;

  probe = (async () => {
    if (runtimeConfig.apiBase) return;

    const deadline = Date.now() + 2500;
    for (let offset = 0; offset < GATEWAY_PORT_ATTEMPTS; offset += 1) {
      if (Date.now() > deadline) return;
      const port = GATEWAY_DEFAULT_PORT + offset;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          cache: 'no-store',
          signal:
            typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
              ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
              : undefined,
        });
        if (!response.ok) continue;
        const info = (await response.json()) as { ok?: boolean; name?: string };
        if (!info || info.name !== 'Hop') continue;
        runtimeConfig.apiBase = `http://127.0.0.1:${port}`;
        runtimeConfig.wsBase = `ws://127.0.0.1:${port}`;
        return;
      } catch {
        /* 该端口没有网关，继续尝试下一个 */
      }
    }
    /* 所有端口都不可达：保持空配置，走演示模式 */
  })();

  return probe;
}

/** 主机数据是否来自真实 REST 后端 */
export const isLiveHosts = (): boolean => runtimeConfig.apiBase.length > 0;
/** 终端会话是否来自真实 WebSocket 后端 */
export const isLiveTerminal = (): boolean => runtimeConfig.wsBase.length > 0;
/** 任一环节处于演示模式 */
export const isMock = (): boolean => !isLiveHosts() || !isLiveTerminal();
