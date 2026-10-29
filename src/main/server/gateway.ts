import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ConnectionProfile,
  HopError,
  KnownHostEntry,
  ProfileInput,
  SessionSnapshot,
  SessionStatus,
} from '../../shared/contract';
import { toHopError } from '../core/errors';
import type { KnownHostsStore } from '../core/known-hosts';
import { createLogger } from '../core/logger';
import type { ProfileStore } from '../core/profile-store';
import { SessionManager } from '../core/session-manager';
import type { SftpService } from '../core/sftp-service';
import type { MonitorService } from '../core/monitor-service';

const log = createLogger('gateway');

const DEFAULT_PORT = 47100;
const PORT_ATTEMPTS = 20;
const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
/** How long the gateway waits for the first client frame before opening SSH. */
const OPEN_FALLBACK_MS = 10_000;
/** Unacked bytes queued on a terminal socket before we call the consumer dead. */
const SOCKET_BACKLOG_LIMIT = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Wire types (mirror src/api/* on the renderer side)                 */
/* ------------------------------------------------------------------ */

type FrontendAuthMethod = 'key' | 'password' | 'agent';

/** Shape returned by `GET /hosts` — keep in sync with renderer `Host`. */
interface HostDto {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: FrontendAuthMethod;
  privateKeyPath: string;
  tags: string[];
  color: string;
  note: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
  distro: { id: string; name: string; version: string } | null;
  /* Extras the UI may use once it knows about them (harmless otherwise). */
  hasPassword: boolean;
  keyFingerprint: string;
}

type ClientFrame =
  | { type: 'hello'; sessionId?: string; hostId?: string; cols?: number; rows?: number; password?: string; passphrase?: string }
  | { type: 'input'; data?: string }
  | { type: 'resize'; cols?: number; rows?: number }
  | { type: 'close' };

type ServerFrame =
  | { type: 'state'; state: 'connecting' | 'connected' | 'closed' | 'error'; detail?: string }
  | { type: 'data'; data: string }
  | { type: 'error'; message?: string };

export interface GatewayDeps {
  profiles: ProfileStore;
  knownHosts: KnownHostsStore;
  secureStorage: boolean;
  appVersion: string;
  /** 0 disables the gateway. */
  preferredPort?: number;
  /** SFTP 文件浏览/传输；缺省时不注册 /hosts/:id/files* */
  sftp?: SftpService;
  /** 主机资源采样；缺省时不注册 /hosts/:id/monitor */
  monitor?: MonitorService;
  /** 会话建立后回调（发行版探测等），失败不影响终端 */
  onSessionReady?: (profileId: string) => void;
}

export interface GatewayHandle {
  port: number;
  origin: string;
  wsOrigin: string;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Host ⇄ profile mapping                                             */
/* ------------------------------------------------------------------ */

function authMethodOf(profile: ConnectionProfile): FrontendAuthMethod {
  return profile.auth.type === 'privateKey' ? 'key' : profile.auth.type;
}

function toHost(profile: ConnectionProfile): HostDto {
  const created = Date.parse(profile.createdAt);
  const updated = Date.parse(profile.updatedAt);
  const used = profile.lastConnectedAt ? Date.parse(profile.lastConnectedAt) : Number.NaN;
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authMethod: authMethodOf(profile),
    privateKeyPath: profile.auth.privateKeyPath ?? '',
    tags: profile.tags,
    color: profile.color ?? '',
    note: profile.note ?? '',
    favorite: Boolean(profile.favorite),
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    lastConnectedAt: Number.isFinite(used) ? used : null,
    distro: profile.distro ?? null,
    hasPassword: profile.auth.hasSecret,
    keyFingerprint: profile.auth.keyFingerprint ?? '',
  };
}

/** `GET /known-hosts` — renderer-facing shape (see docs/API-CONTRACT.md §2.3). */
function toKnownHost(entry: KnownHostEntry): {
  id: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  firstSeenAt: number;
  keyType: string;
  addedAt: string;
} {
  const added = Date.parse(entry.addedAt);
  return {
    id: entry.id,
    host: entry.host,
    port: entry.port,
    algorithm: entry.keyType,
    fingerprint: entry.fingerprint,
    firstSeenAt: Number.isFinite(added) ? added : Date.now(),
    keyType: entry.keyType,
    addedAt: entry.addedAt,
  };
}

class BadRequest extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = 'CONFIG_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function str(value: unknown, field: string, { required = true, max = 255 } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw new BadRequest(`缺少字段 ${field}`);
    return '';
  }
  if (typeof value !== 'string') throw new BadRequest(`字段 ${field} 必须是字符串`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new BadRequest(`字段 ${field} 不能为空`);
  if (trimmed.length > max) throw new BadRequest(`字段 ${field} 过长`);
  return trimmed;
}

function optionalSecret(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequest(`字段 ${field} 必须是字符串`);
  return value; // '' clears the stored secret
}

function num(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new BadRequest(`字段 ${field} 不是数字`);
  if (n < min || n > max) throw new BadRequest(`字段 ${field} 需在 ${min}–${max} 之间`);
  return Math.floor(n);
}

/**
 * Turn a renderer `HostDraft` into a `ProfileInput`.
 * Unknown fields are ignored; secrets are optional and never echoed back.
 */
function toProfileInput(body: Record<string, unknown>, existing: ConnectionProfile | null): ProfileInput {
  const authMethodRaw = (body.authMethod ?? (existing ? authMethodOf(existing) : 'agent')) as FrontendAuthMethod;
  if (authMethodRaw !== 'key' && authMethodRaw !== 'password' && authMethodRaw !== 'agent') {
    throw new BadRequest('不支持的认证方式', 400, 'CONFIG_INVALID');
  }

  const port = num(body.port, 'port', 1, 65535, existing?.port ?? 22);
  const privateKeyPath = body.privateKeyPath === undefined ? '' : str(body.privateKeyPath, 'privateKeyPath', { required: false, max: 4096 });

  const password = optionalSecret(body.password, 'password');
  const passphrase = optionalSecret(body.passphrase, 'passphrase');

  const auth =
    authMethodRaw === 'key'
      ? {
          type: 'privateKey' as const,
          ...(privateKeyPath ? { privateKeyPath } : {}),
          ...(passphrase !== undefined ? { passphrase } : {}),
        }
      : authMethodRaw === 'password'
        ? {
            type: 'password' as const,
            ...(password !== undefined ? { password } : {}),
          }
        : { type: 'agent' as const };

  return {
    ...(existing ? { id: existing.id } : {}),
    name: str(body.name ?? existing?.name, 'name', { required: true }),
    host: str(body.host ?? existing?.host, 'host', { required: true }),
    port,
    username: str(body.username ?? existing?.username, 'username', { required: true }),
    auth,
    cols: existing?.cols,
    rows: existing?.rows,
    term: existing?.term,
    keepAliveMs: existing?.keepAliveMs,
    color: typeof body.color === 'string' ? body.color || undefined : existing?.color ?? undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 12)
      : existing?.tags ?? [],
    note: typeof body.note === 'string' ? body.note : existing?.note ?? '',
    favorite: typeof body.favorite === 'boolean' ? body.favorite : Boolean(existing?.favorite),
    jump: existing?.jump
      ? {
          host: existing.jump.host,
          port: existing.jump.port,
          username: existing.jump.username,
          auth: { type: existing.jump.auth.type, ...(existing.jump.auth.privateKeyPath ? { privateKeyPath: existing.jump.auth.privateKeyPath } : {}) },
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Gateway                                                            */
/* ------------------------------------------------------------------ */

export async function startGateway(deps: GatewayDeps): Promise<GatewayHandle | null> {
  const preferred = deps.preferredPort ?? DEFAULT_PORT;
  if (preferred === 0) {
    log.info('gateway disabled');
    return null;
  }

  /** ws → SSH session id (this gateway owns its own SessionManager) */
  const sessionsBySocket = new Map<WebSocket, string>();
  const socketBySession = new Map<string, WebSocket>();

  const send = (ws: WebSocket, frame: ServerFrame): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      log.warn('ws send failed', { err: String(err) });
    }
  };

  /**
   * Terminal output can outrun a slow renderer (`cat` of a 500 MB log, a busy
   * build). We do not buffer without bound: once the socket queue grows past
   * SOCKET_BACKLOG_LIMIT the consumer is gone or hopelessly behind, so the
   * session is dropped with a typed error instead of eating main-process RAM.
   */
  const pushData = (ws: WebSocket, data: string): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > SOCKET_BACKLOG_LIMIT) {
      log.warn('terminal consumer too slow, dropping session', { backlog: ws.bufferedAmount });
      send(ws, { type: 'error', message: '终端输出过快，连接已停止（请重连）' });
      try {
        ws.close(1013, 'slow-consumer');
      } catch {
        /* already gone */
      }
      return;
    }
    send(ws, { type: 'data', data });
  };

  const sessions = new SessionManager(
    {
      onData(sessionId, data) {
        const ws = socketBySession.get(sessionId);
        if (ws) pushData(ws, data);
      },
      onStatus(snapshot: SessionSnapshot) {
        const ws = socketBySession.get(snapshot.id);
        if (ws) send(ws, { type: 'state', state: mapStatus(snapshot.status), detail: snapshot.error?.message });
      },
      onClosed(sessionId, reason) {
        const ws = socketBySession.get(sessionId);
        socketBySession.delete(sessionId);
        sessions.forget(sessionId);
        if (ws) {
          sessionsBySocket.delete(ws);
          send(ws, { type: 'state', state: reason ? 'error' : 'closed', detail: reason?.message ?? '会话已结束' });
          try {
            ws.close(reason ? 1011 : 1000, reason?.code ?? 'closed');
          } catch {
            /* already gone */
          }
        }
      },
      onHostKey(challenge) {
        // The HTTP/WS surface has no approval dialog: trust on first use, but
        // never silently accept a *changed* key. Mismatches are hard failures
        // the user resolves by removing the stale pin (GET/DELETE /known-hosts).
        const accept = !challenge.mismatch;
        log.info('host key auto-answer', {
          host: challenge.host,
          fingerprint: challenge.fingerprint,
          known: challenge.known,
          accept,
        });
        sessions.answerHostKey(challenge.requestId, accept, accept);
        if (!accept) {
          const ws = socketBySession.get(challenge.sessionId);
          if (ws) {
            send(ws, {
              type: 'error',
              message: `主机 ${challenge.host} 的指纹与已知记录不一致（${challenge.fingerprint}），已阻止连接`,
            });
          }
        }
      },
    },
    {
      profiles: deps.profiles,
      knownHosts: deps.knownHosts,
      onReady(profileId: string) {
        try {
          deps.onSessionReady?.(profileId);
        } catch (err) {
          log.warn('onSessionReady hook threw', { err: String(err) });
        }
      },
    },
  );

  /* ---------------- HTTP ---------------- */

  const server = http.createServer((req, res) => {
    void routeHttp(req, res).catch((err: unknown) => {
      const status = err instanceof BadRequest ? err.status : typeof (err as { status?: number }).status === 'number' ? (err as { status: number }).status : 500;
      const code = err instanceof BadRequest ? err.code : (toHopError(err).code ?? 'INTERNAL');
      const message = err instanceof Error ? err.message : '服务器内部错误';
      if (status >= 500) log.error('gateway request failed', { url: req.url, err: message });
      sendJson(res, status, { message, code });
    });
  });

  async function routeHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    /*
     * 本机网关没有登录态：必须挡住浏览器里其他站点发来的请求。
     * - Origin 必须来自本机页面（file:// 打包页面的 Origin 是 null）
     * - Host 必须是回环地址，防止 DNS rebinding 把 evil.com 解析到 127.0.0.1
     */
    if (!isAllowedHostHeader(req.headers.host)) {
      log.warn('gateway rejected foreign host header', { host: req.headers.host });
      sendJson(res, 403, { message: '拒绝访问：Host 头不是本机地址', code: 'FORBIDDEN' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      log.warn('gateway rejected foreign origin', { origin });
      sendJson(res, 403, { message: '拒绝访问：来源不是 Hop 窗口', code: 'FORBIDDEN' });
      return;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    if (path === '/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        name: 'Hop',
        version: deps.appVersion,
        contract: 1,
        secureStorage: deps.secureStorage,
        sessions: sessions.list().length,
        hosts: deps.profiles.list().length,
      });
      return;
    }

    if (path === '/hosts' && method === 'GET') {
      sendJson(res, 200, deps.profiles.list().map(toHost));
      return;
    }

    if (path === '/hosts' && method === 'POST') {
      const body = await readJson(req);
      const created = deps.profiles.save(toProfileInput(body, null));
      log.info('host created via gateway', { id: created.id });
      sendJson(res, 201, toHost(created));
      return;
    }

    const credentials = /^\/hosts\/([^/]+)\/credentials$/.exec(path);
    if (credentials && method === 'PUT') {
      const id = decodeURIComponent(credentials[1]);
      const existing = deps.profiles.get(id);
      if (!existing) throw new BadRequest('该连接已不存在', 404, 'PROFILE_NOT_FOUND');
      const body = await readJson(req);
      const password = optionalSecret(body.password, 'password');
      const passphrase = optionalSecret(body.passphrase, 'passphrase');
      if (password === undefined && passphrase === undefined) {
        throw new BadRequest('请提供 password 或 passphrase');
      }
      deps.profiles.save({
        id,
        name: existing.name,
        host: existing.host,
        port: existing.port,
        username: existing.username,
        auth: {
          type: existing.auth.type,
          ...(password !== undefined ? { password } : {}),
          ...(passphrase !== undefined ? { passphrase } : {}),
          ...(existing.auth.privateKeyPath ? { privateKeyPath: existing.auth.privateKeyPath } : {}),
        },
        cols: existing.cols,
        rows: existing.rows,
        term: existing.term,
        keepAliveMs: existing.keepAliveMs,
        color: existing.color ?? undefined,
        tags: existing.tags,
        note: existing.note,
        favorite: existing.favorite,
      });
      res.writeHead(204).end();
      return;
    }

    const hostId = /^\/hosts\/([^/]+)$/.exec(path);
    if (hostId) {
      const id = decodeURIComponent(hostId[1]);
      if (method === 'GET') {
        const found = deps.profiles.get(id);
        if (!found) throw new BadRequest('该连接已不存在', 404, 'PROFILE_NOT_FOUND');
        sendJson(res, 200, toHost(found));
        return;
      }
      if (method === 'PUT') {
        const existing = deps.profiles.get(id);
        if (!existing) throw new BadRequest('该连接已不存在', 404, 'PROFILE_NOT_FOUND');
        const body = await readJson(req);
        const saved = deps.profiles.save({ ...toProfileInput(body, existing), id });
        log.info('host updated via gateway', { id });
        sendJson(res, 200, toHost(saved));
        return;
      }
      if (method === 'DELETE') {
        if (deps.profiles.get(id)) {
          deps.profiles.remove(id);
          log.info('host removed via gateway', { id });
        }
        res.writeHead(204).end();
        return;
      }
    }

    if (path === '/known-hosts' && method === 'GET') {
      sendJson(res, 200, deps.knownHosts.list().map(toKnownHost));
      return;
    }

    if (path === '/known-hosts' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (id) deps.knownHosts.forget(id);
      res.writeHead(204).end();
      return;
    }

    /* ---- 文件传输（SFTP） ------------------------------------------ */
    const filesRoute = /^\/hosts\/([^/]+)\/files(\/(upload|download|mkdir|rename|open))?$/.exec(path);
    if (filesRoute && deps.sftp) {
      const id = decodeURIComponent(filesRoute[1]);
      const action = filesRoute[3];
      if (!deps.profiles.get(id)) {
        throw new BadRequest('该连接已不存在', 404, 'PROFILE_NOT_FOUND');
      }

      if (!action && method === 'GET') {
        const dir = url.searchParams.get('path') ?? '~';
        sendJson(res, 200, await deps.sftp.list(id, dir));
        return;
      }

      if (!action && method === 'DELETE') {
        const target = url.searchParams.get('path');
        if (!target) throw new BadRequest('缺少 path 参数');
        sendJson(res, 200, await deps.sftp.remove(id, target));
        return;
      }

      if (action === 'upload' && method === 'POST') {
        const body = await readJson(req);
        const dir = typeof body.dir === 'string' ? body.dir : '~';
        sendJson(res, 200, { transfer: await deps.sftp.upload(id, dir) });
        return;
      }

      if (action === 'download' && method === 'POST') {
        const body = await readJson(req);
        if (typeof body.path !== 'string') throw new BadRequest('缺少 path');
        sendJson(res, 200, { transfer: await deps.sftp.download(id, body.path) });
        return;
      }

      if (action === 'mkdir' && method === 'POST') {
        const body = await readJson(req);
        if (typeof body.dir !== 'string' || typeof body.name !== 'string') {
          throw new BadRequest('缺少 dir 或 name');
        }
        sendJson(res, 200, await deps.sftp.createDirectory(id, body.dir, body.name));
        return;
      }

      if (action === 'rename' && method === 'POST') {
        const body = await readJson(req);
        if (typeof body.from !== 'string' || typeof body.name !== 'string') {
          throw new BadRequest('缺少 from 或 name');
        }
        sendJson(res, 200, await deps.sftp.rename(id, body.from, body.name));
        return;
      }

      if (action === 'open' && method === 'POST') {
        const body = await readJson(req);
        if (typeof body.path !== 'string') throw new BadRequest('缺少 path');
        sendJson(res, 200, await deps.sftp.openFile(id, body.path));
        return;
      }

      throw new BadRequest(`未知接口 ${method} ${path}`, 404, 'UNSUPPORTED');
    }

    if (path === '/transfers' && method === 'GET' && deps.sftp) {
      const hostId = url.searchParams.get('hostId') ?? undefined;
      sendJson(res, 200, deps.sftp.listTransfers(hostId));
      return;
    }

    if (path === '/transfers' && method === 'DELETE' && deps.sftp) {
      deps.sftp.clearFinished();
      res.writeHead(204).end();
      return;
    }

    /* ---- 主机监控 -------------------------------------------------- */
    const monitorRoute = /^\/hosts\/([^/]+)\/monitor$/.exec(path);
    if (monitorRoute && deps.monitor) {
      const id = decodeURIComponent(monitorRoute[1]);
      if (method !== 'GET') throw new BadRequest(`未知接口 ${method} ${path}`, 404, 'UNSUPPORTED');
      if (!deps.profiles.get(id)) {
        throw new BadRequest('该连接已不存在', 404, 'PROFILE_NOT_FOUND');
      }
      sendJson(res, 200, await deps.monitor.sample(id));
      return;
    }

    throw new BadRequest(`未知接口 ${method} ${path}`, 404, 'UNSUPPORTED');
  }

  /* ---------------- WebSocket ---------------- */

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.replace(/\/+$/, '') !== '/terminal') {
      socket.destroy();
      return;
    }
    /* WebSocket 不受 CORS 约束，必须在升级阶段自己做来源校验 */
    const wsOrigin = req.headers.origin;
    if (
      !isAllowedHostHeader(req.headers.host) ||
      (wsOrigin && !isAllowedOrigin(wsOrigin))
    ) {
      log.warn('gateway rejected websocket', { origin: wsOrigin, host: req.headers.host });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleSocket(ws, url));
  });

  function handleSocket(ws: WebSocket, url: URL): void {
    const hostId = url.searchParams.get('hostId') ?? '';
    const cols = Number(url.searchParams.get('cols') ?? 0) || 120;
    const rows = Number(url.searchParams.get('rows') ?? 0) || 32;
    const clientSessionId = url.searchParams.get('sessionId') ?? '';

    let sessionId: string | null = null;
    let closed = false;
    let alive = true;

    log.info('ws terminal opened', { hostId, cols, rows, clientSessionId });

    const fail = (message: string): void => {
      send(ws, { type: 'error', message });
      try {
        ws.close(1011, 'failed');
      } catch {
        /* ignore */
      }
    };

    // Unknown hosts are rejected before the SSH attempt so the renderer gets an
    // immediate error frame instead of waiting for the lazy-open fallback.
    if (!hostId) {
      fail('缺少 hostId 参数');
      return;
    }
    if (!deps.profiles.get(hostId)) {
      fail('该连接已不存在');
      return;
    }

    /**
     * The SSH session is opened on the first client frame so that a `hello`
     * frame can carry a one-shot password / key passphrase that must never be
     * persisted. A client that never sends anything still gets a session with
     * the query-string geometry after `OPEN_FALLBACK_MS`.
     */
    const ensureSession = (
      creds?: { password?: unknown; passphrase?: unknown },
      geometry?: { cols?: unknown; rows?: unknown },
    ): string | null => {
      if (sessionId) return sessionId;
      const requestedCols = Number(geometry?.cols);
      const requestedRows = Number(geometry?.rows);
      try {
        const snapshot = sessions.open({
          profileId: hostId,
          cols: Number.isFinite(requestedCols) && requestedCols > 0 ? requestedCols : cols,
          rows: Number.isFinite(requestedRows) && requestedRows > 0 ? requestedRows : rows,
          password: typeof creds?.password === 'string' ? creds.password : undefined,
          passphrase: typeof creds?.passphrase === 'string' ? creds.passphrase : undefined,
        });
        sessionId = snapshot.id;
        closed = false;
        sessionsBySocket.set(ws, snapshot.id);
        socketBySession.set(snapshot.id, ws);
        return snapshot.id;
      } catch (err) {
        const hop = toHopError(err);
        fail(hop.message);
        closed = true;
        return null;
      }
    };

    const openFallback = setTimeout(() => {
      if (!sessionId && !closed) ensureSession();
    }, OPEN_FALLBACK_MS);

    const heartbeat = setInterval(() => {
      if (!alive) {
        log.warn('ws heartbeat lost', { sessionId });
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS);

    ws.on('pong', () => {
      alive = true;
    });

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (closed) return;

      if (isBinary) {
        const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
        const current = ensureSession();
        if (current) sessions.write(current, buf.toString('utf8'));
        return;
      }

      const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8');
      let frame: ClientFrame | null = null;
      try {
        frame = JSON.parse(text) as ClientFrame;
      } catch {
        frame = null;
      }

      if (!frame) {
        // Plain text frame: treat as keystrokes.
        const current = ensureSession();
        if (current) sessions.write(current, text);
        return;
      }

      switch (frame.type) {
        case 'hello': {
          const current = ensureSession(frame, { cols: frame.cols, rows: frame.rows });
          if (current) {
            const c = Number(frame.cols);
            const r = Number(frame.rows);
            if (Number.isFinite(c) && Number.isFinite(r) && c > 0 && r > 0) sessions.resize(current, c, r);
          }
          break;
        }
        case 'input': {
          const current = ensureSession();
          if (current && typeof frame.data === 'string') sessions.write(current, frame.data);
          break;
        }
        case 'resize': {
          const current = ensureSession();
          if (current && Number.isFinite(frame.cols) && Number.isFinite(frame.rows)) {
            sessions.resize(current, frame.cols as number, frame.rows as number);
          }
          break;
        }
        case 'close': {
          closed = true;
          const current = sessionId;
          if (current) sessions.close(current);
          try {
            ws.close(1000, 'client closed');
          } catch {
            /* ignore */
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(openFallback);
      clearInterval(heartbeat);
      const current = sessionId;
      if (current && !closed) sessions.close(current);
      if (current) {
        // SessionManager.forget happens in onClosed; tidy maps defensively.
        socketBySession.delete(current);
      }
      sessionsBySocket.delete(ws);
      log.info('ws terminal closed', { sessionId: current });
    });

    ws.on('error', (err: Error) => {
      log.warn('ws error', { sessionId, err: err.message });
    });
  }

  /* ---------------- listen ---------------- */

  const port = await listenWithFallback(server, preferred);
  if (port == null) {
    wss.close();
    throw new Error(`无法监听 127.0.0.1:${preferred}（端口被占用）`);
  }

  const origin = `http://127.0.0.1:${port}`;
  log.info('gateway listening', { origin });

  return {
    port,
    origin,
    wsOrigin: `ws://127.0.0.1:${port}`,
    async close() {
      sessions.closeAll();
      for (const ws of sessionsBySocket.keys()) {
        try {
          ws.close(1001, 'server shutting down');
        } catch {
          /* ignore */
        }
      }
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function mapStatus(status: SessionStatus): 'connecting' | 'connected' | 'closed' | 'error' {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'authenticating':
    case 'connecting':
      return 'connecting';
    case 'error':
      return 'error';
    default:
      return 'closed';
  }
}

function isAllowedOrigin(origin: string): boolean {
  return (
    origin === 'null' ||
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin) ||
    /^file:\/\//.test(origin)
  );
}

/** Host 头必须是回环地址：挡住 DNS rebinding（evil.com → 127.0.0.1） */
function isAllowedHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BadRequest('请求体过大', 413, 'UNSUPPORTED');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequest('请求体必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadRequest) throw err;
    throw new BadRequest('请求体不是合法 JSON');
  }
}

function listenWithFallback(server: http.Server, preferred: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = (port: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < PORT_ATTEMPTS) {
          attempt += 1;
          tryListen(preferred + attempt);
          return;
        }
        if (err.code === 'EADDRINUSE') {
          resolve(null);
          return;
        }
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };

    tryListen(preferred);
  });
}

/** Exposed for tests and the architecture doc. */
export const GATEWAY_DEFAULT_PORT = DEFAULT_PORT;
export type { HostDto, HopError };
