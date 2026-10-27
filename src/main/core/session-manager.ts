import type { OpenSessionRequest, SessionSnapshot } from '../../shared/contract';
import { fail } from './errors';
import type { KnownHostsStore } from './known-hosts';
import { createLogger } from './logger';
import type { ProfileStore } from './profile-store';
import { SshSession, type SessionHooks } from './ssh-session';

const log = createLogger('sessions');

const MAX_SESSIONS = 24;

/**
 * Owns every live SshSession.
 *
 * `open()` resolves as soon as the session object exists — the actual TCP
 * handshake continues in the background and reports progress through the
 * `session:status` event. Only *local* problems (unknown profile, missing
 * credential, too many sessions) reject `open()`, so a slow or failing
 * server never blocks the UI.
 */
export class SessionManager {
  private readonly sessions = new Map<string, SshSession>();

  constructor(
    private readonly hooks: SessionHooks,
    private readonly deps: { profiles: ProfileStore; knownHosts: KnownHostsStore },
  ) {}

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].map((s) => s.snapshot());
  }

  get(id: string): SessionSnapshot | null {
    return this.sessions.get(id)?.snapshot() ?? null;
  }

  open(req: OpenSessionRequest): SessionSnapshot {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw fail('UNSUPPORTED', `同时最多打开 ${MAX_SESSIONS} 个会话，请先关闭一些标签页`);
    }
    if (!req || typeof req.profileId !== 'string') {
      throw fail('CONFIG_INVALID', '缺少 profileId');
    }

    const resolved = this.deps.profiles.resolve(req.profileId, {
      password: req.password,
      passphrase: req.passphrase,
    });

    const cols = clamp(req.cols ?? resolved.cols, 20, 500);
    const rows = clamp(req.rows ?? resolved.rows, 5, 200);

    const session = new SshSession(resolved, cols, rows, this.hooks, this.deps.knownHosts);
    this.sessions.set(session.id, session);

    // Fire and forget: failures surface through onStatus / onClosed.
    void session.connect().catch((err) => {
      log.error('session connect threw', { id: session.id, err: String(err) });
    });

    this.deps.profiles.markUsed(req.profileId);
    log.info('session opened', { id: session.id, profileId: req.profileId, host: resolved.target.host });
    return session.snapshot();
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw fail('SESSION_NOT_FOUND', '该会话已关闭');
    session.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) throw fail('SESSION_NOT_FOUND', '该会话已关闭');
    session.resize(cols, rows);
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return; // idempotent: closing a dead tab is not an error
    session.close();
  }

  answerHostKey(requestId: string, accept: boolean, persist: boolean): boolean {
    for (const session of this.sessions.values()) {
      if (session.answerHostKey(requestId, accept, persist)) return true;
    }
    return false;
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  /** Called from the session hooks after a session reported `closed`. */
  forget(id: string): void {
    this.sessions.delete(id);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
