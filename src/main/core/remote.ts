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
      done(() => resolve(conn));
    });
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
