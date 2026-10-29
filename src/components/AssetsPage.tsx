import { useMemo, useState } from 'react';
import { hostAccent, hostInitials, relativeTime } from '../lib/visual';
import { useApp } from '../store/AppStore';
import { Icon } from './ui/Icon';
import './AssetsPage.css';

const AUTH_LABEL: Record<string, string> = {
  key: '密钥',
  password: '密码',
  agent: 'SSH Agent',
};

/**
 * 资产页：专门用来添加/整理主机。
 * 每张卡片底部三个动作：连接 / 编辑 / 删除。
 */
export function AssetsPage() {
  const { state, actions } = useApp();
  const { hosts, hostsLoaded, hostsError, sessions } = state;
  const [query, setQuery] = useState('');

  const connected = useMemo(
    () => new Set(sessions.map((session) => session.hostId)),
    [sessions],
  );

  const list = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const sorted = [...hosts].sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN'),
    );
    if (!keyword) return sorted;
    return sorted.filter((host) =>
      [host.name, host.host, host.username, ...(host.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [hosts, query]);

  return (
    <section className="assets" aria-label="资产">
      <header className="assets__head">
        <div className="assets__heading">
          <h1 className="assets__title">资产</h1>
          <p className="assets__sub">
            {hostsLoaded ? `共 ${hosts.length} 台主机` : '正在加载主机…'}
            <span className="assets__hint">连上以后可随时回到终端页</span>
          </p>
        </div>

        <div className="assets__tools">
          <label className="assets__search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              placeholder="搜索名称 / 地址 / 标签"
              aria-label="搜索资产"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="assets__new" onClick={() => actions.openHostForm(null)}>
            <Icon name="plus" size={15} />
            新建资产
          </button>
        </div>
      </header>

      {hostsError && (
        <p className="assets__error" role="alert">
          <Icon name="alert" size={13} /> {hostsError}
        </p>
      )}

      {hostsLoaded && list.length === 0 && (
        <div className="assets__empty">
          <Icon name="server" size={22} />
          <p>{query ? '没有匹配的资产' : '还没有任何主机'}</p>
          <span>{query ? '换个关键词试试' : '点右上角「新建资产」添加第一台服务器'}</span>
          {!query && (
            <button type="button" className="assets__new" onClick={() => actions.openHostForm(null)}>
              <Icon name="plus" size={15} />
              新建资产
            </button>
          )}
        </div>
      )}

      <div className="assets__grid">
        {list.map((host) => {
          const live = connected.has(host.id);
          return (
            <article className="asset" key={host.id}>
              <header className="asset__head">
                <span className="asset__avatar" style={{ background: hostAccent(host) }}>
                  {hostInitials(host.name)}
                </span>
                <div className="asset__id">
                  <h2 className="asset__name truncate" title={host.name}>
                    {host.favorite && <Icon name="star" size={12} />}
                    {host.name}
                  </h2>
                  <p className="asset__addr mono truncate" title={`${host.username}@${host.host}:${host.port}`}>
                    {host.username}@{host.host}:{host.port}
                  </p>
                </div>
                {live && <span className="asset__live" title="已有会话连接中" />}
              </header>

              <div className="asset__tags">
                {(host.tags ?? []).length > 0 ? (
                  host.tags.map((tag) => (
                    <span className="asset__tag" key={tag}>
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="asset__tag asset__tag--muted">未分组</span>
                )}
              </div>

              <p className="asset__meta">
                <span>{AUTH_LABEL[host.authMethod] ?? host.authMethod}</span>
                <span>·</span>
                <span>
                  {host.lastConnectedAt ? `上次连接 · ${relativeTime(host.lastConnectedAt)}` : '还没连接过'}
                </span>
              </p>

              <footer className="asset__actions">
                <button
                  type="button"
                  className="asset__btn asset__btn--primary"
                  onClick={() => actions.connectHost(host)}
                >
                  <Icon name="terminal" size={13} />
                  连接
                </button>
                <button
                  type="button"
                  className="asset__btn"
                  onClick={() => actions.openHostForm(host.id)}
                >
                  <Icon name="pencil" size={13} />
                  编辑
                </button>
                <button
                  type="button"
                  className="asset__btn asset__btn--danger"
                  onClick={() => actions.requestDeleteHost(host.id)}
                >
                  <Icon name="trash" size={13} />
                  删除
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
