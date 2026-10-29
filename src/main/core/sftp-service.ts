import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Client, SFTPWrapper, FileEntryWithStats } from 'ssh2';
import { app, dialog, shell } from 'electron';
import { fail } from './errors';
import { createLogger } from './logger';
import { execOnce, type RemoteDeps, type RemotePool } from './remote';
import { getMainWindow } from '../window';

const log = createLogger('sftp');

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'active' | 'done' | 'error' | 'canceled';

export interface RemoteFile {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'link';
  size: number;
  mtime: number;
  mode: number;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  /** 绝对主目录，供前端把路径显示成 ~ 前缀 */
  home: string;
  entries: RemoteFile[];
}

export interface Transfer {
  id: string;
  hostId: string;
  direction: TransferDirection;
  name: string;
  localPath: string;
  remotePath: string;
  transferred: number;
  total: number;
  status: TransferStatus;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const MAX_TRANSFER_ROWS = 40;

/** 只做词法归一化：远程路径最终由服务器的权限模型裁决。 */
function normalizeRemotePath(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '~';
  if (raw.includes('\0') || raw.includes('\n')) {
    throw fail('CONFIG_INVALID', '远程路径包含非法字符');
  }
  const isHome = raw === '~' || raw.startsWith('~/');
  const segments: string[] = [];
  // 开头的 `~` 是 home 简写，不参与目录分段
  for (const part of raw.split('/').slice(isHome ? 1 : 0)) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const joined = segments.join('/');
  if (isHome) return `~${joined ? `/${joined}` : ''}`;
  return raw.startsWith('/') ? `/${joined}` : joined || '/';
}

function parentPath(remotePath: string): string | null {
  if (remotePath === '/' || remotePath === '~' || !remotePath) return null;
  const normalized = remotePath.replace(/\/+$/, '');
  const cut = normalized.lastIndexOf('/');
  if (cut < 0) return '.';
  if (cut === 0) return '/';
  const parent = normalized.slice(0, cut);
  return parent === '~' ? '~' : parent;
}

function toRemoteFile(base: string, entry: FileEntryWithStats): RemoteFile {
  const longName = entry.longname ?? '';
  const mode = entry.attrs.mode ?? 0;
  const isDir = entry.attrs.isDirectory();
  const isLink = entry.attrs.isSymbolicLink();
  return {
    name: entry.filename,
    path: base === '/' ? `/${entry.filename}` : `${base.replace(/\/+$/, '')}/${entry.filename}`,
    type: isDir ? 'dir' : isLink ? 'link' : 'file',
    size: entry.attrs.size ?? 0,
    mtime: toMillis(entry.attrs.mtime),
    mode: mode || (longName.startsWith('d') ? 0o755 : 0o644),
  };
}

/** 不同 ssh2 版本/服务端给的 mtime 可能是秒也可能是毫秒，这里统一成毫秒。 */
function toMillis(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0;
  return value > 1e12 ? value : value * 1000;
}

/**
 * 每条 SSH 连接只开一个 SFTP 子系统通道，后续请求共用。
 * 每次重开通道要一个 RTT（跨网络 80 ms 起），连续浏览目录时体验差别很明显。
 */
const sftpChannels = new WeakMap<Client, Promise<SFTPWrapper>>();

function getSftp(client: Client): Promise<SFTPWrapper> {
  const cached = sftpChannels.get(client);
  if (cached) return cached;

  const opening = new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(fail('NETWORK', `无法启动 SFTP 子系统：${err.message}`));
        return;
      }
      resolve(sftp);
    });
  });
  sftpChannels.set(client, opening);
  opening.catch(() => sftpChannels.delete(client));
  client.once('close', () => sftpChannels.delete(client));
  return opening;
}

async function withSftp<T>(client: Client, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  return fn(await getSftp(client));
}

function call<T>(sftp: SFTPWrapper, method: keyof SFTPWrapper, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // ssh2 的回调风格 API 没有 Promise 版本，这里统一包一层。
    (sftp as unknown as Record<string, (...a: unknown[]) => void>)[method](
      ...args,
      (err: Error | null, value: T) => (err ? reject(toSftpError(err)) : resolve(value)),
    );
  });
}

/** SFTP 协议错误码：2 = 不存在，3 = 权限不足。 */
function toSftpError(err: Error): Error {
  const code = (err as Error & { code?: number }).code;
  if (code === 2) return fail('NOT_FOUND', `远端路径不存在：${err.message}`);
  if (code === 3) return fail('FORBIDDEN', `没有权限：${err.message}`);
  return fail('NETWORK', err.message);
}

const homeCache = new WeakMap<Client, Promise<string>>();

/**
 * 把 `~` / `~/x` 换成服务器上的绝对路径。
 * sftp 的 realpath 在部分服务器上不接受相对路径，这里直接用 shell 读 $HOME，稳定且只取一次。
 */
async function resolveRemotePath(client: Client, target: string): Promise<string> {
  if (target !== '~' && !target.startsWith('~/')) return target;
  let home = homeCache.get(client);
  if (!home) {
    home = execOnce(client, 'printf %s "$HOME"')
      .then((value) => value.trim() || '/')
      .catch(() => '/');
    homeCache.set(client, home);
  }
  const base = await home;
  if (target === '~') return base;
  return `${base.replace(/\/+$/, '')}/${target.slice(2)}`;
}

export class SftpService {
  private readonly transfers = new Map<string, Transfer>();

  constructor(
    private readonly deps: RemoteDeps,
    private readonly pool: RemotePool,
  ) {}

  async list(profileId: string, remotePath: string): Promise<DirectoryListing> {
    const target = normalizeRemotePath(remotePath);
    return this.pool.with(profileId, (client) =>
      withSftp(client, async (sftp) => {
        const resolved = await resolveRemotePath(client, target);
        const home = await resolveRemotePath(client, '~');
        const raw = await call<FileEntryWithStats[]>(sftp, 'readdir', resolved);
        const entries = raw
          .map((entry) => toRemoteFile(target, entry))
          .filter((entry) => entry.name !== '.' && entry.name !== '..')
          .sort((a, b) => {
            if (a.type === 'dir' && b.type !== 'dir') return -1;
            if (b.type === 'dir' && a.type !== 'dir') return 1;
            return a.name.localeCompare(b.name, 'zh-Hans-CN');
          });
        /* 主目录的上一层要按解析后的绝对路径算，否则用户在 `~` 处永远退不到 `/` */
        const parent = target === '~' ? parentPath(home) : parentPath(target);
        return { path: target, parent, home, entries };
      }),
    );
  }

  async createDirectory(profileId: string, remotePath: string, name: string): Promise<DirectoryListing> {
    const parent = normalizeRemotePath(remotePath);
    const clean = name.trim();
    if (!clean || clean.includes('/') || clean.includes('\0')) {
      throw fail('CONFIG_INVALID', '文件夹名不能包含斜杠');
    }
    const target = parent === '/' ? `/${clean}` : `${parent.replace(/\/+$/, '')}/${clean}`;
    await this.pool.with(profileId, (client) =>
      withSftp(client, async (sftp) =>
        call<void>(sftp, 'mkdir', await resolveRemotePath(client, target)),
      ),
    );
    return this.list(profileId, remotePath);
  }

  async remove(profileId: string, remotePath: string): Promise<DirectoryListing> {
    const target = normalizeRemotePath(remotePath);
    if (target === '/' || target === '~') throw fail('CONFIG_INVALID', '不能删除根目录');

    await this.pool.with(profileId, async (client) => {
      // `~` 在引号里不会被 shell 展开，先换成绝对路径再删
      const resolved = await resolveRemotePath(client, target);
      const quoted = `'${resolved.replace(/'/g, `'\\''`)}'`;
      // 目录用 rm -rf（SFTP 只有 rmdir，删不了非空目录）；文件也走同一条命令。
      await execOnce(client, `rm -rf -- ${quoted}`);
      // 命令的退出码拿不到，删完再确认一次，避免“看起来成功其实没删”
      const gone = await withSftp(client, async (sftp) => {
        try {
          await call(sftp, 'stat', resolved);
          return false;
        } catch {
          return true;
        }
      });
      if (!gone) throw fail('NETWORK', '删除失败：远端路径仍然存在');
    });
    return this.list(profileId, parentPath(target) ?? '/');
  }

  async rename(profileId: string, from: string, toName: string): Promise<DirectoryListing> {
    const source = normalizeRemotePath(from);
    const clean = toName.trim();
    if (!clean || clean.includes('/')) throw fail('CONFIG_INVALID', '新名称不能包含斜杠');
    const parent = parentPath(source) ?? '/';
    const target = parent === '/' ? `/${clean}` : `${parent.replace(/\/+$/, '')}/${clean}`;
    await this.pool.with(profileId, (client) =>
      withSftp(client, async (sftp) =>
        call<void>(
          sftp,
          'rename',
          await resolveRemotePath(client, source),
          await resolveRemotePath(client, target),
        ),
      ),
    );
    return this.list(profileId, parent);
  }

  /** 选择本地文件并上传到 currentDir。 */
  async upload(profileId: string, currentDir: string): Promise<Transfer | null> {
    const win = getMainWindow() ?? undefined;
    const picked = await dialog.showOpenDialog(win as never, {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const dir = normalizeRemotePath(currentDir);
    let first: Transfer | null = null;
    for (const localPath of picked.filePaths.slice(0, 20)) {
      const remotePath =
        dir === '/'
          ? `/${path.basename(localPath)}`
          : `${dir.replace(/\/+$/, '')}/${path.basename(localPath)}`;
      const transfer = this.track(profileId, 'upload', localPath, remotePath);
      first ??= transfer;
      // 传输在后台进行：HTTP 请求在用户选完文件后立即返回，进度走 /transfers 轮询
      void this.runUpload(profileId, localPath, remotePath, transfer.id);
    }
    return first;
  }

  private async runUpload(
    profileId: string,
    localPath: string,
    remotePath: string,
    id: string,
  ): Promise<void> {
    try {
      await this.pool.with(profileId, (client) =>
        withSftp(client, async (sftp) => {
          const resolved = await resolveRemotePath(client, remotePath);
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(
              localPath,
              resolved,
              { step: (transferred, _chunk, total) => this.progress(id, transferred, total) },
              (err) => (err ? reject(toSftpError(err)) : resolve()),
            );
          });
        }),
      );
      this.finish(id, null);
    } catch (err) {
      this.finish(id, err instanceof Error ? err.message : String(err));
    }
  }

  async download(profileId: string, remotePath: string): Promise<Transfer | null> {
    const source = normalizeRemotePath(remotePath);
    const win = getMainWindow() ?? undefined;
    const picked = await dialog.showSaveDialog(win as never, {
      title: '保存到本地',
      defaultPath: path.basename(source),
    });
    if (picked.canceled || !picked.filePath) return null;

    const localPath = picked.filePath;
    const transfer = this.track(profileId, 'download', localPath, source);
    void this.runDownload(profileId, source, localPath, transfer.id);
    return transfer;
  }

  private async runDownload(
    profileId: string,
    remotePath: string,
    localPath: string,
    id: string,
  ): Promise<void> {
    try {
      await this.pool.with(profileId, (client) =>
        withSftp(client, async (sftp) => {
          const resolved = await resolveRemotePath(client, remotePath);
          await new Promise<void>((resolve, reject) => {
            sftp.fastGet(
              resolved,
              localPath,
              { step: (transferred, _chunk, total) => this.progress(id, transferred, total) },
              (err) => (err ? reject(toSftpError(err)) : resolve()),
            );
          });
        }),
      );
      this.finish(id, null);
    } catch (err) {
      this.finish(id, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 右键「打开」：把远端文件拉到临时目录，再用系统默认程序打开。
   * 目录不在这里处理（前端直接进入目录）。
   */
  async openFile(profileId: string, remotePath: string): Promise<{ localPath: string; opened: boolean }> {
    const source = normalizeRemotePath(remotePath);
    const name = path.basename(source) || 'download';
    const dir = path.join(app.getPath('temp'), 'hop-open');
    await fs.promises.mkdir(dir, { recursive: true });
    /* 同名文件加时间戳，避免上次打开的旧内容缓存 */
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const localPath = path.join(dir, `${stamp}-${name.replace(/[\\/:*?"<>|]/g, '_')}`);

    await this.pool.with(profileId, (client) =>
      withSftp(client, async (sftp) => {
        const resolved = await resolveRemotePath(client, source);
        await new Promise<void>((resolve, reject) => {
          sftp.fastGet(resolved, localPath, (err) => (err ? reject(toSftpError(err)) : resolve()));
        });
      }),
    );

    const error = await shell.openPath(localPath);
    if (error) log.warn('failed to open remote file', { localPath, error });
    return { localPath, opened: !error };
  }

  listTransfers(hostId?: string): Transfer[] {
    const all = [...this.transfers.values()].sort((a, b) => b.startedAt - a.startedAt);
    return (hostId ? all.filter((item) => item.hostId === hostId) : all).slice(0, MAX_TRANSFER_ROWS);
  }

  clearFinished(): void {
    for (const [id, transfer] of this.transfers) {
      if (transfer.status !== 'active') this.transfers.delete(id);
    }
  }

  private track(
    hostId: string,
    direction: TransferDirection,
    localPath: string,
    remotePath: string,
  ): Transfer {
    const transfer: Transfer = {
      id: randomUUID(),
      hostId,
      direction,
      name: path.basename(direction === 'upload' ? localPath : remotePath),
      localPath,
      remotePath,
      transferred: 0,
      total: 0,
      status: 'active',
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.transfers.set(transfer.id, transfer);
    // 只保留最近若干条，避免常驻面板无限增长
    const finished = [...this.transfers.values()]
      .filter((item) => item.status !== 'active')
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const stale of finished.slice(MAX_TRANSFER_ROWS)) this.transfers.delete(stale.id);
    log.info('transfer started', { direction, remotePath, localPath });
    return transfer;
  }

  private progress(id: string, transferred: number, total: number): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    transfer.transferred = transferred;
    transfer.total = total;
  }

  private finish(id: string, error: string | null): Transfer | null {
    const transfer = this.transfers.get(id);
    if (!transfer) return null;
    transfer.status = error ? 'error' : 'done';
    transfer.error = error;
    transfer.finishedAt = Date.now();
    if (!error && transfer.total === 0) transfer.total = transfer.transferred;
    log.info('transfer finished', { id, status: transfer.status, error });
    return transfer;
  }
}

export function directoryLabel(remotePath: string): string {
  if (remotePath === '~') return '~';
  const trimmed = remotePath.replace(/\/+$/, '');
  return trimmed.split('/').pop() || '/';
}
