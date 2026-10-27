import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Host, Session } from '../types';
import { createTransport } from '../api/createTransport';
import type { TerminalTransport } from '../api/transport';
import { useApp } from '../store/AppStore';
import { FONT_STACKS } from '../store/settings';
import { formatAddress } from '../lib/visual';
import { Icon } from './ui/Icon';
import { StatusDot } from './ui/Spinner';
import './TerminalPane.css';

interface TerminalPaneProps {
  session: Session;
  host: Host | null;
  active: boolean;
}

const STATUS_LABEL: Record<Session['status'], string> = {
  connecting: '正在建立 SSH 会话…',
  connected: '已连接',
  reconnecting: '连接中断，正在重连…',
  closed: '会话已结束',
  error: '连接失败',
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function readTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const background = readVar(styles, '--term-bg', '#080b11');
  const accent = readVar(styles, '--accent', '#7c8cf8');
  return {
    background,
    foreground: readVar(styles, '--term-fg', '#d8e0ef'),
    cursor: accent,
    cursorAccent: background,
    selectionBackground: readVar(styles, '--term-selection', 'rgba(124, 140, 248, 0.28)'),
    selectionInactiveBackground: readVar(styles, '--term-selection', 'rgba(124, 140, 248, 0.16)'),
    black: '#0b1017',
    red: '#fb7185',
    green: '#3ddcaf',
    yellow: '#f2b45c',
    blue: '#7c8cf8',
    magenta: '#c084fc',
    cyan: '#43d9b8',
    white: '#d8e0ef',
    brightBlack: '#5d6a80',
    brightRed: '#fda4af',
    brightGreen: '#7ef0cf',
    brightYellow: '#fbd38d',
    brightBlue: '#a5b0ff',
    brightMagenta: '#d8b4fe',
    brightCyan: '#8ff5e4',
    brightWhite: '#f4f7ff',
  };
}

export function TerminalPane({ session, host, active }: TerminalPaneProps) {
  const { state, resolvedTheme, actions } = useApp();
  const { settings } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const transportRef = useRef<TerminalTransport | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { updateSession } = actions;

  const copySelection = useCallback(() => {
    const term = terminalRef.current;
    const selection = term?.getSelection() ?? '';
    if (!selection) {
      actions.toast('info', '先在终端里选中要复制的文本');
      return;
    }
    void navigator.clipboard
      .writeText(selection)
      .then(() => actions.toast('success', '已复制选中内容'))
      .catch(() => actions.toast('error', '浏览器拒绝了剪贴板访问'));
  }, [actions]);

  /* ---------- 创建终端实例 ---------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: FONT_STACKS[settings.fontFamily].stack,
      fontSize: settings.fontSize,
      lineHeight: 1.32,
      letterSpacing: 0,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      smoothScrollDuration: 90,
      macOptionIsMeta: true,
      theme: readTerminalTheme(),
      allowTransparency: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    terminalRef.current = term;
    fitRef.current = fit;

    term.writeln(
      `\x1b[38;2;124;140;248m●\x1b[0m \x1b[1mHop\x1b[0m \x1b[2m·\x1b[0m 正在准备会话 ${session.title}`,
    );
    term.writeln('');

    const refit = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      try {
        fit.fit();
        transportRef.current?.resize(term.cols, term.rows);
      } catch {
        /* 容器尚未布局完成 */
      }
    };
    const frame = requestAnimationFrame(refit);
    const observer = new ResizeObserver(() => refit());
    observer.observe(container);

    const dataDisposable = term.onData((data) => {
      transportRef.current?.sendInput(data);
    });

    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c'
      ) {
        copySelection();
        return false;
      }
      return true;
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dataDisposable.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // 每个标签页一个独立终端实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /* ---------- 连接传输层 ---------- */
  useEffect(() => {
    if (!host) return;
    const term = terminalRef.current;
    if (!term) return;

    const transport = createTransport();
    transportRef.current = transport;

    const offData = transport.onData((chunk) => {
      terminalRef.current?.write(chunk);
    });
    const offStatus = transport.onStatus((status, detail) => {
      updateSession(session.id, { status, detail });
      if (status === 'error') {
        terminalRef.current?.writeln(`\r\n\x1b[31m✖ ${detail ?? '连接失败'}\x1b[0m`);
      }
      if (status === 'closed' && detail) {
        terminalRef.current?.writeln(`\r\n\x1b[2m${detail}\x1b[0m`);
      }
    });

    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }

    transport.connect({
      sessionId: session.id,
      host,
      cols: term.cols,
      rows: term.rows,
      timeoutMs: settings.connectTimeoutMs,
    });

    return () => {
      offData();
      offStatus();
      transport.dispose();
      if (transportRef.current === transport) transportRef.current = null;
    };
    // 重连通过 attempt 递增触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.id, session.id, attempt]);

  /* ---------- 外观设置实时生效 ---------- */
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = FONT_STACKS[settings.fontFamily].stack;
    term.options.fontSize = settings.fontSize;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    term.options.theme = readTerminalTheme();
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
    resolvedTheme,
    settings.accent,
  ]);

  /* ---------- 激活时聚焦 ---------- */
  useEffect(() => {
    if (!active) return;
    const term = terminalRef.current;
    if (!term) return;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
    transportRef.current?.resize(term.cols, term.rows);
    const frame = requestAnimationFrame(() => term.focus());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const reconnect = () => {
    transportRef.current?.dispose();
    transportRef.current = null;
    terminalRef.current?.reset();
    updateSession(session.id, { status: 'connecting', detail: undefined });
    setAttempt((value) => value + 1);
  };

  const busy = session.status === 'connecting' || session.status === 'reconnecting';
  const statusText = session.status === 'error' && session.detail ? session.detail : STATUS_LABEL[session.status];

  return (
    <section
      id={`pane-${session.id}`}
      className={`terminal-pane${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-label={`${session.title} 终端`}
      aria-hidden={!active}
    >
      <div className="terminal-pane__bar">
        <span className={`terminal-pane__state terminal-pane__state--${session.status}`}>
          <StatusDot
            tone={
              session.status === 'reconnecting'
                ? 'connecting'
                : session.status === 'closed'
                  ? 'idle'
                  : session.status
            }
          />
          <span className="truncate">{statusText}</span>
        </span>
        {host && <span className="terminal-pane__addr mono truncate">{formatAddress(host)}</span>}
        <span className="terminal-pane__tools">
          <button type="button" className="terminal-pane__tool" onClick={copySelection} title="复制选中内容 (Ctrl+Shift+C)" aria-label="复制选中内容">
            <Icon name="copy" size={13} />
          </button>
          <button
            type="button"
            className="terminal-pane__tool"
            onClick={() => terminalRef.current?.clear()}
            title="清空终端"
            aria-label="清空终端"
          >
            <Icon name="minus" size={13} />
          </button>
          <button
            type="button"
            className="terminal-pane__tool"
            onClick={reconnect}
            disabled={busy}
            title="重新连接"
            aria-label="重新连接"
          >
            <Icon name="refresh" size={13} />
          </button>
        </span>
      </div>

      <div className="terminal-pane__screen">
        <div ref={containerRef} className="terminal-pane__xterm" />
        {!host && (
          <div className="terminal-pane__overlay">
            <p>主机已被删除，无法建立连接。</p>
            <button type="button" onClick={() => actions.requestCloseSession(session.id)}>
              关闭标签页
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
