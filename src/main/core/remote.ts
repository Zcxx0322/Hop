import { Client } from 'ssh2';
import type { HostKeyCheck, KnownHostsStore } from './known-hosts';
import { sha256Fingerprint } from './keys';
import { createLogger } from './logger';
import { fail } from './errors';
import type { ProfileStore, ResolvedConnection, ResolvedEndpoint } from './profile-store';
import { hostKeyType } from './ssh-session';

const log = createLogger('remote');

const CONNECT_TIMEOUT_MS = 12_000;
const JUMP_TIMEOUT_MS = 10_000;

/** 关掉 Nagle：SSH 通道上的小包应立刻发出，否则要等对端 delayed-ACK。 */
function enableNoDelay(conn: Client): void {
  try {
    (conn as unknown as { setNoDelay?: (value: boolean) => void }).setNoDelay?.(true);
  } catch {
    /* 极少数实现不支持，忽略即可 */
  }
}

export interface RemoteDeps {
  profiles: ProfileStore;
  knownHosts: KnownHostsStore;
}

/**
 * 短连接（SFTP / 监控采样）复用的传输凭证。
 *
 * 只信任 known_hosts 里已 pin 的指纹；未知主机按 TOFU 首次信任并落盘，
 * 指纹变了直接拒绝——与网关上的 HTTP 会话策略保持一致。
 */
function makeHostVerifier(deps: RemoteDeps, endpoint: ResolvedEndpoint) {
  return (key: Buffer, verify: (valid: boolean) => void): void => {
    const keyType = hostKeyType(key);
    const fingerprint = sha256Fingerprint(key);

    let check: HostKeyCheck;
    try {
      check = deps.knownHosts.check(endpoint.host, endpoint.port, keyType, fingerprint);
    } catch {
      check = { known: false, match: false };
    }

    if (check.known && check.match) {
      verify(true);
      return;
    }
    if (check.known && !check.match) {
      log.warn('host key mismatch, refusing connection', {
        host: endpoint.host,
        port: endpoint.port,
        fingerprint,
      });
      verify(false);
      return;
    }

    try {
      deps.knownHosts.trust(endpoint.host, endpoint.port, keyType, fingerprint);
      log.info('trusted new host key (tofu)', { host: endpoint.host, port: endpoint.port, keyType });
      verify(true);
    } catch (err) {
      log.warn('failed to pin host key', { err: String(err) });
      verify(false);
    }
  };
}

function connectEndpoint(
  deps: RemoteDeps,
  endpoint: ResolvedEndpoint,
  timeoutMs: number,
  sock?: NodeJS.ReadWriteStream,
): Promise<Client> {
  return new Promise<Client>((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(fail('TIMEOUT', `连接 ${endpoint.host}:${endpoint.port} 超时`));
    }, timeoutMs);

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    conn.on('ready', () => {
      /* 关掉 Nagle：SFTP 的每个请求/响应都是小包，攒包会白等 40–200 ms */
      enableNoDelay(conn);
      done(() => resolve(conn));
    });
    conn.once('handshake', () => enableNoDelay(conn));
    conn.on('error', (err: Error) => {
      done(() => reject(fail('NETWORK', `连接 ${endpoint.host}:${endpoint.port} 失败：${err.message}`)));
    });
    conn.on('close', () => {
      done(() => reject(fail('NETWORK', `连接 ${endpoint.host}:${endpoint.port} 在握手阶段被关闭`)));
    });

    const config: Record<string, unknown> = {
      host: endpoint.host,
      port: endpoint.port,
      username: endpoint.username,
      readyTimeout: timeoutMs,
      tryKeyboard: false,
      keepaliveInterval: 5_000,
      keepaliveCountMax: 2,
      ...(sock ? { sock } : {}),
      hostVerifier: makeHostVerifier(deps, endpoint),
    };

    const auth = endpoint.auth;
    if (auth.type === 'password') {
      config.password = auth.password;
      config.tryKeyboard = true;
    } else if (auth.type === 'privateKey') {
      config.privateKey = auth.privateKey;
      if (auth.passphrase) config.passphrase = auth.passphrase;
    } else {
      config.agent =
        auth.agentSocket ||
        (process.platform === 'win32'
          ? '\\\\.\\pipe\\openssh-ssh-agent'
          : process.env.SSH_AUTH_SOCK);
    }

    const keyboardPassword = auth.type === 'password' ? auth.password : undefined;
    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishCb) => {
      finishCb(prompts.map(() => keyboardPassword ?? ''));
    });

    conn.connect(config as never);
  });
}

/**
 * 建立一条短连接，交给 `fn` 使用，结束后一定断开。
 * 支持跳板机：先在跳板上 forwardOut，再在隧道里起目标连接。
 */
export async function withRemote<T>(
  deps: RemoteDeps,
  profileId: string,
  fn: (client: Client, resolved: ResolvedConnection) => Promise<T>,
): Promise<T> {
  const resolved = deps.profiles.resolve(profileId);
  const { target, jump } = resolved;

  let jumpConn: Client | null = null;
  let conn: Client | null = null;

  try {
    let sock: NodeJS.ReadWriteStream | undefined;
    if (jump) {
      jumpConn = await connectEndpoint(deps, jump, JUMP_TIMEOUT_MS);
      sock = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
        jumpConn!.forwardOut('127.0.0.1', 0, target.host, target.port, (err, channel) => {
          if (err) reject(fail('NETWORK', `无法通过跳板机连接 ${target.host}:${target.port}`, String(err)));
          else resolve(channel as unknown as NodeJS.ReadWriteStream);
        });
      });
    }

    conn = await connectEndpoint(deps, target, CONNECT_TIMEOUT_MS, sock);
    return await fn(conn, resolved);
  } finally {
    conn?.end();
    jumpConn?.end();
  }
}

export interface RemoteHandle {
  client: Client;
  resolved: ResolvedConnection;
  close: () => void;
}

/** 长一点的连接（监控轮询复用），由调用方负责 close。 */
export async function openRemote(deps: RemoteDeps, profileId: string): Promise<RemoteHandle> {
  const resolved = deps.profiles.resolve(profileId);
  const { target, jump } = resolved;

  let jumpConn: Client | null = null;
  let conn: Client | null = null;
  try {
    let sock: NodeJS.ReadWriteStream | undefined;
    if (jump) {
      jumpConn = await connectEndpoint(deps, jump, JUMP_TIMEOUT_MS);
      sock = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
        jumpConn!.forwardOut('127.0.0.1', 0, target.host, target.port, (err, channel) => {
          if (err) reject(fail('NETWORK', `无法通过跳板机连接 ${target.host}:${target.port}`, String(err)));
          else resolve(channel as unknown as NodeJS.ReadWriteStream);
        });
      });
    }
    conn = await connectEndpoint(deps, target, CONNECT_TIMEOUT_MS, sock);
    return {
      client: conn,
      resolved,
      close: () => {
        try {
          conn?.end();
        } catch {
          /* ignore */
        }
        try {
          jumpConn?.end();
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    conn?.end();
    jumpConn?.end();
    throw err;
  }
}

/**
 * 复用连接池：SFTP 浏览与监控采样共用一条已认证连接。
 *
 * 每次点开目录都重新握手（TCP + 密钥交换 + 认证）在跨网主机上要几百毫秒，
 * 这里按 profile 缓存连接，空闲 45 秒后回收；SSH 本身支持多路复用，
 * 并发请求共用同一条连接即可。
 */
interface PoolEntry {
  handle: RemoteHandle;
  users: number;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const REMOTE_IDLE_MS = 45_000;

export class RemotePool {
  private readonly entries = new Map<string, PoolEntry>();
  /** 同一 profile 的并发首次请求只握手一次，其余请求等同一个 Promise */
  private readonly pending = new Map<string, Promise<RemoteHandle>>();
  private disposed = false;

  constructor(private readonly deps: RemoteDeps) {}

  async with<T>(profileId: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const { entry, reused } = await this.acquire(profileId);
    try {
      return await fn(entry.handle.client);
    } catch (err) {
      /* 连接层面的失败（握手后 socket 断了）直接丢弃，避免后续请求一直踩坏连接 */
      if (isBrokenConnection(err)) this.drop(profileId);
      throw err;
    } finally {
      this.release(profileId, reused);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [profileId, entry] of this.entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      try {
        entry.handle.close();
      } catch {
        /* ignore */
      }
      this.entries.delete(profileId);
    }
  }

  private async acquire(profileId: string): Promise<{ entry: PoolEntry; reused: boolean }> {
    if (this.disposed) throw fail('CONFIG_INVALID', '应用正在退出');
    const existing = this.entries.get(profileId);
    if (existing && !existing.closed) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      existing.users += 1;
      return { entry: existing, reused: true };
    }
    if (existing) this.drop(profileId);

    const inflight = this.pending.get(profileId);
    if (inflight) {
      await inflight;
      const shared = this.entries.get(profileId);
      if (shared && !shared.closed) {
        shared.users += 1;
        return { entry: shared, reused: true };
      }
      /* 刚刚那次握手失败了，自己重新开一条 */
    }

    const opening = openRemote(this.deps, profileId).finally(() => {
      if (this.pending.get(profileId) === opening) this.pending.delete(profileId);
    });
    this.pending.set(profileId, opening);
    const handle = await opening;
    const entry: PoolEntry = { handle, users: 1, idleTimer: null, closed: false };
    this.entries.set(profileId, entry);

    const forget = () => {
      entry.closed = true;
      if (this.entries.get(profileId) === entry) this.entries.delete(profileId);
    };
    handle.client.once('close', forget);
    handle.client.once('error', forget);

    log.info('remote connection opened', { profileId });
    return { entry, reused: false };
  }

  private release(profileId: string, reused: boolean): void {
    const entry = this.entries.get(profileId);
    if (!entry) return;
    entry.users = Math.max(0, entry.users - 1);
    if (entry.users > 0) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const timer = setTimeout(() => {
      const current = this.entries.get(profileId);
      if (!current || current.users > 0) return;
      this.drop(profileId);
    }, REMOTE_IDLE_MS);
    timer.unref?.();
    entry.idleTimer = timer;
    if (!reused) log.info('remote connection idle timer armed', { profileId });
  }

  private drop(profileId: string): void {
    const entry = this.entries.get(profileId);
    if (!entry) return;
    this.entries.delete(profileId);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try {
      entry.handle.close();
    } catch {
      /* ignore */
    }
  }
}

function isBrokenConnection(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'NETWORK' || code === 'TIMEOUT';
}

/**
 * 在远端执行一条命令并收集输出（监控采样用）。
 * 超时或退出码非 0 都会抛错，调用方决定是否降级。
 */
export function execOnce(client: Client, command: string, timeoutMs = 8_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(fail('TIMEOUT', '远端命令超时'));
    }, timeoutMs);

    client.exec(command, (err, channel) => {
      if (err) {
        clearTimeout(timer);
        settled = true;
        reject(fail('NETWORK', `无法执行远端命令：${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      channel.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 512 * 1024) channel.close();
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      channel.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stderr.trim()) log.warn('remote command stderr', { stderr: stderr.slice(0, 200) });
        resolve(stdout);
      });
    });
  });
}
