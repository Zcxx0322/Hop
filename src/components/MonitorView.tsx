import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Host } from '../types';
import { sampleHost, type HostMetrics } from '../api/workspace';
import './MonitorPanel.css';
import { errorMessage } from '../lib/utils';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';

const REFRESH_MS = 3000;

function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(digits)} ${units[unit]}`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatUptime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

function toneFor(value: number): 'ok' | 'warn' | 'hot' {
  if (value >= 88) return 'hot';
  if (value >= 70) return 'warn';
  return 'ok';
}

/** CPU 型号太长，去掉常见的冗余前缀/频率段，保留可辨识部分 */
function shortCpuModel(model: string | null): string | null {
  if (!model) return null;
  return model
    .replace(/\s+(CPU|Processor)\b/gi, '')
    .replace(/\s+@.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface RowProps {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  title?: string;
  /** 0–100：有值时在该行下方画一条进度条 */
  bar?: number;
  tone?: 'ok' | 'warn' | 'hot';
}

/** 一行一个信息：左边名称，右边数值，进度条独占下一行 */
function Row({ label, value, mono, title, bar, tone }: RowProps) {
  /* 带进度条的量单独成块：上面一行「名称 — 数值」，下面一条细进度条，
     避免进度条和文字挤在同一行里互相干扰。 */
  if (bar !== undefined) {
    return (
      <div className="monitor__meter">
        <div className="monitor__line">
          <span className="monitor__label">{label}</span>
          <span className={`monitor__value${mono ? ' mono' : ''}`} title={title}>
            {value}
          </span>
        </div>
        <div className="monitor__bar" data-tone={tone ?? toneFor(bar)}>
          <span style={{ width: `${bar}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="monitor__row">
      <span className="monitor__label">{label}</span>
      <span className={`monitor__value${mono ? ' mono' : ''}`} title={title}>
        {value}
      </span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="monitor__group">
      <h3 className="monitor__group-title">{title}</h3>
      {children}
    </section>
  );
}

interface MonitorViewProps {
  host: Host;
}

/**
 * 主机状态主体（不含外框），与文件面板一起常驻在右侧停靠区。
 * 所有信息自上而下逐行排列，每行只放一项。
 */
export function MonitorView({ host }: MonitorViewProps) {
  const hostId = host.id;
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tick = useCallback(
    async (showSpinner: boolean) => {
      if (!hostId) return;
      if (showSpinner) setLoading(true);
      try {
        const next = await sampleHost(hostId);
        setMetrics(next);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, '读取主机状态失败'));
      } finally {
        setLoading(false);
      }
    },
    [hostId],
  );

  /* 面板可见时每 3 秒采样一次，关闭立即停止 */
  useEffect(() => {
    setMetrics(null);
    setError(null);
    void tick(true);
    const timer = window.setInterval(() => void tick(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hostId, tick]);

  const cpu = metrics?.cpu ?? null;
  const memPercent = metrics ? percent(metrics.memUsed, metrics.memTotal) : 0;
  const swapPercent = metrics ? percent(metrics.swapUsed, metrics.swapTotal) : 0;
  const cpuModel = shortCpuModel(metrics?.cpuModel ?? null);

  return (
    <div className="monitor">
      <div className="monitor__scroll">
        {error && (
          <div className="monitor__error" role="alert">
            <Icon name="alert" size={13} /> {error}
          </div>
        )}

        {!metrics && !error && (
          <div className="monitor__loading">
            <Spinner size={16} /> 正在采样…
          </div>
        )}

        {metrics && (
          <>
          {metrics.unsupported && (
            <p className="monitor__note">
              远端没有 <code>/proc</code>（例如 BSD 或 Windows 主机），只能显示连接状态。
            </p>
          )}

          <Group title="系统">
            <Row
              label="发行版"
              value={metrics.os ?? (metrics.unsupported ? '未知系统' : 'Linux')}
              title={metrics.os ?? undefined}
            />
            <Row label="内核" value={metrics.kernel ?? '—'} mono />
            <Row label="架构" value={metrics.arch ?? '—'} mono />
            <Row label="主机名" value={metrics.hostname ?? '—'} mono />
            <Row label="时区" value={metrics.timezone ?? '—'} />
            <Row label="运行时长" value={formatUptime(metrics.uptimeSec)} />
            <Row label="登录用户" value={metrics.users === null ? '—' : `${metrics.users} 个`} />
            <Row label="核心数" value={metrics.cores ? `${metrics.cores} 核` : '—'} />
          </Group>

          <Group title="CPU">
            <Row
              label="使用率"
              value={cpu === null ? '采样中' : `${Math.round(cpu)}%`}
              mono
              bar={cpu ?? 0}
              tone={cpu === null ? 'ok' : toneFor(cpu)}
            />
            <Row
              label="负载"
              value={
                metrics.load
                  ? metrics.load.map((value) => value.toFixed(2)).join(' · ')
                  : '—'
              }
              mono
            />
            {cpuModel && (
              <Row label="型号" value={cpuModel} title={metrics.cpuModel ?? undefined} />
            )}
          </Group>

          <Group title="内存">
            <Row
              label="已用"
              value={`${formatBytes(metrics.memUsed)} / ${formatBytes(metrics.memTotal)}`}
              mono
              bar={memPercent}
            />
            <Row
              label="交换分区"
              value={
                metrics.swapTotal > 0
                  ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                  : '未启用'
              }
              mono
              bar={metrics.swapTotal > 0 ? swapPercent : undefined}
            />
          </Group>

          <Group title="磁盘">
            {metrics.disks.length === 0 ? (
              <Row label="挂载点" value="未识别到" />
            ) : (
              metrics.disks.map((disk) => {
                const used = percent(disk.used, disk.total);
                return (
                  <Row
                    key={disk.mount}
                    label={disk.mount}
                    title={`${disk.filesystem} → ${disk.mount}`}
                    value={`${formatBytes(disk.used)} / ${formatBytes(disk.total)}（${used}%）`}
                    mono
                    bar={used}
                  />
                );
              })
            )}
          </Group>

          <Group title="网络">
            <Row label="上行" value={formatRate(metrics.txRate)} mono />
            <Row label="下行" value={formatRate(metrics.rxRate)} mono />
            <Row
              label="累计"
              value={`↑ ${formatBytes(metrics.txBytes)} · ↓ ${formatBytes(metrics.rxBytes)}`}
              mono
            />
            {metrics.addresses.length > 0 ? (
              metrics.addresses.map((item) => (
                <Row
                  key={`${item.iface}-${item.address}`}
                  label={item.iface}
                  value={item.address}
                  mono
                />
              ))
            ) : (
              <Row label="网卡" value="未识别到 IP 地址" />
            )}
            <Row label="网关" value={metrics.gateway ?? '—'} mono />
            <Row label="DNS" value={metrics.dns.length > 0 ? metrics.dns.join(' · ') : '—'} mono />
          </Group>

          {metrics.processes.length > 0 && (
            <Group title="占用最高的进程">
              <div className="monitor__proc-head">
                <span>进程</span>
                <span>CPU</span>
                <span>内存</span>
              </div>
              {metrics.processes.map((proc) => (
                <div className="monitor__proc" key={proc.pid}>
                  <span className="monitor__proc-name" title={`${proc.name} (PID ${proc.pid})`}>
                    {proc.name}
                  </span>
                  <span className="mono">{proc.cpu.toFixed(1)}%</span>
                  <span className="mono">{proc.mem.toFixed(1)}%</span>
                </div>
              ))}
            </Group>
          )}
          </>
        )}
      </div>

      <footer className="monitor__footer">
        <span className="monitor__footer-note">
          <Icon name="clock" size={12} />
          {metrics
            ? `采样于 ${new Date(metrics.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })}`
            : `每 ${REFRESH_MS / 1000} 秒刷新`}
        </span>
        <button
          type="button"
          className="monitor__refresh"
          disabled={loading}
          onClick={() => void tick(true)}
        >
          {loading ? <Spinner size={12} /> : <Icon name="refresh" size={13} />} 刷新
        </button>
      </footer>
    </div>
  );
}
