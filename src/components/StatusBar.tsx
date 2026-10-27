import { isMock } from '../api/config';
import { useApp } from '../store/AppStore';
import { modKey } from '../lib/utils';
import { Kbd } from './ui/Kbd';
import { StatusDot } from './ui/Spinner';
import './StatusBar.css';

const STATUS_TEXT = {
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  closed: '已断开',
  error: '连接失败',
} as const;

export function StatusBar() {
  const { state, actions } = useApp();
  const active = state.sessions.find((session) => session.id === state.activeSessionId) ?? null;

  return (
    <footer className="statusbar" aria-label="状态栏">
      <div className="statusbar__group">
        <span className="statusbar__state">
          <StatusDot
            tone={
              !active || active.status === 'closed'
                ? 'idle'
                : active.status === 'connected'
                  ? 'connected'
                  : active.status === 'error'
                    ? 'error'
                    : 'connecting'
            }
          />
          <span className="truncate">
            {active ? `${active.title} · ${STATUS_TEXT[active.status]}` : '就绪，未打开会话'}
          </span>
        </span>
        <span className="statusbar__sep" aria-hidden="true" />
        <span>主机 {state.hosts.length}</span>
        <span>会话 {state.sessions.length}</span>
      </div>

      <div className="statusbar__group">
        <span className={`statusbar__mode${isMock() ? ' is-mock' : ''}`}>
          {isMock() ? '演示模式' : '已连接本地后端'}
        </span>
        <span className="statusbar__sep" aria-hidden="true" />
        <button
          type="button"
          className="statusbar__shortcut"
          onClick={() => actions.setPaletteOpen(true)}
          aria-label="打开命令面板"
        >
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
          <span>命令面板</span>
        </button>
        <span className="statusbar__version mono">v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
}
