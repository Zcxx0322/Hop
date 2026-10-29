import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { isMock } from '../api/config';
import { useApp } from '../store/AppStore';
import { hostAccent, hostInitials, formatAddress, relativeTime } from '../lib/visual';
import { modKey } from '../lib/utils';
import { Icon } from './ui/Icon';
import { Kbd, KbdGroup } from './ui/Kbd';
import './Welcome.css';

type Tone = 'dim' | 'ok' | 'mono';

interface ScriptLine {
  text: string;
  tone: Tone;
  /** 历史里的命令行：渲染成「提示符 + 命令」 */
  isCommand?: boolean;
}

interface Scene {
  command: string;
  lines: ScriptLine[];
}

/**
 * 欢迎页中间的「活终端」：自己敲命令、自己出结果，停一会儿再换下一幕。
 * 用 setTimeout 逐字推进；prefers-reduced-motion 时停在最终帧。
 */
/** 已经连上的那台机器：提示符直接写成远端会话的样子 */
const PROMPT = 'root@prod-web:~$';

const SCENES: Scene[] = [
  {
    command: 'uptime',
    lines: [
      { text: ' 01:12:04 up 41 days,  3:12,  2 users,  load average: 0.18, 0.24, 0.31', tone: 'mono' },
    ],
  },
  {
    command: 'df -h /',
    lines: [
      { text: 'Filesystem      Size  Used Avail Use% Mounted on', tone: 'dim' },
      { text: '/dev/vda1        39G   16G   21G  44% /', tone: 'mono' },
    ],
  },
  {
    command: 'docker ps --format "{{.Names}}  {{.Status}}"',
    lines: [
      { text: 'nginx-proxy   Up 41 days (healthy)', tone: 'mono' },
      { text: 'hop-agent     Up 12 hours', tone: 'mono' },
    ],
  },
];

/** 播放一遍之后固化的完整会话记录 */
const TRANSCRIPT: Array<{ id: string; line: ScriptLine }> = SCENES.flatMap((scene, sceneIndex) => [
  { id: `${sceneIndex}-cmd`, line: { text: scene.command, tone: 'mono' as Tone, isCommand: true } },
  ...scene.lines.map((line, index) => ({ id: `${sceneIndex}-${index}`, line })),
]);

const PLAYED_KEY = 'hop.welcome.played.v1';

const CHAR_MS = 42;
const LINE_MS = 200;
const HOLD_MS = 1900;

function LiveTerminal() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [lines, setLines] = useState<ScriptLine[]>([]);
  /** 已经跑完的旧命令输出，保留几行，让卡片不会在中途变空 */
  const [history, setHistory] = useState<Array<{ id: string; line: ScriptLine }>>([]);
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  /** 只播一次：播完（或系统要求减少动效）就停在静态回放 */
  const [played, setPlayed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(PLAYED_KEY) === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduced || played) return;
    const scene = SCENES[sceneIndex % SCENES.length];
    let cancelled = false;
    let timer = 0;

    const typeChar = (index: number) => {
      if (cancelled) return;
      if (index < scene.command.length) {
        setTyped(scene.command.slice(0, index + 1));
        timer = window.setTimeout(() => typeChar(index + 1), CHAR_MS + (index % 3) * 12);
        return;
      }
      let line = 0;
      const emit = () => {
        if (cancelled) return;
        if (line < scene.lines.length) {
          const next = scene.lines[line];
          line += 1;
          setLines((prev) => [...prev, next]);
          timer = window.setTimeout(emit, LINE_MS);
          return;
        }
        timer = window.setTimeout(() => {
          if (cancelled) return;
          setHistory((prev) =>
            [
              ...prev,
              { id: `${sceneIndex}-cmd`, line: { text: scene.command, tone: 'mono' as Tone, isCommand: true } },
              ...scene.lines.map((line, index) => ({ id: `${sceneIndex}-${index}`, line })),
            ].slice(-4),
          );
          setLines([]);
          setTyped('');
          if (sceneIndex % SCENES.length === SCENES.length - 1) {
            // 三幕走完：记住「已经播过」，停在完整记录上
            try {
              window.localStorage.setItem(PLAYED_KEY, '1');
            } catch {
              /* 隐私模式下写不进去也无妨，下次再播一遍 */
            }
            setPlayed(true);
            return;
          }
          setSceneIndex((value) => value + 1);
        }, HOLD_MS);
      };
      timer = window.setTimeout(emit, 260);
    };

    setTyped('');
    setLines([]);
    timer = window.setTimeout(() => typeChar(0), 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sceneIndex, reduced, played]);

  const scene = SCENES[sceneIndex % SCENES.length];
  const still = reduced || played;
  const visibleCommand = still ? scene.command : typed;
  const visibleLines = still ? scene.lines : lines;
  const visibleHistory = still ? TRANSCRIPT : history;

  return (
    <div
      className="welcome__preview"
      role="img"
      aria-label={`Hop 终端会话示意：${scene.command}`}
    >
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
        {visibleHistory.map((item) =>
          item.line.isCommand ? (
            <p key={item.id} className="welcome__line welcome__line--prompt">
              <span className="welcome__prompt">{PROMPT}</span> {item.line.text}
            </p>
          ) : (
            <p key={item.id} className={`welcome__line welcome__line--${item.line.tone}`}>
              {item.line.text}
            </p>
          ),
        )}
        {!still && (
          <p className="welcome__line welcome__line--prompt">
            <span className="welcome__prompt">{PROMPT}</span> {visibleCommand}
            <span className="welcome__caret welcome__caret--inline" />
          </p>
        )}
        {!still && visibleLines.map((line, index) => (
          <p
            key={`${sceneIndex}-${index}`}
            className={`welcome__line welcome__line--${line.tone} welcome__line--enter`}
          >
            {line.text}
          </p>
        ))}
        {still && (
          <p className="welcome__line welcome__line--prompt welcome__caret-line">
            <span className="welcome__prompt">{PROMPT}</span>
            <span className="welcome__caret" />
          </p>
        )}
      </div>
      <span className="welcome__scan" aria-hidden="true" />
    </div>
  );
}

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
      <div className="welcome__glow" aria-hidden="true">
        <span className="welcome__aura welcome__aura--a" />
        <span className="welcome__aura welcome__aura--b" />
      </div>

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

        <LiveTerminal />

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
            <Kbd>{modKey}</Kbd> <Kbd>K</Kbd> 命令面板
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
