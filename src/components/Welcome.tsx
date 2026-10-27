import type { CSSProperties } from 'react';
import { isMock } from '../api/config';
import { useApp } from '../store/AppStore';
import { hostAccent, hostInitials, formatAddress, relativeTime } from '../lib/visual';
import { modKey } from '../lib/utils';
import { Icon } from './ui/Icon';
import { Kbd, KbdGroup } from './ui/Kbd';
import './Welcome.css';

const DEMO_LINES = [
  { text: 'hop connect demo-prod-web', tone: 'prompt' },
  { text: '正在协商 ssh-ed25519 密钥 … 完成', tone: 'dim' },
  { text: '已连接 10.0.4.21 · Ubuntu 24.04 LTS', tone: 'ok' },
  { text: 'zcx@prod-web:~$ uptime', tone: 'prompt' },
  { text: ' 22:16:04 up 41 days,  3:12,  2 users,  load average: 0.18, 0.24, 0.31', tone: 'mono' },
] as const;

export function Welcome() {
  const { state, actions } = useApp();
  const { hosts, sessions } = state;

  const recentHosts = [...hosts]
    .sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN'),
    )
    .slice(0, 3);

  return (
    <div className="welcome">
      <div className="welcome__glow" aria-hidden="true" />

      <section className="welcome__inner" aria-labelledby="welcome-title">
        <p className="welcome__eyebrow">
          <span className="welcome__eyebrow-line" aria-hidden="true" />
          SSH WORKSPACE
        </p>

        <h1 className="welcome__title" id="welcome-title">
          连接，<span className="welcome__accent">即刻开始</span>。
        </h1>

        <p className="welcome__lede">
          集中管理你的主机，在同一个窗口里打开多台服务器的终端。
          {isMock()
            ? '当前为演示模式，内置示例主机与可交互的模拟 shell。'
            : '主机与凭据都留在本机，密码经系统密钥库加密。'}
        </p>

        <div className="welcome__actions">
          <button type="button" className="welcome__cta" onClick={() => actions.openHostForm(null)}>
            <Icon name="plus" size={15} />
            新建连接
            <KbdGroup keys={[modKey, 'N']} />
          </button>
          <button type="button" className="welcome__ghost" onClick={() => actions.setPaletteOpen(true)}>
            <Icon name="search" size={14} />
            打开命令面板
            <KbdGroup keys={[modKey, 'K']} />
          </button>
        </div>

        <div className="welcome__preview" role="img" aria-label="Hop 终端会话示意">
          <header className="welcome__preview-bar">
            <span className="welcome__lights" aria-hidden="true">
              <i /> <i /> <i />
            </span>
            <span className="welcome__preview-title mono">
              {isMock() ? 'hop — demo-prod-web' : 'hop — 终端会话预览'}
            </span>
            <span className="welcome__preview-badge">SSH</span>
          </header>
          <div className="welcome__preview-body mono" aria-hidden="true">
            {DEMO_LINES.map((line, index) => (
              <p
                key={line.text}
                className={`welcome__line welcome__line--${line.tone}`}
                style={{ animationDelay: `${120 + index * 90}ms` }}
              >
                {line.tone === 'prompt' ? (
                  <>
                    <span className="welcome__prompt">$</span> {line.text}
                  </>
                ) : (
                  line.text
                )}
              </p>
            ))}
            <p className="welcome__line welcome__line--prompt welcome__caret-line">
              <span className="welcome__prompt">$</span>
              <span className="welcome__caret" aria-hidden="true" />
            </p>
          </div>
        </div>

        {recentHosts.length > 0 && (
          <div className="welcome__recent">
            <span className="welcome__recent-label">最近使用</span>
            <div className="welcome__chips">
              {recentHosts.map((host) => (
                <button
                  key={host.id}
                  type="button"
                  className="welcome__chip"
                  onClick={() => actions.connectHost(host)}
                  title={`连接 ${host.name} · ${relativeTime(host.lastConnectedAt)}`}
                >
                  <span
                    className="welcome__chip-avatar"
                    style={{ '--host-color': hostAccent(host) } as CSSProperties}
                    aria-hidden="true"
                  >
                    {hostInitials(host.name)}
                  </span>
                  <span className="welcome__chip-main">
                    <span className="welcome__chip-name truncate">{host.name}</span>
                    <span className="welcome__chip-addr mono truncate">{formatAddress(host)}</span>
                  </span>
                  <Icon name="arrow-up-right" size={12} className="welcome__chip-arrow" />
                </button>
              ))}
            </div>
          </div>
        )}

        <footer className="welcome__hints">
          <span>
            <Kbd>{modKey}</Kbd> <Kbd>B</Kbd> 折叠侧栏
          </span>
          <span className="welcome__hint-sep" aria-hidden="true" />
          <span>
            <Kbd>{modKey}</Kbd> <Kbd>,</Kbd> 偏好设置
          </span>
          <span className="welcome__hint-sep" aria-hidden="true" />
          <span>{sessions.length > 0 ? `已打开 ${sessions.length} 个会话` : '会话将以标签页打开'}</span>
        </footer>
      </section>
    </div>
  );
}
