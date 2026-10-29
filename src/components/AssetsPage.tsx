import { useMemo, useState } from 'react';
import { relativeTime } from '../lib/visual';
import { useApp } from '../store/AppStore';
import { DistroIcon } from './ui/DistroIcon';
import { Icon } from './ui/Icon';
import './AssetsPage.css';

const AUTH_LABEL: Record<string, string> = {
  key: '密钥',
  password: '密码',
  agent: 'Agent',
};

/**
 * 资产页：像后台管理列表一样一屏看全所有主机。
 * 每行右侧三个动作：连接 / 编辑 / 删除；图标来自连接成功后自动探测的发行版。
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
      <div className="assets__panel">
        <header className="assets__head">
          <div className="assets__title-wrap">
            <h1 className="assets__title">资产</h1>
            <span className="assets__count mono">{hosts.length}</span>
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
            <button
              type="button"
              className="assets__new"
              onClick={() => actions.openHostForm(null)}
              title="新建资产（Ctrl N）"
            >
              <Icon name="plus" size={14} />
              新建资产
            </button>
          </div>
        </header>

        {hostsError && (
          <p className="assets__error" role="alert">
            <Icon name="alert" size={13} /> {hostsError}
          </p>
        )}

        <div className="assets__table" role="table" aria-label="资产列表">
          <div className="assets__row assets__row--head" role="row">
            <span role="columnheader">主机</span>
            <span role="columnheader" className="assets__col-tags">
              标签
            </span>
            <span role="columnheader" className="assets__col-auth">
              认证
            </span>
            <span role="columnheader" className="assets__col-time">
              上次连接
            </span>
            <span role="columnheader" className="assets__col-actions">
              操作
            </span>
          </div>

          {list.map((host) => {
            const live = connected.has(host.id);
            return (
              <div className="assets__row" role="row" key={host.id}>
                <div className="assets__cell assets__cell--host" role="cell">
                  <DistroIcon distro={host.distro} fallbackText={host.name} size={30} />
                  <div className="assets__host-text">
                    <span className="assets__host-name truncate" title={host.name}>
                      {host.favorite && <Icon name="star" size={11} />}
                      {host.name}
                      {live && <i className="assets__live" title="已有会话连接中" />}
                    </span>
                    <span className="assets__host-addr mono truncate">
                      {host.username}@{host.host}:{host.port}
                    </span>
                  </div>
                </div>

                <div className="assets__cell assets__col-tags" role="cell">
                  {host.distro && (
                    <span className="assets__tag assets__tag--distro" title={host.distro.name}>
                      {host.distro.name.split(' ')[0]}
                      {host.distro.version ? ` ${host.distro.version}` : ''}
                    </span>
                  )}
                  {(host.tags ?? []).length > 0 ? (
                    <span className="assets__tag-list">
                      {host.tags.slice(0, 3).map((tag) => (
                        <span className="assets__tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                      {host.tags.length > 3 && (
                        <span className="assets__tag assets__tag--more">+{host.tags.length - 3}</span>
                      )}
                    </span>
                  ) : (
                    <span className="assets__muted">未分组</span>
                  )}
                </div>

                <div className="assets__cell assets__col-auth" role="cell">
                  <span className="assets__muted">{AUTH_LABEL[host.authMethod] ?? host.authMethod}</span>
                </div>

                <div className="assets__cell assets__col-time" role="cell">
                  <span className="assets__muted">
                    {host.lastConnectedAt ? relativeTime(host.lastConnectedAt) : '从未'}
                  </span>
                </div>

                <div className="assets__cell assets__col-actions" role="cell">
                  <button
                    type="button"
                    className="assets__btn assets__btn--primary"
                    onClick={() => actions.connectHost(host)}
                  >
                    <Icon name="terminal" size={13} />
                    连接
                  </button>
                  <button
                    type="button"
                    className="assets__btn"
                    onClick={() => actions.openHostForm(host.id)}
                    title="编辑"
                  >
                    <Icon name="pencil" size={13} />
                    <span className="assets__btn-label">编辑</span>
                  </button>
                  <button
                    type="button"
                    className="assets__btn assets__btn--danger"
                    onClick={() => actions.requestDeleteHost(host.id)}
                    title="删除"
                  >
                    <Icon name="trash" size={13} />
                    <span className="assets__btn-label">删除</span>
                  </button>
                </div>
              </div>
            );
          })}

          {hostsLoaded && list.length === 0 && (
            <div className="assets__empty">
              <Icon name="server" size={20} />
              <p>{query ? '没有匹配的资产' : '还没有任何主机'}</p>
              <span>{query ? '换个关键词试试' : '点右上角「新建资产」添加第一台服务器'}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
