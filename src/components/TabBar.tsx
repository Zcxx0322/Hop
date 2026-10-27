import type { KeyboardEvent } from 'react';
import type { Session } from '../types';
import { useApp } from '../store/AppStore';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';
import './TabBar.css';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
}

export function TabBar({ sessions, activeSessionId }: TabBarProps) {
  const { actions, state } = useApp();

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

  return (
    <div className="tabbar">
      <div className="tabbar__scroll" role="tablist" aria-label="会话标签页" onKeyDown={handleKeyDown}>
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
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
        <button
          type="button"
          className="tabbar__new"
          aria-label="新建连接"
          title="新建连接"
          onClick={() => actions.openHostForm(null)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}
