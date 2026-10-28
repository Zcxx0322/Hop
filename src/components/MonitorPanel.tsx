import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store/AppStore';
import { sampleHost, type HostMetrics } from '../api/workspace';
import { errorMessage } from '../lib/utils';
import { Icon } from './ui/Icon';
import { Modal } from './ui/Modal';
import { Spinner } from './ui/Spinner';
import './MonitorPanel.css';

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

export function MonitorPanel() {
  const { state, actions } = useApp();
  const hostId = state.ui.monitorHostId;
  const host = state.hosts.find((item) => item.id === hostId) ?? null;

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

  /* 面板打开时每 3 秒采样一次，关闭立即停止 */
  useEffect(() => {
    if (!hostId) return;
    setMetrics(null);
    setError(null);
    void tick(true);
    const timer = window.setInterval(() => void tick(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hostId, tick]);

  if (!hostId) return null;

  const cpu = metrics?.cpu ?? null;
  const memPercent = metrics ? percent(metrics.memUsed, metrics.memTotal) : 0;
  const swapPercent = metrics ? percent(metrics.swapUsed, metrics.swapTotal) : 0;
  const diskPercent = metrics ? percent(metrics.diskUsed, metrics.diskTotal) : 0;

  return (
    <Modal
      open
      onClose={actions.closeMonitor}
      title={`主机状态 · ${host?.name ?? '主机'}`}
      description={host ? `${host.username}@${host.host}:${host.port}` : undefined}
      size="xl"
      variant="drawer"
      footer={
        <div className="monitor__footer">
          <span className="monitor__footer-note">
            <Icon name="clock" size={12} /> 每 {REFRESH_MS / 1000} 秒刷新
          </span>
          <button
            type="button"
            className="monitor__refresh"
            disabled={loading}
            onClick={() => void tick(true)}
          >
            {loading ? <Spinner size={12} /> : <Icon name="refresh" size={13} />} 立即刷新
          </button>
        </div>
      }
    >
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
              <span className="monitor__os">
                <Icon name="server" size={13} /> {metrics.os ?? (metrics.unsupported ? '未知系统' : 'Linux')}
              </span>
              <span className="monitor__chip">
                <Icon name="cpu" size={12} /> {metrics.cores ? `${metrics.cores} 核` : '核心数未知'}
              </span>
              <span className="monitor__chip">
                <Icon name="clock" size={12} /> 已运行 {formatUptime(metrics.uptimeSec)}
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
                  {metrics.load
                    ? metrics.load.map((value) => value.toFixed(2)).join('  ')
                    : '—'}
                </span>
              </div>
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
                  <Icon name="hard-drive" size={12} /> 磁盘 /
                </span>
                <span className="monitor__card-value mono">
                  {formatBytes(metrics.diskUsed)} / {formatBytes(metrics.diskTotal)}
                </span>
              </header>
              <div className="monitor__bar" data-tone={toneFor(diskPercent)}>
                <span style={{ width: `${diskPercent}%` }} />
              </div>
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
              <div className="monitor__load">
                <span>累计</span>
                <span className="mono">
                  ↑ {formatBytes(metrics.txBytes)} · ↓ {formatBytes(metrics.rxBytes)}
                </span>
              </div>
            </section>

            <p className="monitor__stamp">
              采样于 {new Date(metrics.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
