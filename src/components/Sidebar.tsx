import { useMemo, type CSSProperties } from 'react';
import { isMock } from '../api/config';
import { hostAccent, hostInitials } from '../lib/visual';
import { useApp } from '../store/AppStore';
import { Icon } from './ui/Icon';
import { Kbd } from './ui/Kbd';
import { LogoMark } from './ui/Logo';
import { HostList } from './HostList';
import { modKey } from '../lib/utils';
import './Sidebar.css';

export function Sidebar() {
  const { state, actions } = useApp();
  const { hosts, hostsLoaded, hostsError, sessions, settings } = state;

  const connectedHostIds = useMemo(
    () => new Set(sessions.map((session) => session.hostId)),
    [sessions],
  );

  const railHosts = useMemo(
    () =>
      [...hosts]
        .sort(
          (a, b) =>
            Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
            (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) ||
            a.name.localeCompare(b.name, 'zh-Hans-CN'),
        )
        .slice(0, 12),
    [hosts],
  );

  return (
    <aside className="sidebar" aria-label="主机与工作区">
      {/* ---------------- 完整侧栏 ---------------- */}
      <div className="sidebar__full">
        <button
          type="button"
          className="sidebar__search"
          onClick={() => actions.setPaletteOpen(true)}
        >
          <Icon name="search" size={14} />
          <span className="sidebar__search-text">快速打开主机或命令</span>
          <Kbd>{modKey} K</Kbd>
        </button>

        <button
          type="button"
          className="sidebar__new"
          onClick={() => actions.openHostForm(null)}
        >
          <Icon name="plus" size={15} />
          新建连接
          <Kbd>{modKey} N</Kbd>
        </button>

        <HostList
          hosts={hosts}
          loaded={hostsLoaded}
          error={hostsError}
          connectedHostIds={connectedHostIds}
        />

        <footer className="sidebar__foot">
          <button
            type="button"
            className="sidebar__foot-btn"
            onClick={() => actions.setSettingsOpen(true)}
          >
            <Icon name="sliders" size={15} />
            <span>偏好设置</span>
            <Kbd>{modKey} ,</Kbd>
          </button>
          <div className="sidebar__foot-meta">
            <span className={`sidebar__mode${isMock() ? ' is-mock' : ''}`}>
              {isMock() ? '演示模式' : '已连接后端'}
            </span>
            <span className="mono">v0.1.0</span>
          </div>
        </footer>
      </div>

      {/* ---------------- 折叠轨 ---------------- */}
      <div className="sidebar__rail">
        <button
          type="button"
          className="rail__brand"
          onClick={actions.toggleSidebar}
          aria-label="展开侧栏"
          title="展开侧栏"
        >
          <LogoMark size={26} />
        </button>

        <button
          type="button"
          className="rail__new"
          onClick={() => actions.openHostForm(null)}
          aria-label="新建连接"
          title="新建连接"
        >
          <Icon name="plus" size={16} />
        </button>

        <div className="rail__divider" />

        <div className="rail__hosts">
          {railHosts.map((host) => (
            <button
              key={host.id}
              type="button"
              className={`rail__host${connectedHostIds.has(host.id) ? ' is-connected' : ''}`}
              style={{ '--host-color': hostAccent(host) } as CSSProperties}
              title={`${host.name} · ${host.username}@${host.host}`}
              aria-label={`连接 ${host.name}`}
              onClick={() => actions.connectHost(host)}
            >
              {hostInitials(host.name)}
            </button>
          ))}
        </div>

        <div className="rail__foot">
          <button
            type="button"
            className="rail__icon"
            onClick={() => actions.setPaletteOpen(true)}
            aria-label="快速打开"
            title="快速打开"
          >
            <Icon name="search" size={16} />
          </button>
          <button
            type="button"
            className="rail__icon"
            onClick={() => actions.setSettingsOpen(true)}
            aria-label="偏好设置"
            title="偏好设置"
          >
            <Icon name="sliders" size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
