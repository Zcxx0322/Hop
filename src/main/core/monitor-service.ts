import type { Client } from 'ssh2';
import { createLogger } from './logger';
import { execOnce, openRemote, type RemoteDeps, type RemoteHandle } from './remote';

const log = createLogger('monitor');

const IDLE_CLOSE_MS = 25_000;
const SAMPLE_TIMEOUT_MS = 7_000;

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
 * 一次采样只发一条命令：在远端完成所有 /proc 读取，宽带上限也就几百字节。
 * 所有分支都带 `2>/dev/null || true`，缺某个文件时不影响其它字段。
 */
const SAMPLE_COMMAND = [
  'LC_ALL=C',
  'echo "##t1"; date +%s%3N 2>/dev/null',
  'echo "##stat"; head -n1 /proc/stat 2>/dev/null',
  'echo "##net"; cat /proc/net/dev 2>/dev/null',
  'echo "##mem"; grep -E "^(MemTotal|MemAvailable|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null',
  'echo "##disk"; df -kP / 2>/dev/null | tail -n1',
  'echo "##load"; cat /proc/loadavg 2>/dev/null',
  'echo "##uptime"; cut -d" " -f1 /proc/uptime 2>/dev/null',
  'echo "##cores"; (nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null)',
  'echo "##os"; (grep "^PRETTY_NAME=" /etc/os-release 2>/dev/null | head -n1)',
  // 第二组快照：一次命令里取两个时间点，首次打开面板也能算出 CPU 占用与网速
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
  const next = after.search(/##[a-z]+/);
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

export class MonitorService {
  private readonly pool = new Map<string, { handle: RemoteHandle; timer: NodeJS.Timeout }>();
  private readonly cpuBaseline = new Map<string, CpuBaseline>();
  private readonly netBaseline = new Map<string, NetBaseline>();

  constructor(private readonly deps: RemoteDeps) {}

  async sample(profileId: string): Promise<HostMetrics> {
    const client = await this.acquire(profileId);
    const raw = await execOnce(client, SAMPLE_COMMAND, SAMPLE_TIMEOUT_MS);
    return this.parse(profileId, raw);
  }

  dispose(): void {
    for (const entry of this.pool.values()) {
      clearTimeout(entry.timer);
      entry.handle.close();
    }
    this.pool.clear();
    this.cpuBaseline.clear();
    this.netBaseline.clear();
  }

  private async acquire(profileId: string): Promise<Client> {
    const existing = this.pool.get(profileId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = this.idleTimer(profileId);
      return existing.handle.client;
    }
    const handle = await openRemote(this.deps, profileId);
    this.pool.set(profileId, { handle, timer: this.idleTimer(profileId) });
    return handle.client;
  }

  private idleTimer(profileId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const entry = this.pool.get(profileId);
      if (!entry) return;
      try {
        entry.handle.close();
      } catch {
        /* ignore */
      }
      this.pool.delete(profileId);
    }, IDLE_CLOSE_MS);
    timer.unref?.();
    return timer;
  }

  private parse(profileId: string, output: string): HostMetrics {
    const now = Date.now();
    const metrics: HostMetrics = {
      sampledAt: now,
      os: null,
      cores: null,
      cpu: null,
      load: null,
      uptimeSec: null,
      memTotal: 0,
      memUsed: 0,
      swapTotal: 0,
      swapUsed: 0,
      diskTotal: 0,
      diskUsed: 0,
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

    const disk = section(output, 'disk').split('\n').pop() ?? '';
    const diskParts = disk.trim().split(/\s+/);
    if (diskParts.length >= 3 && /^\d+$/.test(diskParts[1] ?? '')) {
      metrics.diskTotal = toNumber(diskParts[1]) * 1024;
      metrics.diskUsed = toNumber(diskParts[2]) * 1024;
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
    if (os) {
      metrics.os = os.replace(/^PRETTY_NAME=/, '').replace(/^"|"$/g, '');
    }

    metrics.unsupported = metrics.memTotal === 0 && metrics.cpu === null && metrics.diskTotal === 0;
    if (metrics.unsupported) {
      log.warn('remote does not expose /proc metrics', { profileId });
    }
    return metrics;
  }
}
