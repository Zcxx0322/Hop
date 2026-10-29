import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useApp } from '../store/AppStore';
import { LogoMark } from './ui/Logo';
import { Icon } from './ui/Icon';
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

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeHost = activeSession
    ? (state.hosts.find((host) => host.id === activeSession.hostId) ?? null)
    : null;
  const busy = activeSession?.status === 'connecting' || activeSession?.status === 'reconnecting';

  const reconnect = useCallback(() => {
    if (!activeSession) return;
    actions.updateSession(activeSession.id, {
      status: 'connecting',
      detail: undefined,
      reconnectNonce: (activeSession.reconnectNonce ?? 0) + 1,
    });
  }, [actions, activeSession]);

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

  /* 双击标题栏空白处 = 最大化 / 还原；双击标签、按钮时不要误触发 */
  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!bridge) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, select, textarea, [role="tab"]')) return;
      bridge.toggleMaximize();
    },
    [bridge],
  );

  return (
    <header className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar__brand">
        <LogoMark size={18} />
        <span className="titlebar__name">Hop</span>
        <nav className="titlebar__nav no-drag" aria-label="主导航">
          <button
            type="button"
            className="titlebar__nav-btn"
            data-on={state.ui.page === 'terminal'}
            aria-pressed={state.ui.page === 'terminal'}
            onClick={() => actions.setPage('terminal')}
          >
            <Icon name="terminal" size={13} />
            终端
          </button>
          <button
            type="button"
            className="titlebar__nav-btn"
            data-on={state.ui.page === 'assets'}
            aria-pressed={state.ui.page === 'assets'}
            onClick={() => actions.setPage('assets')}
          >
            <Icon name="server" size={13} />
            资产
          </button>
          <button
            type="button"
            className="titlebar__nav-btn"
            data-on={state.ui.page === 'notes'}
            aria-pressed={state.ui.page === 'notes'}
            title="笔记（Ctrl+Shift+N）"
            onClick={() => actions.setPage('notes')}
          >
            <Icon name="pencil" size={13} />
            笔记
          </button>
        </nav>
      </div>

      <div className="titlebar__tabs">
        {sessions.length > 0 && (
          <TabBar sessions={sessions} activeSessionId={activeSessionId} />
        )}
      </div>

      <div className="titlebar__actions no-drag">
        {activeSession && (
          <>
            <button
              type="button"
              className="titlebar__ghost"
              data-on={state.ui.dockFiles}
              aria-pressed={state.ui.dockFiles}
              aria-label="切换文件传输面板"
              title="文件传输（Ctrl+Shift+F）"
              onClick={actions.toggleDockFiles}
            >
              <Icon name="folder" size={14} />
            </button>
            <button
              type="button"
              className="titlebar__ghost"
              data-on={state.ui.dockMonitor}
              aria-pressed={state.ui.dockMonitor}
              aria-label="切换主机状态面板"
              title="主机状态（Ctrl+Shift+M）"
              onClick={actions.toggleDockMonitor}
            >
              <Icon name="monitor" size={14} />
            </button>
            <button
              type="button"
              className="titlebar__ghost"
              aria-label="打开笔记"
              title="笔记（Ctrl+Shift+N）"
              onClick={() => actions.setPage('notes')}
            >
              <Icon name="pencil" size={14} />
            </button>
            <button
              type="button"
              className="titlebar__ghost"
              disabled={busy || !activeHost}
              aria-label="重新连接"
              title={activeHost ? '重新连接' : '主机已被删除'}
              onClick={reconnect}
            >
              <Icon name="refresh" size={14} />
            </button>
            <span className="titlebar__divider" aria-hidden="true" />
          </>
        )}
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
