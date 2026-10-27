import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../store/AppStore';
import { modKey } from '../lib/utils';
import { Icon, type IconName } from './ui/Icon';
import { Kbd } from './ui/Kbd';
import './CommandPalette.css';

interface CommandItem {
  id: string;
  group: '会话' | '主机' | '操作';
  label: string;
  hint?: string;
  keywords?: string;
  icon: IconName;
  kbd?: string;
  run: () => void;
}

export function CommandPalette() {
  const { state, resolvedTheme, actions } = useApp();
  const open = state.ui.paletteOpen;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => actions.setPaletteOpen(false);

  const items = useMemo<CommandItem[]>(() => {
    const sessionItems: CommandItem[] = state.sessions.map((session) => ({
      id: `session-${session.id}`,
      group: '会话',
      label: session.title,
      hint: session.address,
      keywords: `会话 标签 ${session.status}`,
      icon: 'terminal',
      run: () => actions.activateSession(session.id),
    }));

    const hostItems: CommandItem[] = state.hosts.map((host) => ({
      id: `host-${host.id}`,
      group: '主机',
      label: host.name,
      hint: `${host.username}@${host.host}:${host.port}`,
      keywords: `${host.tags.join(' ')} 连接 ${host.host}`,
      icon: 'server',
      run: () => actions.connectHost(host),
    }));

    const actionItems: CommandItem[] = [
      {
        id: 'action-new-host',
        group: '操作',
        label: '新建连接',
        hint: '添加一台 SSH 主机',
        icon: 'plus',
        kbd: `${modKey} N`,
        run: () => actions.openHostForm(null),
      },
      {
        id: 'action-settings',
        group: '操作',
        label: '打开偏好设置',
        hint: '外观、终端与连接选项',
        icon: 'sliders',
        kbd: `${modKey} ,`,
        run: () => actions.setSettingsOpen(true),
      },
      {
        id: 'action-theme',
        group: '操作',
        label: resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
        hint: '立即切换界面配色',
        icon: resolvedTheme === 'dark' ? 'sun' : 'moon',
        run: () =>
          actions.updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' }),
      },
      {
        id: 'action-sidebar',
        group: '操作',
        label: state.settings.sidebarCollapsed ? '展开侧栏' : '折叠侧栏',
        hint: '为主机列表腾出空间',
        icon: 'panel-left',
        kbd: `${modKey} B`,
        run: () => actions.toggleSidebar(),
      },
    ];

    const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
    if (activeSession) {
      actionItems.push({
        id: 'action-close-tab',
        group: '操作',
        label: `关闭标签页「${activeSession.title}」`,
        hint: '断开当前会话',
        icon: 'x',
        kbd: `${modKey} W`,
        run: () => actions.requestCloseSession(activeSession.id),
      });
    }

    return [...sessionItems, ...hostItems, ...actionItems];
  }, [state.sessions, state.hosts, state.settings.sidebarCollapsed, state.activeSessionId, resolvedTheme, actions]);

  const filtered = useMemo(() => {
    const raw = query.trim();
    const prefixed = /^(host|session|tab|edit|action|act):\s*(.*)$/i.exec(raw);
    const mode = prefixed ? prefixed[1].toLowerCase() : '';
    const needle = (prefixed ? prefixed[2] : raw).toLowerCase();

    let pool: CommandItem[] = items;
    if (mode === 'host' || mode === 'edit') {
      // 前缀检索：host: 直接连接，edit: 直接打开编辑表单
      pool = state.hosts.map<CommandItem>((host) => ({
        id: `${mode}-${host.id}`,
        group: '主机',
        label: mode === 'edit' ? `编辑「${host.name}」` : host.name,
        hint: `${host.username}@${host.host}:${host.port}`,
        keywords: host.tags.join(' '),
        icon: mode === 'edit' ? 'pencil' : 'server',
        run: () =>
          mode === 'edit' ? actions.openHostForm(host.id) : actions.connectHost(host),
      }));
    } else if (mode === 'session' || mode === 'tab') {
      pool = items.filter((item) => item.group === '会话');
    } else if (mode === 'action' || mode === 'act') {
      pool = items.filter((item) => item.group === '操作');
    }

    if (!needle) return pool;
    return pool.filter((item) =>
      `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(needle),
    );
  }, [items, query, state.hosts, actions]);

  const safeActive = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('.palette__item.is-active');
    node?.scrollIntoView({ block: 'nearest' });
  }, [safeActive, filtered.length]);

  if (!open) return null;

  const groups: Array<CommandItem['group']> = ['会话', '主机', '操作'];

  const runItem = (item: CommandItem) => {
    close();
    // 让关闭动画与状态更新解耦，避免在同一帧里抢焦点
    window.setTimeout(item.run, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + delta + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[safeActive];
      if (item) runItem(item);
    }
  };

  return createPortal(
    <div className="palette-layer" onKeyDown={handleKeyDown}>
      <div className="palette-scrim" onMouseDown={close} aria-hidden="true" />
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette__search">
          <Icon name="search" size={16} className="palette__search-icon" />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="搜索主机、会话或命令…"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={safeActive >= 0 ? `palette-item-${safeActive}` : undefined}
            aria-label="搜索主机、会话或命令"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="palette__list" id="palette-list" role="listbox" ref={listRef} aria-label="搜索结果">
          {filtered.length === 0 && (
            <div className="palette__empty">
              <Icon name="search" size={18} />
              <p>没有匹配「{query.trim()}」的结果</p>
              <span>换个关键词，或直接新建连接。</span>
            </div>
          )}

          {groups.map((group) => {
            const groupItems = filtered
              .map((item, index) => ({ item, index }))
              .filter((entry) => entry.item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div className="palette__group" key={group} role="group" aria-label={group}>
                <p className="palette__group-label">{group}</p>
                {groupItems.map(({ item, index }) => {
                  const isActive = index === safeActive;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      id={`palette-item-${index}`}
                      role="option"
                      aria-selected={isActive}
                      className={`palette__item${isActive ? ' is-active' : ''}`}
                      onMouseMove={() => setActive(index)}
                      onClick={() => runItem(item)}
                    >
                      <span className="palette__item-icon">
                        <Icon name={item.icon} size={14} />
                      </span>
                      <span className="palette__item-main">
                        <span className="palette__item-label truncate">{item.label}</span>
                        {item.hint && <span className="palette__item-hint truncate">{item.hint}</span>}
                      </span>
                      {item.kbd ? (
                        <span className="palette__item-kbd mono">{item.kbd}</span>
                      ) : (
                        <Icon name="enter" size={13} className="palette__item-enter" />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <footer className="palette__foot">
          <span className="palette__foot-hints">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> 选择
            </span>
            <span>
              <Kbd>↵</Kbd> 打开
            </span>
          </span>
          <span className="palette__count">
            {filtered.length} 项结果 · 可用 host: / edit: 前缀
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
