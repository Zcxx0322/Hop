import { app, dialog, ipcMain } from 'electron';
import { CH } from '../../shared/channels';
import type {
  AppInfo,
  OpenSessionRequest,
  ProfileInput,
  ResizeRequest,
} from '../../shared/contract';
import { CONTRACT_VERSION } from '../../shared/contract';
import { asResult, fail } from '../core/errors';
import type { SessionManager } from '../core/session-manager';
import type { KnownHostsStore } from '../core/known-hosts';
import { createLogger } from '../core/logger';
import type { ProfileStore } from '../core/profile-store';
import { expandHome, tryFingerprint } from '../core/keys';
import fs from 'node:fs';

const log = createLogger('ipc');

export interface IpcContext {
  profiles: ProfileStore;
  knownHosts: KnownHostsStore;
  sessions: SessionManager;
  secureStorage: boolean;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw fail('CONFIG_INVALID', `参数 ${field} 无效`);
  return value;
}

function requireId(payload: unknown, field = 'id'): string {
  if (!payload || typeof payload !== 'object') throw fail('CONFIG_INVALID', '请求格式不正确');
  const value = (payload as Record<string, unknown>)[field];
  return requireString(value, field);
}

/**
 * Registers every IPC handler exactly once and wires session events to the
 * renderer. Returns a disposer used on quit / window reload in tests.
 */
export function registerIpc(ctx: IpcContext): () => void {
  const { profiles, knownHosts, sessions } = ctx;

  const handle = <T>(channel: string, fn: (...args: never[]) => Promise<T> | T) => {
    ipcMain.handle(channel, async (_event, ...args) =>
      asResult(() => fn(...(args as never[]))),
    );
  };

  /* ---- app ------------------------------------------------------- */
  handle(CH.info, () => info(ctx));
  handle(CH.pickPrivateKey, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择私钥文件',
      defaultPath: expandHome('~/.ssh'),
      properties: ['openFile'],
      filters: [
        { name: '私钥', extensions: ['pem', 'key', 'ppk', 'pub', '*'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true, path: null, fingerprint: null };
    const filePath = result.filePaths[0];
    let fingerprint: string | null = null;
    try {
      fingerprint = tryFingerprint(fs.readFileSync(filePath));
    } catch {
      fingerprint = null;
    }
    return { canceled: false, path: filePath, fingerprint };
  });

  /* ---- profiles -------------------------------------------------- */
  handle(CH.profilesList, () => profiles.list());
  handle(CH.profilesSave, (input: ProfileInput) => profiles.save(input));
  handle(CH.profilesRemove, (payload: { id?: string }) => {
    profiles.remove(requireId(payload));
    return true;
  });
  handle(CH.profilesReorder, (payload: { ids?: string[] }) => {
    const ids = payload?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw fail('CONFIG_INVALID', 'ids 必须是字符串数组');
    }
    return profiles.reorder(ids);
  });

  /* ---- sessions -------------------------------------------------- */
  handle(CH.sessionsList, () => sessions.list());
  handle(CH.sessionsOpen, (req: OpenSessionRequest) => sessions.open(req));
  handle(CH.sessionsWrite, (payload: { sessionId?: string; data?: string }) => {
    const sessionId = requireId(payload, 'sessionId');
    const data = payload?.data;
    if (typeof data !== 'string') throw fail('CONFIG_INVALID', 'data 必须是字符串');
    sessions.write(sessionId, data);
    return true;
  });
  handle(CH.sessionsResize, (payload: ResizeRequest) => {
    const sessionId = requireId(payload, 'sessionId');
    const cols = Number((payload as ResizeRequest).cols);
    const rows = Number((payload as ResizeRequest).rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw fail('CONFIG_INVALID', 'cols/rows 无效');
    sessions.resize(sessionId, cols, rows);
    return true;
  });
  handle(CH.sessionsClose, (payload: { sessionId?: string }) => {
    sessions.close(requireId(payload, 'sessionId'));
    return true;
  });

  /* ---- host keys ------------------------------------------------- */
  handle(CH.knownHostsList, () => knownHosts.list());
  handle(CH.knownHostsForget, (payload: { id?: string }) => {
    knownHosts.forget(requireString(payload?.id, 'id'));
    return knownHosts.list();
  });
  handle(CH.hostKeyAnswer, (payload: { requestId?: string; accept?: boolean; persist?: boolean }) => {
    const requestId = requireString(payload?.requestId, 'requestId');
    const accept = Boolean(payload?.accept);
    const persist = Boolean(payload?.persist ?? accept);
    const handled = sessions.answerHostKey(requestId, accept, persist);
    if (!handled) throw fail('SESSION_NOT_FOUND', '该主机指纹确认请求已过期');
    return true;
  });

  log.info('ipc handlers registered');

  return () => {
    for (const channel of Object.values(CH)) ipcMain.removeHandler(channel);
  };
}

function info(ctx: IpcContext): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    contractVersion: CONTRACT_VERSION,
    secureStorage: ctx.secureStorage,
  };
}
