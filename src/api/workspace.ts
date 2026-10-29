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
  /** 绝对主目录，用于把路径显示成 ~ 前缀 */
  home: string;
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

/* ---- 主机可达性 -------------------------------------------------------- */

export type ProbeReason = 'timeout' | 'refused' | 'dns' | 'error';

export interface ProbeResult {
  reachable: boolean;
  rttMs: number | null;
  reason?: ProbeReason;
}

/** 只做 TCP 探测（不握手、不发凭据），用于资产页的在线 / 离线状态。 */
export const probeHosts = (ids: string[]): Promise<Record<string, ProbeResult>> =>
  request<{ results: Record<string, ProbeResult> }>('/hosts/probe', {
    method: 'POST',
    body: JSON.stringify({ ids }),
    timeoutMs: 8000,
  }).then((payload) => payload.results);

/* ---- 主机监控 ---------------------------------------------------------- */

export interface HostAddress {
  iface: string;
  address: string;
  family: 'ipv4';
}

export interface HostDisk {
  filesystem: string;
  mount: string;
  total: number;
  used: number;
}

export interface HostProcess {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
}

export interface HostMetrics {
  sampledAt: number;
  os: string | null;
  hostname: string | null;
  kernel: string | null;
  arch: string | null;
  timezone: string | null;
  cpuModel: string | null;
  cores: number | null;
  /** 0–100；第一次采样没有基线时为 null。 */
  cpu: number | null;
  load: [number, number, number] | null;
  uptimeSec: number | null;
  users: number | null;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  diskTotal: number;
  diskUsed: number;
  disks: HostDisk[];
  addresses: HostAddress[];
  dns: string[];
  gateway: string | null;
  processes: HostProcess[];
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  unsupported: boolean;
}

/**
 * 采样主机状态。
 *
 * 这里做一次形状兜底：如果本机还开着旧版后端（多实例、热更新没重启主进程），
 * 新渲染层可能拿到缺字段的 payload，直接渲染会整页崩掉。缺的数组一律补空。
 */
export const sampleHost = async (hostId: string): Promise<HostMetrics> => {
  const payload = await request<Partial<HostMetrics>>(hostPath(hostId, '/monitor'));
  return {
    sampledAt: payload.sampledAt ?? Date.now(),
    os: payload.os ?? null,
    hostname: payload.hostname ?? null,
    kernel: payload.kernel ?? null,
    arch: payload.arch ?? null,
    timezone: payload.timezone ?? null,
    cpuModel: payload.cpuModel ?? null,
    cores: payload.cores ?? null,
    cpu: payload.cpu ?? null,
    load: payload.load ?? null,
    uptimeSec: payload.uptimeSec ?? null,
    users: payload.users ?? null,
    memTotal: payload.memTotal ?? 0,
    memUsed: payload.memUsed ?? 0,
    swapTotal: payload.swapTotal ?? 0,
    swapUsed: payload.swapUsed ?? 0,
    diskTotal: payload.diskTotal ?? 0,
    diskUsed: payload.diskUsed ?? 0,
    disks: payload.disks ?? [],
    addresses: payload.addresses ?? [],
    dns: payload.dns ?? [],
    gateway: payload.gateway ?? null,
    processes: payload.processes ?? [],
    rxBytes: payload.rxBytes ?? 0,
    txBytes: payload.txBytes ?? 0,
    rxRate: payload.rxRate ?? 0,
    txRate: payload.txRate ?? 0,
    unsupported: payload.unsupported ?? false,
  };
};

export const openRemoteFile = (hostId: string, path: string): Promise<{ opened: boolean }> =>
  request<{ opened: boolean }>(hostPath(hostId, '/files/open'), {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
