import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store/AppStore';
import { LogoMark } from './ui/Logo';
import { TabBar } from './TabBar';
import './TitleBar.css';

interface HopWindowBridge {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(listener: (maximized: boolean) => void): () => void;
}

function windowBridge(): HopWindowBridge | null {
  const bridge = (window as unknown as { hop?: { window?: HopWindowBridge } }).hop?.window;
  return bridge ?? null;
}

/**
 * 无系统边框时自绘的标题栏：左侧品牌、中间会话标签、右侧窗口控制。
 * 整条标题栏是拖拽区，交互元素各自声明 no-drag。
 */
export function TitleBar() {
  const { state, actions } = useApp();
  const { sessions, activeSessionId } = state;
  const [bridge] = useState(windowBridge);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    const off = bridge.onMaximizeChange(setMaximized);
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const toggleMaximize = useCallback(() => bridge?.toggleMaximize(), [bridge]);

  return (
    <header className="titlebar" onDoubleClick={toggleMaximize}>
      <div className="titlebar__brand">
        <LogoMark size={18} />
        <span className="titlebar__name">Hop</span>
        <button
          type="button"
          className="titlebar__ghost no-drag"
          aria-label={state.settings.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          title="收起 / 展开侧栏"
          onClick={actions.toggleSidebar}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3v10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="titlebar__tabs">
        {sessions.length ? (
          <TabBar sessions={sessions} activeSessionId={activeSessionId} />
        ) : (
          <span className="titlebar__hint">SSH 工作台</span>
        )}
      </div>

      <div className="titlebar__actions no-drag">
        <button
          type="button"
          className="titlebar__ghost"
          aria-label="新建连接"
          title="新建连接 （Ctrl N）"
          onClick={() => actions.openHostForm(null)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {bridge && (
        <div className="wincontrols no-drag" aria-label="窗口控制">
          <button type="button" className="wincontrols__btn" aria-label="最小化" title="最小化" onClick={() => bridge.minimize()}>
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="wincontrols__btn"
            aria-label={maximized ? '向下还原' : '最大化'}
            title={maximized ? '向下还原' : '最大化'}
            onClick={toggleMaximize}
          >
            {maximized ? (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="2.4" y="3.4" width="6.2" height="6.2" rx="1" stroke="currentColor" strokeWidth="1.1" />
                <path d="M4.4 3.4V2.6a.6.6 0 0 1 .6-.6h4a.6.6 0 0 1 .6.6v4a.6.6 0 0 1-.6.6h-.8" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="wincontrols__btn wincontrols__btn--close"
            aria-label="关闭"
            title="关闭"
            onClick={() => bridge.close()}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
