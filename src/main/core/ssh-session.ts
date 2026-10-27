import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { Client } from 'ssh2';
import { randomUUID } from 'node:crypto';
import type {
  HopError,
  HostKeyChallenge,
  SessionSnapshot,
  SessionStatus,
} from '../../shared/contract';
import { fail, toHopError } from './errors';
import { sha256Fingerprint } from './keys';
import { createLogger } from './logger';
import type { HostKeyCheck, KnownHostsStore } from './known-hosts';
import type { ResolvedConnection, ResolvedEndpoint } from './profile-store';

const log = createLogger('ssh');

/** Coalesce PTY output: at most one IPC message per ~6 ms or 32 KiB. */
const FLUSH_MS = 6;
const FLUSH_BYTES = 32 * 1024;
/** Resize events are trailing-throttled to this interval. */
const RESIZE_MS = 50;
/** How long the UI has to answer a host-key challenge. */
const HOSTKEY_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 30_000;
const JUMP_TIMEOUT_MS = 25_000;
/** Default agent endpoint on Windows (the OpenSSH service's named pipe). */
const WINDOWS_OPENSSH_AGENT = '\\\\.\\pipe\\openssh-ssh-agent';

export interface SessionHooks {
  onData(sessionId: string, data: string): void;
  onStatus(snapshot: SessionSnapshot): void;
  onClosed(sessionId: string, reason: HopError | null): void;
  onHostKey(challenge: HostKeyChallenge): void;
}

/** Read the algorithm name out of an SSH public-key blob. */
export function hostKeyType(blob: Buffer): string {
  if (blob.length < 4) return 'unknown';
  const len = blob.readUInt32BE(0);
  if (len <= 0 || len > 64 || blob.length < 4 + len) return 'unknown';
  return blob.subarray(4, 4 + len).toString('ascii');
}

/**
 * One interactive SSH session: connection, optional jump host, PTY shell,
 * UTF-8 decoding, output batching, resize throttling and teardown.
 *
 * Everything is single-owner: the SessionManager creates it, talks to it
 * and throws it away. No global state, so tests can drive it directly.
 */
export class SshSession {
  readonly id: string;
  readonly profileId: string;
  readonly label: string;
  readonly createdAt = Date.now();

  private status: SessionStatus = 'connecting';
  private serverBanner: string | null = null;
  private error: HopError | undefined;

  private conn: Client | null = null;
  private jumpConn: Client | null = null;
  private stream: ClientChannel | null = null;

  private readonly decoder = new StringDecoder('utf8');
  private queue: string[] = [];
  private queuedBytes = 0;
  private flushTimer: NodeJS.Timeout | null = null;

  private resizeTimer: NodeJS.Timeout | null = null;
  private pendingResize: { cols: number; rows: number } | null = null;
  private lastSentSize = { cols: 0, rows: 0 };

  private pendingHostKeys = new Map<string, (accept: boolean, persist: boolean) => void>();
  private closed = false;
  /** Set when the user rejects / ignores a host-key prompt. */
  private hostKeyFailure: HopError | null = null;

  constructor(
    private readonly conf: ResolvedConnection,
    cols: number,
    rows: number,
    private readonly hooks: SessionHooks,
    private readonly knownHosts: KnownHostsStore,
  ) {
    this.id = `ses_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    this.profileId = conf.profile.id;
    this.label = conf.profile.name;
    this.cols = cols;
    this.rows = rows;
  }

  cols: number;
  rows: number;

  /* ---------------------------------------------------------------- */

  snapshot(): SessionSnapshot {
    return {
      id: this.id,
      profileId: this.profileId,
      label: this.label,
      status: this.status,
      serverBanner: this.serverBanner,
      createdAt: this.createdAt,
      cols: this.cols,
      rows: this.rows,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private setStatus(status: SessionStatus, error?: HopError): void {
    if (this.status === status && !error) return;
    this.status = status;
    if (error) this.error = error;
    this.hooks.onStatus(this.snapshot());
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async connect(): Promise<void> {
    const { target, jump } = this.conf;
    this.setStatus('connecting');

    try {
      let sock: NodeJS.ReadWriteStream | undefined;

      if (jump) {
        log.info('opening jump host', { host: jump.host, port: jump.port });
        this.jumpConn = await this.openClient(jump, JUMP_TIMEOUT_MS, 'jump');
        sock = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
          this.jumpConn!.forwardOut('127.0.0.1', 0, target.host, target.port, (err, channel) => {
            if (err) {
              reject(fail('NETWORK', `无法通过跳板机连接 ${target.host}:${target.port}`, String(err)));
            } else {
              resolve(channel as unknown as NodeJS.ReadWriteStream);
            }
          });
        });
      }

      this.conn = await this.openClient(target, CONNECT_TIMEOUT_MS, 'target', sock);
      await this.openShell();
    } catch (err) {
      this.terminate(toHopError(err));
    }
  }

  private openClient(
    endpoint: ResolvedEndpoint,
    timeoutMs: number,
    role: 'target' | 'jump',
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

      conn.on('handshake', () => {
        if (role === 'target') this.setStatus('authenticating');
        /*
         * 交互式 SSH 的按键是逐字节的小包：Nagle 会把它攒到上一个包被 ACK，
         * 叠加对端的延迟 ACK 后，每次按键会凭空多出 30~60 ms。关掉它。
         */
        noDelay(conn);
      });

      conn.on('ready', () => {
        noDelay(conn);
        const banner = (conn as unknown as { _remoteVer?: string })._remoteVer;
        if (banner) this.serverBanner = `SSH-2.0-${banner}`;
        done(() => resolve(conn));
      });

      conn.on('error', (err: Error & { level?: string }) => {
        if (!settled) {
          done(() => reject(this.hostKeyFailure ?? toHopError(err)));
          return;
        }
        // Runtime failure after connect: surface it and tear down.
        log.warn('ssh error after connect', { level: err.level, message: err.message });
        this.terminate(toHopError(err));
      });

      conn.on('close', () => {
        if (!settled) done(() => reject(fail('NETWORK', '连接在握手阶段被关闭')));
        // A socket that dies after a successful connect must end the session
        // too; `terminate` is idempotent so a deliberate close is harmless.
        else this.terminate(null);
      });

      const config = {
        host: endpoint.host,
        port: endpoint.port,
        username: endpoint.username,
        readyTimeout: timeoutMs,
        keepaliveInterval: this.conf.keepAliveMs || undefined,
        keepaliveCountMax: 3,
        tryKeyboard: false,
        ...(sock ? { sock } : {}),
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          void this.verifyHostKey(endpoint, key, role)
            .then((accept) => {
              try {
                verify(accept);
              } catch {
                /* channel already gone */
              }
            })
            .catch(() => {
              try {
                verify(false);
              } catch {
                /* ignore */
              }
            });
        },
      } as Record<string, unknown>;

      const auth = endpoint.auth;
      if (auth.type === 'password') {
        config.password = auth.password;
        config.tryKeyboard = true;
      } else if (auth.type === 'privateKey') {
        config.privateKey = auth.privateKey;
        if (auth.passphrase) config.passphrase = auth.passphrase;
      } else {
        // Windows 10+ ships the OpenSSH agent as a named pipe; `pageant` is
        // also accepted (the user passes it explicitly) but its helper binary
        // is not shipped with the packaged app.
        config.agent =
          auth.agentSocket ||
          (process.platform === 'win32' ? WINDOWS_OPENSSH_AGENT : process.env.SSH_AUTH_SOCK);
      }

      // keyboard-interactive fallback (hardened servers often ask for it)
      const keyboardPassword = auth.type === 'password' ? auth.password : undefined;
      conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishCb) => {
        if (!keyboardPassword) {
          finishCb([]);
          return;
        }
        finishCb(prompts.map(() => keyboardPassword));
      });

      conn.connect(config as never);
    });
  }

  private async verifyHostKey(endpoint: ResolvedEndpoint, key: Buffer, role: 'target' | 'jump'): Promise<boolean> {
    const keyType = hostKeyType(key);
    const fingerprint = sha256Fingerprint(key);

    let check: HostKeyCheck;
    try {
      check = this.knownHosts.check(endpoint.host, endpoint.port, keyType, fingerprint);
    } catch {
      check = { known: false, match: false };
    }

    if (check.known && check.match) return true;

    const requestId = `hk_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const challenge: HostKeyChallenge = {
      requestId,
      sessionId: this.id,
      host: endpoint.host,
      port: endpoint.port,
      keyType,
      fingerprint,
      known: check.known,
      ...(check.known && check.previousFingerprint
        ? { mismatch: { previousFingerprint: check.previousFingerprint } }
        : {}),
    };

    log.info('host key challenge', {
      role,
      host: endpoint.host,
      port: endpoint.port,
      keyType,
      fingerprint,
      known: check.known,
      mismatch: Boolean(challenge.mismatch),
    });

    const answer = await new Promise<{ accept: boolean; persist: boolean } | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingHostKeys.delete(requestId);
        resolve(null);
      }, HOSTKEY_TIMEOUT_MS);

      this.pendingHostKeys.set(requestId, (accept, persist) => {
        clearTimeout(timer);
        this.pendingHostKeys.delete(requestId);
        resolve({ accept, persist });
      });

      try {
        this.hooks.onHostKey(challenge);
      } catch (err) {
        clearTimeout(timer);
        this.pendingHostKeys.delete(requestId);
        log.error('failed to deliver host key challenge', { err: String(err) });
        resolve(null);
      }
    });

    if (!answer) {
      this.hostKeyFailure = fail('HOST_KEY_REJECTED', '未确认主机指纹，连接已取消');
      return false;
    }
    if (!answer.accept) {
      this.hostKeyFailure = fail('HOST_KEY_REJECTED', '主机指纹被拒绝，连接已取消');
      return false;
    }
    if (answer.persist) {
      this.knownHosts.trust(endpoint.host, endpoint.port, keyType, fingerprint);
    }
    return true;
  }

  answerHostKey(requestId: string, accept: boolean, persist: boolean): boolean {
    const waiter = this.pendingHostKeys.get(requestId);
    if (!waiter) return false;
    waiter(accept, persist);
    return true;
  }

  private openShell(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const conn = this.conn;
      if (!conn) {
        reject(fail('INTERNAL', '连接尚未建立'));
        return;
      }
      const pty = {
        term: this.conf.term || 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        width: 0,
        height: 0,
      };

      conn.shell(pty, (err, channel) => {
        if (err) {
          reject(fail('SHELL_FAILED', '已登录，但无法申请终端（shell）', String(err)));
          return;
        }

        this.stream = channel;
        this.lastSentSize = { cols: this.cols, rows: this.rows };

        channel.on('data', (chunk: Buffer) => this.handleOutput(chunk));
        channel.stderr?.on('data', (chunk: Buffer) => this.handleOutput(chunk));
        channel.on('close', () => this.terminate(null));
        channel.on('error', (err: Error) => this.terminate(toHopError(err)));

        this.setStatus('connected');
        resolve();
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Terminal data flow                                               */
  /* ---------------------------------------------------------------- */

  private handleOutput(chunk: Buffer): void {
    if (this.closed) return;
    const text = this.decoder.write(chunk);
    if (!text) return;

    this.queue.push(text);
    this.queuedBytes += text.length;

    if (this.queuedBytes >= FLUSH_BYTES) {
      this.flush();
      return;
    }
    if (this.flushTimer) {
      // 已经排了一次 flush：攒够一大块就别等定时器了。
      if (this.queuedBytes >= 4096) this.flush();
      return;
    }
    /*
     * 交互式回显（按键、补全提示）每个 chunk 只有几个字节：1 ms 内送出，
     * 把「按键 → 回显」压到一帧以内；大段输出（ls / cat）仍按 6 ms 合并，
     * 避免高频小帧拖慢渲染。
     */
    const delay = this.queuedBytes < 4096 ? 1 : FLUSH_MS;
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.queue.length) return;
    const payload = this.queue.join('');
    this.queue = [];
    this.queuedBytes = 0;
    if (!payload) return;
    try {
      this.hooks.onData(this.id, payload);
    } catch (err) {
      log.error('failed to deliver terminal data', { err: String(err) });
    }
  }

  write(data: string): void {
    if (this.closed || this.status !== 'connected' || !this.stream) return;
    if (!data) return;
    try {
      this.stream.write(data);
    } catch (err) {
      log.warn('write to pty failed', { err: String(err) });
    }
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const safeCols = Math.max(2, Math.min(1000, Math.floor(cols)));
    const safeRows = Math.max(1, Math.min(500, Math.floor(rows)));

    this.pendingResize = { cols: safeCols, rows: safeRows };
    this.cols = safeCols;
    this.rows = safeRows;

    if (this.resizeTimer) return;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      const target = this.pendingResize;
      this.pendingResize = null;
      if (!target || this.closed || !this.stream) return;
      if (target.cols === this.lastSentSize.cols && target.rows === this.lastSentSize.rows) return;
      this.lastSentSize = target;
      try {
        this.stream.setWindow(target.rows, target.cols, 0, 0);
      } catch (err) {
        log.warn('resize failed', { err: String(err) });
      }
    }, RESIZE_MS);
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                         */
  /* ---------------------------------------------------------------- */

  close(): void {
    this.terminate(null);
  }

  private terminate(reason: HopError | null): void {
    if (this.closed) return;
    this.closed = true;

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Deliver buffered output before the closed event.
    this.flush();

    for (const [, waiter] of this.pendingHostKeys) waiter(false, false);
    this.pendingHostKeys.clear();

    const tail = this.decoder.end();
    if (tail) this.hooks.onData(this.id, tail);

    try {
      this.stream?.end();
    } catch {
      /* ignore */
    }
    try {
      this.conn?.end();
    } catch {
      /* ignore */
    }
    try {
      this.jumpConn?.end();
    } catch {
      /* ignore */
    }
    this.stream = null;
    this.conn = null;
    this.jumpConn = null;

    if (reason) {
      this.error = reason;
      this.setStatus('error', reason);
      log.warn('session ended with error', { id: this.id, code: reason.code, message: reason.message });
    } else {
      this.setStatus('disconnected');
      log.info('session closed', { id: this.id });
    }

    try {
      this.hooks.onClosed(this.id, reason);
    } catch (err) {
      log.error('failed to deliver closed event', { err: String(err) });
    }
  }
}

/** 关掉 Nagle：SSH 交互是逐按键的小包，攒包会让手感变钝。 */
function noDelay(conn: Client): void {
  try {
    (conn as unknown as { setNoDelay?: (value: boolean) => void }).setNoDelay?.(true);
  } catch {
    /* 个别实现不支持，忽略即可 */
  }
}
