/**
 * 主机可达性探测。
 *
 * 只做一次 TCP 连接（不做 SSH 握手、不发送任何凭据），因此可以频繁调用：
 * 用于资产页「在线 / 离线」状态，以及连接前的快速预检。
 */
import { connect } from 'node:net';

export interface ProbeResult {
  reachable: boolean;
  /** 建连耗时（毫秒），不可达时为 null */
  rttMs: number | null;
  /** 失败原因：timeout / refused / dns / error */
  reason?: string;
}

/**
 * 探测 host:port 的 TCP 可达性。
 * 超时默认 1.8 s —— 跨公网的一次 SYN 往返通常远小于这个值。
 */
export function probeTcp(host: string, port: number, timeoutMs = 1800): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host, port });
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true, rttMs: Date.now() - started }));
    socket.once('timeout', () => finish({ reachable: false, rttMs: null, reason: 'timeout' }));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      const code = error.code ?? 'error';
      finish({
        reachable: false,
        rttMs: null,
        reason: code === 'ECONNREFUSED' ? 'refused' : code === 'ENOTFOUND' ? 'dns' : 'error',
      });
    });
  });
}

/** 小并发批量探测，避免一次性打出几十个连接。 */
export async function probeAll(
  targets: Array<{ id: string; host: string; port: number }>,
  concurrency = 6,
  timeoutMs = 1800,
): Promise<Record<string, ProbeResult>> {
  const results: Record<string, ProbeResult> = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const target = targets[index];
      if (!target) return;
      results[target.id] = await probeTcp(target.host, target.port, timeoutMs);
    }
  });
  await Promise.all(workers);
  return results;
}
