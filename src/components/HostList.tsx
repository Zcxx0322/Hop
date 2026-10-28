import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Host } from '../types';
import { formatAddress, relativeTime, hostAccent, hostInitials } from '../lib/visual';
import { copyText } from '../lib/clipboard';
import { useApp } from '../store/AppStore';
import { Icon } from './ui/Icon';
import { StatusDot } from './ui/Spinner';
import './HostList.css';

type Tab = 'all' | 'favorites';

interface HostListProps {
  hosts: Host[];
  loaded: boolean;
  error: string | null;
  connectedHostIds: Set<string>;
}

interface MenuState {
  host: Host;
  x: number;
  y: number;
}

const MENU_WIDTH = 190;
const MENU_HEIGHT = 236;

export function HostList({ hosts, loaded, error, connectedHostIds }: HostListProps) {
  const { actions } = useApp();
  const [tab, setTab] = useState<Tab>('all');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const favoriteCount = hosts.filter((host) => host.favorite).length;

  const visibleHosts = useMemo(() => {
    const filtered = tab === 'favorites' ? hosts.filter((host) => host.favorite) : hosts;
    return [...filtered].sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN'),
    );
  }, [hosts, tab]);

  const openMenu = (host: Host, x: number, y: number) => {
    setMenu({
      host,
      x: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(y, window.innerHeight - MENU_HEIGHT - 8),
    });
  };

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    const onViewportChange = () => setMenu(null);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('blur', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('blur', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [menu]);

  const copyAddress = async (host: Host) => {
    const ok = await copyText(formatAddress(host));
    actions.toast(ok ? 'success' : 'error', ok ? '地址已复制到剪贴板' : '剪贴板不可用，复制失败');
  };

  return (
    <section className="host-list" aria-label="主机列表">
      <header className="host-list__head">
        <h2 className="host-list__title">主机</h2>
        <span className="host-list__count">{tab === 'favorites' ? favoriteCount : hosts.length}</span>
        <div className="host-list__tabs" role="group" aria-label="筛选主机">
          <button
            type="button"
            className={`host-list__tab${tab === 'all' ? ' is-active' : ''}`}
            aria-pressed={tab === 'all'}
            onClick={() => setTab('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={`host-list__tab${tab === 'favorites' ? ' is-active' : ''}`}
            aria-pressed={tab === 'favorites'}
            onClick={() => setTab('favorites')}
          >
            收藏
          </button>
        </div>
      </header>

      {!loaded && !error && (
        <div className="host-list__skeleton" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="host-skeleton">
              <span className="host-skeleton__avatar" />
              <span className="host-skeleton__lines">
                <span />
                <span />
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="host-list__error" role="alert">
          <Icon name="alert" size={16} />
          <p>{error}</p>
          <button type="button" onClick={() => void actions.refreshHosts()}>
            重新加载
          </button>
        </div>
      )}

      {loaded && !error && visibleHosts.length === 0 && (
        <div className="host-list__empty">
          <Icon name={tab === 'favorites' ? 'star' : 'server'} size={20} />
          <p>{tab === 'favorites' ? '还没有收藏的主机' : '还没有任何主机'}</p>
          <span className="dim">
            {tab === 'favorites' ? '在主机菜单里选择「收藏」即可置顶。' : '新建一条连接开始使用 Hop。'}
          </span>
          {tab === 'all' && (
            <button type="button" className="host-list__empty-btn" onClick={() => actions.openHostForm(null)}>
              <Icon name="plus" size={14} /> 新建连接
            </button>
          )}
        </div>
      )}

      {visibleHosts.length > 0 && (
        <div className="host-list__scroll" role="list">
          {visibleHosts.map((host) => {
            const connected = connectedHostIds.has(host.id);
            const color = hostAccent(host);
            return (
              <div key={host.id} role="listitem">
                <div
                  className={`host-row${connected ? ' is-connected' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(host, event.clientX, event.clientY);
                  }}
                >
                  <button
                    type="button"
                    className="host-row__open"
                    onClick={() => actions.connectHost(host)}
                    aria-label={`连接 ${host.name}，${formatAddress(host)}`}
                    title={`${formatAddress(host)} · ${relativeTime(host.lastConnectedAt)}`}
                  >
                    <span
                      className="host-row__avatar"
                      style={{ '--host-color': color } as CSSProperties}
                      aria-hidden="true"
                    >
                      {hostInitials(host.name)}
                    </span>
                    <span className="host-row__main">
                      <span className="host-row__name">
                        {host.favorite && (
                          <Icon name="star" size={10} filled className="host-row__star" />
                        )}
                        <span className="truncate">{host.name}</span>
                      </span>
                      <span className="host-row__addr truncate">
                        {host.username}@{host.host}
                        <span className="host-row__port">:{host.port}</span>
                      </span>
                    </span>
                  </button>

                  <span className="host-row__actions">
                    <button
                      type="button"
                      className="host-row__action"
                      aria-label={`编辑 ${host.name}`}
                      title="编辑主机"
                      onClick={() => actions.openHostForm(host.id)}
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      type="button"
                      className="host-row__action"
                      aria-label={`${host.name} 的更多操作`}
                      title="更多操作"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        openMenu(host, rect.right - MENU_WIDTH + 16, rect.bottom + 6);
                      }}
                    >
                      <Icon name="dots" size={14} />
                    </button>
                  </span>

                  {connected && (
                    <span className="host-row__live" title="会话已打开">
                      <StatusDot tone="connected" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="host-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            aria-label={`${menu.host.name} 的操作`}
          >
            <div className="host-menu__host">
              <span className="host-menu__name truncate">{menu.host.name}</span>
              <span className="host-menu__addr mono truncate">{formatAddress(menu.host)}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                actions.connectHost(menu.host);
              }}
            >
              <Icon name="zap" size={14} /> 打开连接
            </button>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                actions.openFiles(menu.host.id);
              }}
            >
              <Icon name="folder" size={14} /> 文件传输
            </button>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                actions.openMonitor(menu.host.id);
              }}
            >
              <Icon name="cpu" size={14} /> 主机状态
            </button>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                actions.openHostForm(menu.host.id);
              }}
            >
              <Icon name="pencil" size={14} /> 编辑主机
            </button>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                void actions.toggleFavorite(menu.host);
              }}
            >
              <Icon name="star" size={14} filled={menu.host.favorite} />
              {menu.host.favorite ? '取消收藏' : '收藏主机'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="host-menu__item"
              onClick={() => {
                setMenu(null);
                void copyAddress(menu.host);
              }}
            >
              <Icon name="copy" size={14} /> 复制地址
            </button>
            <div className="host-menu__sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="host-menu__item host-menu__item--danger"
              onClick={() => {
                setMenu(null);
                actions.requestDeleteHost(menu.host.id);
              }}
            >
              <Icon name="trash" size={14} /> 删除主机
            </button>
          </div>,
          document.body,
        )}
    </section>
  );
}
