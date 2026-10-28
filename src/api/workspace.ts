import { request } from './http';

/* ---- 远程文件 ---------------------------------------------------------- */

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
  entries: RemoteFile[];
}

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'active' | 'done' | 'error' | 'canceled';

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

const hostPath = (hostId: string, suffix: string): string =>
  `/hosts/${encodeURIComponent(hostId)}${suffix}`;

export const listFiles = (hostId: string, path: string): Promise<DirectoryListing> =>
  request<DirectoryListing>(`${hostPath(hostId, '/files')}?path=${encodeURIComponent(path)}`);

export const removeRemote = (hostId: string, path: string): Promise<DirectoryListing> =>
  request<DirectoryListing>(`${hostPath(hostId, '/files')}?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });

export const makeDirectory = (
  hostId: string,
  dir: string,
  name: string,
): Promise<DirectoryListing> =>
  request<DirectoryListing>(hostPath(hostId, '/files/mkdir'), {
    method: 'POST',
    body: JSON.stringify({ dir, name }),
  });

export const renameRemote = (
  hostId: string,
  from: string,
  name: string,
): Promise<DirectoryListing> =>
  request<DirectoryListing>(hostPath(hostId, '/files/rename'), {
    method: 'POST',
    body: JSON.stringify({ from, name }),
  });

/** 打开系统文件选择框并开始上传；用户取消时返回 null。 */
export const startUpload = (hostId: string, dir: string): Promise<{ transfer: Transfer | null }> =>
  request<{ transfer: Transfer | null }>(hostPath(hostId, '/files/upload'), {
    method: 'POST',
    body: JSON.stringify({ dir }),
    // 选择文件是人工操作，不能按普通请求的 15 秒超时
    timeoutMs: 10 * 60_000,
  });

/** 打开系统保存框并开始下载；用户取消时返回 null。 */
export const startDownload = (
  hostId: string,
  path: string,
): Promise<{ transfer: Transfer | null }> =>
  request<{ transfer: Transfer | null }>(hostPath(hostId, '/files/download'), {
    method: 'POST',
    body: JSON.stringify({ path }),
    timeoutMs: 10 * 60_000,
  });

export const listTransfers = (hostId?: string): Promise<Transfer[]> =>
  request<Transfer[]>(`/transfers${hostId ? `?hostId=${encodeURIComponent(hostId)}` : ''}`);

export const clearTransfers = (): Promise<void> => request<void>('/transfers', { method: 'DELETE' });

/* ---- 主机监控 ---------------------------------------------------------- */

export interface HostMetrics {
  sampledAt: number;
  os: string | null;
  cores: number | null;
  /** 0–100；第一次采样没有基线时为 null。 */
  cpu: number | null;
  load: [number, number, number] | null;
  uptimeSec: number | null;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  diskTotal: number;
  diskUsed: number;
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  unsupported: boolean;
}

export const sampleHost = (hostId: string): Promise<HostMetrics> =>
  request<HostMetrics>(hostPath(hostId, '/monitor'));
