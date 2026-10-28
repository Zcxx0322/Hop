import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppStore';
import { FilesBrowser } from './FilesBrowser';
import { MonitorView } from './MonitorView';
import { Icon } from './ui/Icon';
import './Dock.css';

const MIN_WIDTH = 280;
const MAX_WIDTH = 620;

/**
 * 右侧常驻区：文件传输 + 主机状态，各自可关闭，整体宽度可拖拽并持久化。
 */
export function Dock() {
  const { state, actions } = useApp();
  const { sessions, activeSessionId, hosts, ui, settings } = state;

  const session = sessions.find((item) => item.id === activeSessionId) ?? null;
  const host = session ? hosts.find((item) => item.id === session.hostId) ?? null : null;

  const open = Boolean(host) && (ui.dockFiles || ui.dockMonitor);
  const [width, setWidth] = useState(settings.dockWidth);
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  /* 设置里改过宽度（或恢复默认）时同步到本地状态 */
  useEffect(() => {
    setWidth(settings.dockWidth);
  }, [settings.dockWidth]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = { startX: event.clientX, startWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + (drag.startX - event.clientX)));
    setWidth(next);
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      actions.updateSettings({ dockWidth: Math.round(width) });
    },
    [actions, width],
  );

  if (!open || !host) return null;

  const both = ui.dockFiles && ui.dockMonitor;

  return (
    <aside
      className="dock"
      style={{ width }}
      data-stacked={both}
      aria-label="文件传输与主机状态"
    >
      <div
        className="dock__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => actions.updateSettings({ dockWidth: 372 })}
      />

      {ui.dockFiles && (
        <section className="dock__section dock__section--files" aria-label="文件传输">
          <header className="dock__head">
            <span className="dock__title">
              <Icon name="folder" size={13} /> 文件传输
            </span>
            <span className="dock__host truncate" title={`${host.username}@${host.host}`}>
              {host.name}
            </span>
            <button
              type="button"
              className="dock__close"
              onClick={actions.closeDockFiles}
              title="关闭文件传输"
              aria-label="关闭文件传输"
            >
              <Icon name="x" size={13} />
            </button>
          </header>
          <div className="dock__body">
            <FilesBrowser host={host} />
          </div>
        </section>
      )}

      {ui.dockMonitor && (
        <section className="dock__section dock__section--monitor" aria-label="主机状态">
          <header className="dock__head">
            <span className="dock__title">
              <Icon name="monitor" size={13} /> 主机状态
            </span>
            <span className="dock__host truncate" title={`${host.username}@${host.host}`}>
              {host.name}
            </span>
            <button
              type="button"
              className="dock__close"
              onClick={actions.closeDockMonitor}
              title="关闭主机状态"
              aria-label="关闭主机状态"
            >
              <Icon name="x" size={13} />
            </button>
          </header>
          <div className="dock__body">
            <MonitorView host={host} />
          </div>
        </section>
      )}
    </aside>
  );
}
