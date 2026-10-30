import { randomUUID } from 'node:crypto';
import type {
  AuthType,
  ConnectionProfile,
  ProfileInput,
  PublicAuth,
} from '../../shared/contract';
import { fail } from './errors';
import { JsonStore } from './json-store';
import { parsePrivateKey, readPrivateKeyFile, tryFingerprint } from './keys';
import { createLogger } from './logger';
import type { SecretStore } from './secret-store';

const log = createLogger('profiles');

/* ------------------------------------------------------------------ */
/* Stored shape (never leaves the main process)                       */
/* ------------------------------------------------------------------ */

interface StoredAuthBlock {
  type: AuthType;
  privateKeyPath?: string;
  agentSocket?: string;
  keyFingerprint?: string;
  /** true when a password is in the vault (and not yet cleared). */
  hasPassword: boolean;
  /** true when a passphrase is in the vault. */
  hasPassphrase: boolean;
  /** true when the key itself was pasted and is in the vault. */
  hasInlineKey: boolean;
}

interface StoredJump {
  host: string;
  port: number;
  username: string;
  auth: StoredAuthBlock;
}

interface StoredProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: StoredAuthBlock;
  jump: StoredJump | null;
  cols: number;
  rows: number;
  term: string;
  keepAliveMs: number;
  color: string | null;
  tags: string[];
  group?: string | null;
  note: string;
  favorite: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  distro?: { id: string; name: string; version: string } | null;
}

/* ------------------------------------------------------------------ */
/* Resolved connection (input for the SSH layer)                      */
/* ------------------------------------------------------------------ */

export interface ResolvedAuth {
  type: AuthType;
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
  agentSocket?: string;
}

export interface ResolvedEndpoint {
  host: string;
  port: number;
  username: string;
  auth: ResolvedAuth;
}

export interface ResolvedConnection {
  profile: ConnectionProfile;
  target: ResolvedEndpoint;
  jump: ResolvedEndpoint | null;
  cols: number;
  rows: number;
  term: string;
  keepAliveMs: number;
}

const DEFAULT_PORT = 22;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const DEFAULT_TERM = 'xterm-256color';
const DEFAULT_KEEPALIVE = 20_000;

const secretId = (profileId: string, slot: 'password' | 'passphrase' | 'key' | 'jumpPassword' | 'jumpPassphrase') => {
  const suffix: Record<typeof slot, string> = {
    password: 'password',
    passphrase: 'passphrase',
    key: 'key',
    jumpPassword: 'jump/password',
    jumpPassphrase: 'jump/passphrase',
  };
  return `profiles/${profileId}/${suffix[slot]}`;
};

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export class ProfileStore {
  private readonly store: JsonStore<StoredProfile[]>;

  constructor(
    file: string,
    private readonly secrets: SecretStore,
  ) {
    this.store = new JsonStore<StoredProfile[]>(file, () => [], 1);
  }

  list(): ConnectionProfile[] {
    return [...this.store.read()]
      .sort((a, b) => a.order - b.order)
      .map((p) => this.toPublic(p));
  }

  get(id: string): ConnectionProfile | null {
    const found = this.store.read().find((p) => p.id === id);
    return found ? this.toPublic(found) : null;
  }

  save(input: ProfileInput): ConnectionProfile {
    const normalised = validateInput(input);
    const now = new Date().toISOString();
    const existing = normalised.id ? this.store.read().find((p) => p.id === normalised.id) : undefined;

    if (normalised.id && !existing) {
      throw fail('PROFILE_NOT_FOUND', '该连接已不存在，请刷新列表');
    }

    const id = existing?.id ?? normalised.id ?? `prf_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    // ---- credentials -------------------------------------------------
    const secrets = this.secrets;
    const auth = this.mergeAuth(id, existing?.auth, normalised.auth, false);
    if (normalised.auth.password !== undefined) {
      if (normalised.auth.password === '') {
        secrets.delete(secretId(id, 'password'));
        auth.hasPassword = false;
      } else {
        secrets.set(secretId(id, 'password'), normalised.auth.password);
        auth.hasPassword = true;
      }
    }
    if (normalised.auth.type === 'privateKey' && normalised.auth.privateKeyPath === undefined && normalised.auth.privateKey === undefined) {
      // keep whatever was there
    }
    if (normalised.auth.passphrase !== undefined) {
      if (normalised.auth.passphrase === '') {
        secrets.delete(secretId(id, 'passphrase'));
        auth.hasPassphrase = false;
      } else {
        secrets.set(secretId(id, 'passphrase'), normalised.auth.passphrase);
        auth.hasPassphrase = true;
      }
    }
    if (normalised.auth.privateKey !== undefined) {
      if (normalised.auth.privateKey.trim() === '') {
        secrets.delete(secretId(id, 'key'));
        auth.hasInlineKey = false;
      } else {
        const parsed = parsePrivateKey(normalised.auth.privateKey, normalised.auth.passphrase || undefined);
        secrets.set(secretId(id, 'key'), normalised.auth.privateKey);
        auth.hasInlineKey = true;
        auth.keyFingerprint = parsed.fingerprint;
      }
    }
    if (auth.type === 'privateKey' && auth.privateKeyPath && !auth.hasInlineKey) {
      // Best-effort fingerprint refresh with the passphrase we might have.
      const passphrase = secrets.get(secretId(id, 'passphrase')) ?? undefined;
      try {
        const keyBuf = readPrivateKeyFile(auth.privateKeyPath);
        auth.keyFingerprint = tryFingerprint(keyBuf, passphrase) ?? auth.keyFingerprint;
      } catch {
        /* the file may appear later; keep the stored fingerprint */
      }
    }

    // ---- jump host ---------------------------------------------------
    let jump: StoredJump | null = null;
    if (normalised.jump) {
      const previous = existing?.jump ?? null;
      const jumpAuth = this.mergeAuth(id, previous?.auth, normalised.jump.auth, true);
      if (normalised.jump.auth.password !== undefined) {
        if (normalised.jump.auth.password === '') {
          secrets.delete(secretId(id, 'jumpPassword'));
          jumpAuth.hasPassword = false;
        } else {
          secrets.set(secretId(id, 'jumpPassword'), normalised.jump.auth.password);
          jumpAuth.hasPassword = true;
        }
      }
      if (normalised.jump.auth.passphrase !== undefined) {
        if (normalised.jump.auth.passphrase === '') {
          secrets.delete(secretId(id, 'jumpPassphrase'));
          jumpAuth.hasPassphrase = false;
        } else {
          secrets.set(secretId(id, 'jumpPassphrase'), normalised.jump.auth.passphrase);
          jumpAuth.hasPassphrase = true;
        }
      }
      if (normalised.jump.auth.privateKey !== undefined) {
        if (normalised.jump.auth.privateKey.trim() === '') {
          secrets.delete(`profiles/${id}/jump/key`);
          jumpAuth.hasInlineKey = false;
        } else {
          const parsed = parsePrivateKey(normalised.jump.auth.privateKey, normalised.jump.auth.passphrase || undefined);
          secrets.set(`profiles/${id}/jump/key`, normalised.jump.auth.privateKey);
          jumpAuth.hasInlineKey = true;
          jumpAuth.keyFingerprint = parsed.fingerprint;
        }
      }
      jump = {
        host: normalised.jump.host,
        port: normalised.jump.port ?? DEFAULT_PORT,
        username: normalised.jump.username,
        auth: jumpAuth,
      };
    } else if (existing?.jump) {
      // jump removed: drop its secrets
      secrets.deleteByPrefix(`profiles/${id}/jump/`);
    }

    const record: StoredProfile = {
      id,
      name: normalised.name,
      host: normalised.host,
      port: normalised.port ?? DEFAULT_PORT,
      username: normalised.username,
      auth,
      jump,
      cols: normalised.cols ?? existing?.cols ?? DEFAULT_COLS,
      rows: normalised.rows ?? existing?.rows ?? DEFAULT_ROWS,
      term: normalised.term ?? existing?.term ?? DEFAULT_TERM,
      keepAliveMs: normalised.keepAliveMs ?? existing?.keepAliveMs ?? DEFAULT_KEEPALIVE,
      color: normalised.color ?? existing?.color ?? null,
      tags: normalised.tags ?? existing?.tags ?? [],
      group: normalised.group ?? existing?.group ?? null,
      note: normalised.note ?? existing?.note ?? '',
      favorite: normalised.favorite ?? existing?.favorite ?? false,
      order: existing?.order ?? this.store.read().length,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastConnectedAt: existing?.lastConnectedAt ?? null,
      distro: existing?.distro ?? null,
    };

    this.store.update((list) => {
      const idx = list.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = record;
        return next;
      }
      return [...list, record];
    });

    log.info('profile saved', { id, host: record.host, user: record.username, auth: auth.type });
    return this.toPublic(record);
  }

  remove(id: string): void {
    const before = this.store.read().length;
    const next = this.store.read().filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
    if (next.length === before) throw fail('PROFILE_NOT_FOUND', '该连接已不存在');
    this.store.write(next);
    this.secrets.deleteByPrefix(`profiles/${id}/`);
    log.info('profile removed', { id });
  }

  reorder(orderedIds: string[]): ConnectionProfile[] {
    const current = this.store.read();
    const byId = new Map(current.map((p) => [p.id, p]));
    const ordered: StoredProfile[] = [];
    for (const id of orderedIds) {
      const found = byId.get(id);
      if (found) {
        ordered.push(found);
        byId.delete(id);
      }
    }
    // Anything not mentioned keeps its previous relative order at the end.
    const rest = current.filter((p) => byId.has(p.id));
    const next = [...ordered, ...rest].map((p, i) => ({ ...p, order: i }));
    this.store.write(next);
    return this.list();
  }

  /** 连接成功后写入探测到的发行版；重复写同样的值不会落盘。 */
  setDistro(id: string, distro: { id: string; name: string; version: string } | null): void {
    const current = this.store.read().find((p) => p.id === id);
    if (!current) return;
    const same =
      current.distro?.id === distro?.id && current.distro?.name === distro?.name;
    if (same) return;
    this.store.update((list) => list.map((p) => (p.id === id ? { ...p, distro } : p)));
    log.info('profile distro updated', { id, distro: distro?.id ?? null });
  }

  markUsed(id: string): void {
    const now = new Date().toISOString();
    this.store.update((list) => list.map((p) => (p.id === id ? { ...p, lastConnectedAt: now } : p)));
  }

  /* ---------------------------------------------------------------- */

  /** Build everything the SSH layer needs, decrypting secrets on demand. */
  resolve(id: string, overrides: { password?: string; passphrase?: string } = {}): ResolvedConnection {
    const stored = this.store.read().find((p) => p.id === id);
    if (!stored) throw fail('PROFILE_NOT_FOUND', '该连接已不存在，请刷新列表');

    const target: ResolvedEndpoint = {
      host: stored.host,
      port: stored.port,
      username: stored.username,
      auth: this.resolveAuth(id, stored.auth, overrides, false),
    };

    const jump = stored.jump
      ? {
          host: stored.jump.host,
          port: stored.jump.port,
          username: stored.jump.username,
          auth: this.resolveAuth(id, stored.jump.auth, {}, true),
        }
      : null;

    return {
      profile: this.toPublic(stored),
      target,
      jump,
      cols: stored.cols,
      rows: stored.rows,
      term: stored.term,
      keepAliveMs: stored.keepAliveMs,
    };
  }

  private resolveAuth(
    profileId: string,
    auth: StoredAuthBlock,
    overrides: { password?: string; passphrase?: string },
    isJump: boolean,
  ): ResolvedAuth {
    const passphrase =
      overrides.passphrase ||
      this.secrets.get(secretId(profileId, isJump ? 'jumpPassphrase' : 'passphrase')) ||
      undefined;

    if (auth.type === 'password') {
      const password = overrides.password ?? this.secrets.get(secretId(profileId, isJump ? 'jumpPassword' : 'password'));
      if (!password) {
        throw fail('AUTH_REQUIRED', '该连接没有保存密码，请输入密码后连接');
      }
      return { type: 'password', password };
    }

    if (auth.type === 'privateKey') {
      const inline = this.secrets.get(`profiles/${profileId}/${isJump ? 'jump/key' : 'key'}`);
      const keyBuf = inline ? Buffer.from(inline, 'utf8') : readPrivateKeyFile(auth.privateKeyPath ?? '');
      const parsed = parsePrivateKey(keyBuf, passphrase);
      return { type: 'privateKey', privateKey: keyBuf, passphrase: parsed.passphrase };
    }

    return { type: 'agent', agentSocket: auth.agentSocket };
  }

  private mergeAuth(
    profileId: string,
    previous: StoredAuthBlock | undefined,
    input: ProfileInput['auth'],
    isJump: boolean,
  ): StoredAuthBlock {
    const type = input.type;
    const base: StoredAuthBlock = previous
      ? { ...previous }
      : {
          type,
          hasPassword: false,
          hasPassphrase: false,
          hasInlineKey: false,
        };

    base.type = type;

    if (type === 'privateKey') {
      if (input.privateKeyPath !== undefined) base.privateKeyPath = input.privateKeyPath.trim() || undefined;
      base.hasPassword = false;
      this.secrets.delete(secretId(profileId, isJump ? 'jumpPassword' : 'password'));
    } else if (type === 'password') {
      base.privateKeyPath = undefined;
      base.agentSocket = undefined;
      base.keyFingerprint = undefined;
      base.hasInlineKey = false;
      this.secrets.delete(`profiles/${profileId}/${isJump ? 'jump/key' : 'key'}`);
    } else if (type === 'agent') {
      base.privateKeyPath = undefined;
      base.hasInlineKey = false;
      base.keyFingerprint = undefined;
      base.hasPassword = false;
      this.secrets.delete(secretId(profileId, isJump ? 'jumpPassword' : 'password'));
      if (input.agentSocket !== undefined) base.agentSocket = input.agentSocket.trim() || undefined;
    }
    return base;
  }

  private toPublic(p: StoredProfile): ConnectionProfile {
    const auth: PublicAuth = {
      type: p.auth.type,
      hasSecret: p.auth.hasPassword || p.auth.hasPassphrase || p.auth.hasInlineKey,
      privateKeyPath: p.auth.privateKeyPath,
      agentSocket: p.auth.agentSocket,
      keyFingerprint: p.auth.keyFingerprint,
    };
    return {
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      auth,
      jump: p.jump
        ? {
            host: p.jump.host,
            port: p.jump.port,
            username: p.jump.username,
            auth: {
              type: p.jump.auth.type,
              hasSecret: p.jump.auth.hasPassword || p.jump.auth.hasPassphrase || p.jump.auth.hasInlineKey,
              privateKeyPath: p.jump.auth.privateKeyPath,
              keyFingerprint: p.jump.auth.keyFingerprint,
            },
          }
        : null,
      cols: p.cols,
      rows: p.rows,
      term: p.term,
      keepAliveMs: p.keepAliveMs,
      color: p.color,
      tags: p.tags,
      group: p.group ?? null,
      note: p.note ?? '',
      favorite: Boolean(p.favorite),
      order: p.order,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      lastConnectedAt: p.lastConnectedAt,
      distro: p.distro ?? null,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

function validateInput(input: ProfileInput): ProfileInput {
  if (!input || typeof input !== 'object') throw fail('CONFIG_INVALID', '请求格式不正确');
  const name = String(input.name ?? '').trim();
  const host = String(input.host ?? '').trim();
  const username = String(input.username ?? '').trim();

  if (!name) throw fail('CONFIG_INVALID', '请填写连接名称', 'name');
  if (!host) throw fail('CONFIG_INVALID', '请填写主机地址', 'host');
  if (!username) throw fail('CONFIG_INVALID', '请填写用户名', 'username');
  if (/[\s]/.test(host)) throw fail('CONFIG_INVALID', '主机地址不能包含空格', 'host');

  const port = input.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw fail('CONFIG_INVALID', '端口需在 1–65535 之间', 'port');
  }

  if (!input.auth || typeof input.auth !== 'object') {
    throw fail('CONFIG_INVALID', '请选择认证方式', 'auth');
  }
  const type = input.auth.type;
  if (type !== 'password' && type !== 'privateKey' && type !== 'agent') {
    throw fail('CONFIG_INVALID', '不支持的认证方式', 'auth.type');
  }
  if (type === 'privateKey') {
    const hasPath = Boolean(input.auth.privateKeyPath?.trim());
    const hasInline = Boolean(input.auth.privateKey?.trim());
    const previousOnly = input.auth.privateKeyPath === undefined && input.auth.privateKey === undefined && input.id;
    if (!hasPath && !hasInline && !previousOnly) {
      throw fail('CONFIG_INVALID', '请选择私钥文件或粘贴私钥内容', 'auth.privateKeyPath');
    }
  }

  const cols = input.cols ?? DEFAULT_COLS;
  const rows = input.rows ?? DEFAULT_ROWS;
  if (!Number.isInteger(cols) || cols < 20 || cols > 500) throw fail('CONFIG_INVALID', '列数需在 20–500 之间', 'cols');
  if (!Number.isInteger(rows) || rows < 5 || rows > 200) throw fail('CONFIG_INVALID', '行数需在 5–200 之间', 'rows');

  const keepAliveMs = input.keepAliveMs ?? DEFAULT_KEEPALIVE;
  if (!Number.isFinite(keepAliveMs) || keepAliveMs < 0 || keepAliveMs > 600_000) {
    throw fail('CONFIG_INVALID', '心跳间隔需在 0–600000 ms 之间', 'keepAliveMs');
  }

  if (input.jump) {
    const j = input.jump;
    if (!String(j.host ?? '').trim()) throw fail('CONFIG_INVALID', '请填写跳板机地址', 'jump.host');
    if (!String(j.username ?? '').trim()) throw fail('CONFIG_INVALID', '请填写跳板机用户名', 'jump.username');
    if (j.port !== undefined && (!Number.isInteger(j.port) || j.port < 1 || j.port > 65535)) {
      throw fail('CONFIG_INVALID', '跳板机端口需在 1–65535 之间', 'jump.port');
    }
    if (!j.auth || typeof j.auth !== 'object') throw fail('CONFIG_INVALID', '请选择跳板机认证方式', 'jump.auth');
  }

  return {
    ...input,
    name,
    host,
    username,
    port,
    cols,
    rows,
    keepAliveMs,
    term: input.term?.trim() || DEFAULT_TERM,
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 12) : [],
    group:
      typeof input.group === 'string' && input.group.trim()
        ? input.group.trim().slice(0, 32)
        : null,
    color: input.color ?? undefined,
    note: typeof input.note === 'string' ? input.note.slice(0, 500) : '',
    favorite: Boolean(input.favorite),
  };
}
