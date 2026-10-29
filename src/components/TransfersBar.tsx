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

function formatRemain(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '即将完成';
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时`;
}

/**
 * 传输进度条：贴着工作区底部的单行窄条。
 * 每条传输只占一行（图标 / 文件名 / 百分比 + 速度 + 剩余），底部一条 2px 进度线。
 */
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
      <div className="transfersbar__rail">
        <span className="transfersbar__label" title="清空传输记录">
          <Icon name="upload" size={13} />
          <span>传输</span>
          {activeCount > 0 && <span className="transfersbar__badge">{activeCount}</span>}
        </span>

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
                ? Math.max(0, (transfer.total - transfer.transferred) / speed)
                : null;

            return (
              <article
                key={transfer.id}
                className="xfer"
                data-status={transfer.status}
                title={transfer.status === 'error' ? transfer.error ?? transfer.name : transfer.name}
              >
                <span className="xfer__icon" data-dir={transfer.direction}>
                  <Icon name={transfer.direction === 'upload' ? 'arrow-up' : 'download'} size={12} />
                </span>
                <span className="xfer__name truncate">{transfer.name}</span>
                <span className="xfer__meta mono truncate">
                  {active
                    ? `${percent}% · ${formatBytes(speed)}/s · ${remain === null ? '—' : formatRemain(remain)}`
                    : transfer.status === 'done'
                      ? `${formatBytes(transfer.total || transfer.transferred)} · 完成`
                      : `失败 · ${transfer.error ?? '未知原因'}`}
                </span>
                <span
                  className="xfer__track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label={`${transfer.name} 传输进度`}
                >
                  <span className="xfer__fill" style={{ width: `${percent}%` }} />
                </span>
              </article>
            );
          })}
        </div>

        <button
          type="button"
          className="transfersbar__link"
          onClick={() => void clearTransfers()}
          title="清空记录"
        >
          清空
        </button>
        <button
          type="button"
          className="transfersbar__close"
          aria-label="收起传输面板"
          title="收起"
          onClick={() => setHidden(true)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </section>
  );
}
