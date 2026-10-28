import type { Client } from 'ssh2';
import { createLogger } from './logger';
import { execOnce, type RemoteDeps, type RemotePool } from './remote';

const log = createLogger('monitor');

const SAMPLE_TIMEOUT_MS = 8_000;

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
  /** true 表示远端缺少 /proc（例如 BSD/Windows），只能给出连接状态。 */
  unsupported: boolean;
}

interface CpuBaseline {
  total: number;
  idle: number;
}

interface NetBaseline {
  rx: number;
  tx: number;
  at: number;
}

/**
 * 一次采样只发一条命令：在远端完成所有读取，宽带上限也就几 KB。
 * 所有分支都带 `2>/dev/null`，缺某个文件时不影响其它字段。
 * 末尾再取一次快照，首次打开面板也能立刻算出 CPU 占用与网速。
 */
const SAMPLE_COMMAND = [
  'export LC_ALL=C',
  'echo "##t1"; date +%s%3N 2>/dev/null',
  'echo "##stat"; head -n1 /proc/stat 2>/dev/null',
  'echo "##net"; cat /proc/net/dev 2>/dev/null',
  'echo "##mem"; grep -E "^(MemTotal|MemAvailable|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null',
  'echo "##load"; cat /proc/loadavg 2>/dev/null',
  'echo "##uptime"; cut -d" " -f1 /proc/uptime 2>/dev/null',
  'echo "##cores"; (nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null)',
  'echo "##os"; (grep "^PRETTY_NAME=" /etc/os-release 2>/dev/null | head -n1)',
  'echo "##cpuinfo"; (grep -m1 "^model name" /proc/cpuinfo 2>/dev/null || grep -m1 "^Hardware" /proc/cpuinfo 2>/dev/null)',
  'echo "##info"; uname -s 2>/dev/null; uname -r 2>/dev/null; uname -m 2>/dev/null; hostname 2>/dev/null; date +%Z 2>/dev/null',
  'echo "##addr"; (ip -o -4 addr show 2>/dev/null || hostname -I 2>/dev/null)',
  'echo "##dns"; (grep -E "^nameserver" /etc/resolv.conf 2>/dev/null)',
  'echo "##route"; (ip route show default 2>/dev/null | head -n1)',
  'echo "##disks"; (df -kP 2>/dev/null | grep -vE "^(tmpfs|devtmpfs|overlay|shm|none)" | head -n 9)',
  'echo "##proc"; (ps -eo pid,comm,pcpu,pmem --sort=-pcpu 2>/dev/null | head -n 7)',
  'echo "##users"; (who 2>/dev/null | wc -l)',
  'sleep 0.35',
  'echo "##t2"; date +%s%3N 2>/dev/null',
  'echo "##stat2"; head -n1 /proc/stat 2>/dev/null',
  'echo "##net2"; cat /proc/net/dev 2>/dev/null',
].join('; ');

function section(output: string, name: string): string {
  const marker = `##${name}`;
  const start = output.indexOf(marker);
  if (start < 0) return '';
  const after = output.slice(start + marker.length);
  const next = after.search(/##[a-z]/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `/proc/stat` 首行 → 总时间片与空闲时间片。 */
function parseCpuTotal(text: string): CpuBaseline | null {
  const match = /^cpu\s+(.+)$/m.exec(text);
  if (!match) return null;
  const fields = match[1].trim().split(/\s+/).map(toNumber);
  return {
    idle: (fields[3] ?? 0) + (fields[4] ?? 0),
    total: fields.slice(0, 8).reduce((sum, value) => sum + value, 0),
  };
}

/** 汇总所有非环回网卡的收发字节数。 */
function parseNet(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10 || !parts[0].endsWith(':')) continue;
    if (parts[0].slice(0, -1) === 'lo') continue;
    rx += toNumber(parts[1]);
    tx += toNumber(parts[9]);
  }
  return { rx, tx };
}

/** 解析 `ip -o -4 addr show`（或 `hostname -I` 的回退输出）。 */
function parseAddresses(text: string): HostAddress[] {
  const result: HostAddress[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 形如：2: eth0    inet 10.1.0.9/24 brd 10.1.0.255 scope global eth0
    const ipMatch = /^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(trimmed);
    if (ipMatch) {
      if (ipMatch[1] === 'lo') continue;
      const key = `${ipMatch[1]}:${ipMatch[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ iface: ipMatch[1], address: ipMatch[2], family: 'ipv4' });
      continue;
    }

    // hostname -I 的回退：纯 IP 列表
    if (/^\d+\.\d+\.\d+\.\d+(\s|$)/.test(trimmed)) {
      for (const ip of trimmed.split(/\s+/)) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip.startsWith('127.')) continue;
        if (seen.has(ip)) continue;
        seen.add(ip);
        result.push({ iface: '', address: ip, family: 'ipv4' });
      }
    }
  }
  return result;
}

/** 解析 `df -kP`，单位 KB → 字节。 */
function parseDisks(text: string): HostDisk[] {
  const disks: HostDisk[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, total, used] = parts;
    if (!/^\d+$/.test(total) || !/^\d+$/.test(used)) continue;
    const mount = parts.slice(5).join(' ');
    disks.push({ filesystem, mount, total: Number(total) * 1024, used: Number(used) * 1024 });
    if (disks.length >= 8) break;
  }
  return disks;
}

/** 解析 `ps -eo pid,comm,pcpu,pmem`。 */
function parseProcesses(text: string): HostProcess[] {
  const rows: HostProcess[] = [];
  for (const line of text.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    if (!Number.isFinite(pid)) continue;
    const cpu = Number(parts[2]);
    const mem = Number(parts[3]);
    rows.push({
      pid,
      name: parts.slice(1, parts.length - 2).join(' '),
      cpu: Number.isFinite(cpu) ? cpu : 0,
      mem: Number.isFinite(mem) ? mem : 0,
    });
    if (rows.length >= 6) break;
  }
  return rows;
}

export class MonitorService {
  private readonly cpuBaseline = new Map<string, CpuBaseline>();
  private readonly netBaseline = new Map<string, NetBaseline>();

  constructor(
    private readonly deps: RemoteDeps,
    private readonly pool: RemotePool,
  ) {}

  async sample(profileId: string): Promise<HostMetrics> {
    const raw = await this.pool.with(profileId, (client: Client) =>
      execOnce(client, SAMPLE_COMMAND, SAMPLE_TIMEOUT_MS),
    );
    return this.parse(profileId, raw);
  }

  private parse(profileId: string, output: string): HostMetrics {
    const now = Date.now();
    const metrics: HostMetrics = {
      sampledAt: now,
      os: null,
      hostname: null,
      kernel: null,
      arch: null,
      timezone: null,
      cpuModel: null,
      cores: null,
      cpu: null,
      load: null,
      uptimeSec: null,
      users: null,
      memTotal: 0,
      memUsed: 0,
      swapTotal: 0,
      swapUsed: 0,
      diskTotal: 0,
      diskUsed: 0,
      disks: [],
      addresses: [],
      dns: [],
      gateway: null,
      processes: [],
      rxBytes: 0,
      txBytes: 0,
      rxRate: 0,
      txRate: 0,
      unsupported: false,
    };

    const stat = section(output, 'stat');
    const stat2 = section(output, 'stat2');
    const first = parseCpuTotal(stat);
    const second = parseCpuTotal(stat2);
    const previous = this.cpuBaseline.get(profileId);
    const from = first ?? previous;
    const to = second ?? first;
    if (from && to && to.total > from.total) {
      const totalDelta = to.total - from.total;
      const idleDelta = to.idle - from.idle;
      metrics.cpu = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
    }
    const latest = to ?? from;
    if (latest) this.cpuBaseline.set(profileId, latest);

    const mem = section(output, 'mem');
    if (mem) {
      const values = new Map<string, number>();
      for (const line of mem.split('\n')) {
        const match = /^(\w+):\s+(\d+)/.exec(line.trim());
        if (match) values.set(match[1], Number(match[2]) * 1024);
      }
      const total = values.get('MemTotal') ?? 0;
      const available = values.get('MemAvailable') ?? 0;
      metrics.memTotal = total;
      metrics.memUsed = Math.max(0, total - available);
      metrics.swapTotal = values.get('SwapTotal') ?? 0;
      metrics.swapUsed = Math.max(0, (values.get('SwapTotal') ?? 0) - (values.get('SwapFree') ?? 0));
    }

    metrics.disks = parseDisks(section(output, 'disks'));
    const root = metrics.disks.find((disk) => disk.mount === '/') ?? metrics.disks[0];
    if (root) {
      metrics.diskTotal = root.total;
      metrics.diskUsed = root.used;
    }

    const load = section(output, 'load').trim().split(/\s+/).slice(0, 3).map(toNumber);
    if (load.length === 3 && load.every((value) => Number.isFinite(value))) {
      metrics.load = [load[0], load[1], load[2]];
    }

    const uptime = toNumber(section(output, 'uptime').trim().split(/\s+/)[0]);
    if (uptime > 0) metrics.uptimeSec = uptime;

    const cores = toNumber(section(output, 'cores').trim().split(/\s+/)[0]);
    if (cores > 0) metrics.cores = cores;

    const netA = parseNet(section(output, 'net'));
    const netB = parseNet(section(output, 'net2'));
    const latestNet = netB.rx || netB.tx ? netB : netA;
    metrics.rxBytes = latestNet.rx;
    metrics.txBytes = latestNet.tx;

    const t1 = toNumber(section(output, 't1'));
    const t2 = toNumber(section(output, 't2'));
    if (latestNet === netB && t2 > t1) {
      const seconds = (t2 - t1) / 1000;
      metrics.rxRate = Math.max(0, (netB.rx - netA.rx) / seconds);
      metrics.txRate = Math.max(0, (netB.tx - netA.tx) / seconds);
    } else {
      const previousNet = this.netBaseline.get(profileId);
      if (previousNet && now > previousNet.at) {
        const seconds = (now - previousNet.at) / 1000;
        metrics.rxRate = Math.max(0, (latestNet.rx - previousNet.rx) / seconds);
        metrics.txRate = Math.max(0, (latestNet.tx - previousNet.tx) / seconds);
      }
    }
    this.netBaseline.set(profileId, { rx: latestNet.rx, tx: latestNet.tx, at: now });

    const os = section(output, 'os');
    if (os) metrics.os = os.replace(/^PRETTY_NAME=/, '').replace(/^"|"$/g, '');

    const cpuInfo = section(output, 'cpuinfo');
    if (cpuInfo) {
      const model = cpuInfo.split(':').slice(1).join(':').trim();
      if (model) metrics.cpuModel = model;
    }

    /* uname -s / -r / -m / hostname / 时区，按固定顺序逐行输出 */
    const info = section(output, 'info')
      .split('\n')
      .map((line) => line.trim());
    if (info.length >= 4) {
      const [system, kernel, arch, hostname] = info;
      if (kernel) metrics.kernel = `${kernel}${system ? ` (${system})` : ''}`;
      if (arch && arch !== 'unknown') metrics.arch = arch;
      if (hostname) metrics.hostname = hostname;
      if (info[4]) metrics.timezone = info[4];
    }

    metrics.addresses = parseAddresses(section(output, 'addr'));

    metrics.dns = section(output, 'dns')
      .split('\n')
      .map((line) => /nameserver\s+(\S+)/.exec(line)?.[1] ?? '')
      .filter(Boolean);

    const route = /default\s+via\s+(\S+)/.exec(section(output, 'route'));
    if (route) metrics.gateway = route[1];

    metrics.processes = parseProcesses(section(output, 'proc'));

    const users = toNumber(section(output, 'users').trim().split(/\s+/)[0]);
    if (users >= 0) metrics.users = users;

    metrics.unsupported = metrics.memTotal === 0 && metrics.cpu === null && metrics.diskTotal === 0;
    if (metrics.unsupported) {
      log.warn('remote does not expose /proc metrics', { profileId });
    }
    return metrics;
  }
}
