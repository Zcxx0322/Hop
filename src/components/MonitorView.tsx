import { useCallback, useEffect, useState } from 'react';
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

interface MonitorViewProps {
  host: Host;
}

/**
 * 主机状态主体（不含外框），与文件面板一起常驻在右侧停靠区。
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
          <div className="monitor__host">
            <span className="monitor__os" title={metrics.os ?? undefined}>
              <Icon name="server" size={13} />{' '}
              {metrics.os ?? (metrics.unsupported ? '未知系统' : 'Linux')}
            </span>
            {metrics.kernel && (
              <span className="monitor__chip mono" title={`内核 ${metrics.kernel}`}>
                {metrics.kernel}
              </span>
            )}
            <span className="monitor__chip">
              <Icon name="cpu" size={12} /> {metrics.cores ? `${metrics.cores} 核` : '核心数未知'}
            </span>
            <span className="monitor__chip">
              <Icon name="clock" size={12} /> {formatUptime(metrics.uptimeSec)}
            </span>
          </div>

          {metrics.unsupported && (
            <p className="monitor__note">
              远端没有 <code>/proc</code>（例如 BSD 或 Windows 主机），只能显示连接状态。
            </p>
          )}

          <section className="monitor__card monitor__card--cpu">
            <header className="monitor__card-head">
              <span className="monitor__card-title">CPU</span>
              <span className="monitor__card-value mono">
                {cpu === null ? '采样中' : `${Math.round(cpu)}%`}
              </span>
            </header>
            <div className="monitor__bar" data-tone={cpu === null ? 'ok' : toneFor(cpu)}>
              <span style={{ width: `${cpu ?? 0}%` }} />
            </div>
            <div className="monitor__load">
              <span>负载</span>
              <span className="mono">
                {metrics.load ? metrics.load.map((value) => value.toFixed(2)).join('  ') : '—'}
              </span>
            </div>
            {cpuModel && (
              <div className="monitor__load">
                <span>型号</span>
                <span className="monitor__ellipsis" title={metrics.cpuModel ?? undefined}>
                  {cpuModel}
                </span>
              </div>
            )}
          </section>

          <section className="monitor__card">
            <header className="monitor__card-head">
              <span className="monitor__card-title">内存</span>
              <span className="monitor__card-value mono">
                {formatBytes(metrics.memUsed)} / {formatBytes(metrics.memTotal)}
              </span>
            </header>
            <div className="monitor__bar" data-tone={toneFor(memPercent)}>
              <span style={{ width: `${memPercent}%` }} />
            </div>
            {metrics.swapTotal > 0 && (
              <>
                <div className="monitor__load">
                  <span>交换分区</span>
                  <span className="mono">
                    {formatBytes(metrics.swapUsed)} / {formatBytes(metrics.swapTotal)}
                  </span>
                </div>
                <div className="monitor__bar monitor__bar--thin" data-tone={toneFor(swapPercent)}>
                  <span style={{ width: `${swapPercent}%` }} />
                </div>
              </>
            )}
          </section>

          <section className="monitor__card">
            <header className="monitor__card-head">
              <span className="monitor__card-title">
                <Icon name="hard-drive" size={12} /> 磁盘
              </span>
              <span className="monitor__card-value mono">
                {formatBytes(metrics.diskUsed)} / {formatBytes(metrics.diskTotal)}
              </span>
            </header>
            {metrics.disks.length === 0 ? (
              <div className="monitor__load">
                <span>未识别到挂载点</span>
              </div>
            ) : (
              <ul className="monitor__list">
                {metrics.disks.map((disk) => {
                  const used = percent(disk.used, disk.total);
                  return (
                    <li key={disk.mount} className="monitor__mount">
                      <div className="monitor__mount-head">
                        <span className="monitor__ellipsis mono" title={`${disk.filesystem} → ${disk.mount}`}>
                          {disk.mount}
                        </span>
                        <span className="mono">
                          {formatBytes(disk.used)} / {formatBytes(disk.total)}
                        </span>
                      </div>
                      <div className="monitor__bar monitor__bar--thin" data-tone={toneFor(used)}>
                        <span style={{ width: `${used}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="monitor__card">
            <header className="monitor__card-head">
              <span className="monitor__card-title">
                <Icon name="network" size={12} /> 网络
              </span>
              <span className="monitor__card-value mono">
                ↑ {formatRate(metrics.txRate)} · ↓ {formatRate(metrics.rxRate)}
              </span>
            </header>
            {metrics.addresses.length > 0 ? (
              <ul className="monitor__list">
                {metrics.addresses.map((item) => (
                  <li key={`${item.iface}-${item.address}`} className="monitor__kv">
                    <span className="monitor__key mono">{item.iface}</span>
                    <span className="monitor__val mono">{item.address}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="monitor__load">
                <span>未识别到 IP 地址</span>
              </div>
            )}
            <div className="monitor__kv">
              <span className="monitor__key">网关</span>
              <span className="monitor__val mono">{metrics.gateway ?? '—'}</span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">DNS</span>
              <span className="monitor__val mono">
                {metrics.dns.length > 0 ? metrics.dns.join('  ') : '—'}
              </span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">累计</span>
              <span className="monitor__val mono">
                ↑ {formatBytes(metrics.txBytes)} · ↓ {formatBytes(metrics.rxBytes)}
              </span>
            </div>
          </section>

          <section className="monitor__card">
            <header className="monitor__card-head">
              <span className="monitor__card-title">系统信息</span>
              {metrics.users !== null && (
                <span className="monitor__card-value">{metrics.users} 个登录</span>
              )}
            </header>
            <div className="monitor__kv">
              <span className="monitor__key">主机名</span>
              <span className="monitor__val mono">{metrics.hostname ?? '—'}</span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">内核</span>
              <span className="monitor__val mono">{metrics.kernel ?? '—'}</span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">架构</span>
              <span className="monitor__val mono">{metrics.arch ?? '—'}</span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">时区</span>
              <span className="monitor__val mono">{metrics.timezone ?? '—'}</span>
            </div>
            <div className="monitor__kv">
              <span className="monitor__key">运行时长</span>
              <span className="monitor__val">{formatUptime(metrics.uptimeSec)}</span>
            </div>
          </section>

          {metrics.processes.length > 0 && (
            <section className="monitor__card">
              <header className="monitor__card-head">
                <span className="monitor__card-title">占用最高的进程</span>
                <span className="monitor__card-value">CPU %</span>
              </header>
              <table className="monitor__table">
                <thead>
                  <tr>
                    <th scope="col">进程</th>
                    <th scope="col">PID</th>
                    <th scope="col">CPU</th>
                    <th scope="col">内存</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.processes.map((proc) => (
                    <tr key={proc.pid}>
                      <td className="monitor__ellipsis" title={proc.name}>
                        {proc.name}
                      </td>
                      <td className="mono">{proc.pid}</td>
                      <td className="mono">{proc.cpu.toFixed(1)}</td>
                      <td className="mono">{proc.mem.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

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
