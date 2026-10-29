import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../store/AppStore';
import { FilesBrowser } from './FilesBrowser';
import { MonitorView } from './MonitorView';
import { Icon } from './ui/Icon';
import './SideDock.css';

const MIN_WIDTH = 260;
const MAX_WIDTH = 620;
const DEFAULT_WIDTH = 332;

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));

type Props = {
  side: 'files' | 'monitor';
};

/**
 * 侧边常驻面板：文件传输贴左侧、主机状态贴右侧。
 * 两侧各有一根拖拽条（贴终端那侧），双击恢复默认宽度。
 */
export function SideDock({ side }: Props) {
  const { state, actions } = useApp();
  const { sessions, activeSessionId, hosts, ui, settings } = state;
  const session = sessions.find((item) => item.id === activeSessionId) ?? null;
  const host = session ? hosts.find((item) => item.id === session.hostId) ?? null : null;
  const open = side === 'files' ? ui.dockFiles : ui.dockMonitor;

  const [width, setWidth] = useState(() => clamp(settings.dockWidth || DEFAULT_WIDTH));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setWidth(clamp(settings.dockWidth || DEFAULT_WIDTH));
  }, [settings.dockWidth]);

  if (!host || !open) return null;

  const isFiles = side === 'files';
  const title = isFiles ? '文件传输' : '主机状态';

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    setWidth(clamp(isFiles ? drag.startWidth + delta : drag.startWidth - delta));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    actions.updateSettings({ dockWidth: width });
  };

  return (
    <aside
      className="sidedock"
      data-side={side}
      style={{ width }}
      aria-label={title}
    >
      <div
        className="sidedock__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整${title}宽度`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          actions.updateSettings({ dockWidth: DEFAULT_WIDTH });
        }}
      />

      <div className="sidedock__head">
        <span className="sidedock__title-wrap">
          <Icon name={isFiles ? 'folder' : 'monitor'} size={13} />
          <span className="sidedock__title">{title}</span>
        </span>
        <button
          type="button"
          className="sidedock__close"
          aria-label={`关闭${title}`}
          title="关闭"
          onClick={() => (isFiles ? actions.closeDockFiles() : actions.closeDockMonitor())}
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="sidedock__body">
        {isFiles ? <FilesBrowser host={host} /> : <MonitorView host={host} />}
      </div>
    </aside>
  );
}
