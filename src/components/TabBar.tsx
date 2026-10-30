import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Session } from '../types';
import { useApp } from '../store/AppStore';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';
import './TabBar.css';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
}

type MenuState = { x: number; y: number; session: Session } | null;

export function TabBar({ sessions, activeSessionId }: TabBarProps) {
  const { actions, state } = useApp();
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = sessions.findIndex((session) => session.id === activeSessionId);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = sessions[(index + delta + sessions.length) % sessions.length];
    actions.activateSession(next.id);
    document.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus();
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const openMenu = (event: MouseEvent<HTMLElement>, session: Session) => {
    event.preventDefault();
    event.stopPropagation();
    actions.activateSession(session.id);
    const width = 176;
    const height = 132;
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8),
      session,
    });
  };

  const closeTab = (session: Session) => {
    setMenu(null);
    actions.requestCloseSession(session.id);
  };

  return (
    <div className="tabbar">
      <div className="tabbar__scroll" role="tablist" aria-label="会话标签页" onKeyDown={handleKeyDown}>
        {sessions.map((session) => {
          /* 只有停在终端页时标签才算选中：切到资产/笔记页时不该继续高亮 */
          const active = session.id === activeSessionId && state.ui.page === 'terminal';
          const busy = session.status === 'connecting' || session.status === 'reconnecting';
          return (
            <div
              key={session.id}
              className={`tab${active ? ' is-active' : ''}${session.status === 'error' ? ' is-error' : ''}`}
            >
              <button
                type="button"
                role="tab"
                data-tab-id={session.id}
                className="tab__main"
                aria-selected={active}
                aria-controls={`pane-${session.id}`}
                tabIndex={active ? 0 : -1}
                title={`${session.title} · ${session.address}`}
                onClick={() => actions.activateSession(session.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    actions.requestCloseSession(session.id);
                  }
                }}
                onContextMenu={(event) => openMenu(event, session)}
              >
                <span className="tab__status">
                  {busy ? (
                    <Spinner size={11} />
                  ) : (
                    <span className={`tab__dot tab__dot--${session.status}`} />
                  )}
                </span>
                <span className="tab__title truncate">{session.title}</span>
              </button>
              <button
                type="button"
                className="tab__close"
                aria-label={`关闭 ${session.title}`}
                tabIndex={active ? 0 : -1}
                onClick={() => actions.requestCloseSession(session.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="tabbar__actions">
        <span className="tabbar__hint mono">{state.sessions.length} 个会话</span>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="tab-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="tab-menu__item"
            onClick={() => {
              setMenu(null);
              actions.duplicateSession(menu.session.id);
            }}
          >
            <Icon name="copy" size={13} />
            复制连接
          </button>
          <button
            type="button"
            role="menuitem"
            className="tab-menu__item"
            onClick={() => {
              setMenu(null);
              actions.reconnectSession(menu.session.id);
            }}
          >
            <Icon name="refresh" size={13} />
            重新连接
          </button>
          <button
            type="button"
            role="menuitem"
            className="tab-menu__item tab-menu__item--danger"
            onClick={() => closeTab(menu.session)}
          >
            <Icon name="x" size={13} />
            关闭连接
          </button>
        </div>
      )}
    </div>
  );
}
