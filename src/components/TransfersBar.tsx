import { useEffect, useRef, useState } from 'react';
import { clearTransfers } from '../api/workspace';
import { useTransfers } from '../store/transfers';
import { Icon } from './ui/Icon';
import './TransfersBar.css';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return `${Math.max(1, Math.round(seconds))} 秒`;
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function TransfersBar() {
  const transfers = useTransfers();
  const [hidden, setHidden] = useState(false);
  const seen = useRef(new Set<string>());

  /* 有新传输时如果之前被手动关掉，自动重新出现 */
  useEffect(() => {
    let appeared = false;
    for (const row of transfers) {
      if (!seen.current.has(row.id)) {
        seen.current.add(row.id);
        appeared = true;
      }
    }
    if (appeared) setHidden(false);
  }, [transfers]);

  if (hidden || transfers.length === 0) return null;

  const activeCount = transfers.filter((row) => row.status === 'active').length;

  return (
    <section className="transfersbar" aria-label="传输进度">
      <header className="transfersbar__head">
        <span className="transfersbar__title">
          <Icon name="upload" size={13} />
          传输
          {activeCount > 0 && <span className="transfersbar__badge">{activeCount}</span>}
        </span>
        <button
          type="button"
          className="transfersbar__link"
          onClick={() => void clearTransfers()}
        >
          清空记录
        </button>
      </header>

      <div className="transfersbar__list">
        {transfers.map((transfer) => {
          const active = transfer.status === 'active';
          const percent = active
            ? transfer.total > 0
              ? Math.min(100, Math.round((transfer.transferred / transfer.total) * 100))
              : 0
            : transfer.status === 'done'
              ? 100
              : 0;
          const endAt = transfer.finishedAt ?? Date.now();
          const seconds = Math.max(0.4, (endAt - transfer.startedAt) / 1000);
          const speed = transfer.transferred / seconds;
          const remain =
            active && speed > 0 && transfer.total > 0
              ? Math.max(0, Math.round((transfer.total - transfer.transferred) / speed))
              : null;

          return (
            <article key={transfer.id} className="xfer" data-status={transfer.status}>
              <span className="xfer__icon" data-dir={transfer.direction}>
                <Icon name={transfer.direction === 'upload' ? 'arrow-up' : 'download'} size={13} />
              </span>
              <div className="xfer__body">
                <div className="xfer__top">
                  <span className="xfer__name truncate" title={transfer.name}>
                    {transfer.name}
                  </span>
                  <span className="xfer__state">
                    {active ? `${percent}%` : transfer.status === 'done' ? '完成' : '失败'}
                  </span>
                </div>
                <div
                  className="xfer__track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label={`${transfer.name} 传输进度`}
                >
                  <span className="xfer__fill" style={{ width: `${percent}%` }} />
                </div>
                <div className="xfer__meta">
                  <span className="mono">
                    {formatBytes(transfer.transferred)}
                    {transfer.total > 0 ? ` / ${formatBytes(transfer.total)}` : ''}
                  </span>
                  <span className="xfer__speed mono">
                    {active ? `${formatBytes(speed)}/s` : transfer.direction === 'upload' ? '已上传' : '已下载'}
                  </span>
                  <span className="xfer__eta">
                    {active
                      ? remain === null
                        ? '计算中…'
                        : remain > 0
                          ? `剩余 ${formatDuration(remain)}`
                          : '即将完成'
                      : formatDuration(Math.round(seconds))}
                  </span>
                </div>
              </div>
              {transfer.status === 'error' && transfer.error && (
                <p className="xfer__error" title={transfer.error}>
                  {transfer.error}
                </p>
              )}
            </article>
          );
        })}
      </div>

      <button
        type="button"
        className="transfersbar__close"
        aria-label="关闭传输面板"
        title="关闭"
        onClick={() => setHidden(true)}
      >
        <Icon name="x" size={14} />
      </button>
    </section>
  );
}
