import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { Host, Session } from '../types';
import { createTransport } from '../api/createTransport';
import { extractOsc7, inferCd, terminalCwd } from '../store/cwd';
import type { TerminalTransport } from '../api/transport';
import { useApp } from '../store/AppStore';
import { FONT_STACKS } from '../store/settings';
import { copyText, readClipboardText, toPlainText } from '../lib/clipboard';
import { ConnectFX } from './ConnectFX';
import './TerminalPane.css';

interface TerminalPaneProps {
  session: Session;
  host: Host | null;
  active: boolean;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

const ANSI_DARK = {
  black: '#1a1f1b',
  red: '#ff5f57',
  green: '#2ee66b',
  yellow: '#e5b454',
  blue: '#4aa8ff',
  magenta: '#c792ea',
  cyan: '#33d6d6',
  white: '#cfd8d3',
  brightBlack: '#5f6a62',
  brightRed: '#ff8a84',
  brightGreen: '#7bf5a3',
  brightYellow: '#f2cf87',
  brightBlue: '#7cc4ff',
  brightMagenta: '#dcb6f5',
  brightCyan: '#71ecec',
  brightWhite: '#f2f7f3',
} as const;

const ANSI_LIGHT = {
  black: '#16201b',
  red: '#c62828',
  green: '#0f9d58',
  yellow: '#9a6b06',
  blue: '#1a6fd4',
  magenta: '#8e44ad',
  cyan: '#0e7c86',
  white: '#5b6662',
  brightBlack: '#7d877f',
  brightRed: '#e03a34',
  brightGreen: '#12a150',
  brightYellow: '#b8860b',
  brightBlue: '#3d8ee8',
  brightMagenta: '#a95fc4',
  brightCyan: '#1298a3',
  brightWhite: '#0c120e',
} as const;

function readTerminalTheme(light: boolean) {
  const styles = getComputedStyle(document.documentElement);
  const background = readVar(styles, '--term-bg', light ? '#ffffff' : '#000000');
  return {
    background,
    foreground: readVar(styles, '--term-fg', light ? '#16201b' : '#cfd8d3'),
    cursor: readVar(styles, '--term-cursor', light ? '#12a150' : '#2ee66b'),
    cursorAccent: background,
    selectionBackground: readVar(styles, '--term-selection', light ? 'rgba(18,161,80,.18)' : 'rgba(46,230,107,.24)'),
    selectionInactiveBackground: light ? 'rgba(18,161,80,.12)' : 'rgba(46,230,107,.14)',
    ...(light ? ANSI_LIGHT : ANSI_DARK),
  };
}

export function TerminalPane({ session, host, active }: TerminalPaneProps) {
  const { state, resolvedTheme, actions } = useApp();
  const { settings } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const transportRef = useRef<TerminalTransport | null>(null);
  /* 连接时取一次主机快照：之后即使主机被改名或删除，已建立的会话也不该被掐断 */
  const hostRef = useRef<Host | null>(host);
  hostRef.current = host;
  /* 复制/粘贴策略在终端创建后仍要随设置变化，用 ref 读最新值 */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const copySelection = useCallback(
    (options?: { silent?: boolean; onlyIfSelected?: boolean }) => {
      const term = terminalRef.current;
      const raw = term?.getSelection() ?? '';
      const selection = toPlainText(raw);
      if (!selection) {
        if (options?.onlyIfSelected) return false;
        actions.toast('info', '先在终端里选中要复制的文本');
        return false;
      }
      void copyText(selection).then((ok) => {
        if (!options?.silent) {
          if (ok) actions.toast('success', '已复制到剪贴板');
          else actions.toast('error', '剪贴板不可用，复制失败');
        }
      });
      return true;
    },
    [actions],
  );

  const pasteClipboard = useCallback(async () => {
    const term = terminalRef.current;
    if (!term) return;
    const text = await readClipboardText();
    if (!text) return;
    term.paste(text);
    term.focus();
  }, []);

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
      macOptionIsMeta: true,
      theme: readTerminalTheme(resolvedTheme === 'light'),
      allowTransparency: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    terminalRef.current = term;
    fitRef.current = fit;

    /*
     * WebGL 渲染器：连续输入 / 大段输出时帧率明显高于 DOM 渲染器。
     * 显卡或驱动不可用时安静回退到默认渲染器。
     */
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try {
          webgl.dispose();
        } catch {
          /* 上下文已丢失 */
        }
      });
      term.loadAddon(webgl);
      webglRef.current = webgl;
    } catch {
      webglRef.current = null;
    }

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

    /* 选中即复制：终端里拖选一下就能直接粘贴到别处；静默复制，不出提示 */
    const selectionDisposable = term.onSelectionChange(() => {
      if (!settingsRef.current.copyOnSelect) return;
      copySelection({ silent: true, onlyIfSelected: true });
    });

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      /* 回车前从输入行里认出 cd，用于「文件栏跟随终端目录」 */
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const buffer = term.buffer.active;
        const line = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? '';
        const typed = line.slice(0, buffer.cursorX);
        const current = (hostRef.current && terminalCwd.get(hostRef.current.id)) || '~';
        const next = inferCd(current, typed);
        if (next && hostRef.current) terminalCwd.set(hostRef.current.id, next);
      }

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const { pasteMode, copyShortcut } = settingsRef.current;

      /* Ctrl+C：有选中时复制，没有选中时保持 shell 的中断语义 */
      if (copyShortcut === 'ctrl-c' && mod && !event.shiftKey && key === 'c') {
        if (term.hasSelection()) {
          event.preventDefault();
          event.stopPropagation();
          copySelection({ silent: !settingsRef.current.copyToast });
          return false;
        }
        return true;
      }

      if (mod && event.shiftKey && key === 'c') {
        /* 阻止浏览器原生复制，避免与手动写入剪贴板重复 */
        event.preventDefault();
        event.stopPropagation();
        copySelection({ silent: !settingsRef.current.copyToast });
        return false;
      }

      if (pasteMode === 'ctrl-v' && mod && key === 'v') {
        event.preventDefault();
        event.stopPropagation();
        void pasteClipboard();
        return false;
      }
      if (pasteMode === 'ctrl-v' && event.shiftKey && key === 'insert') {
        event.preventDefault();
        event.stopPropagation();
        void pasteClipboard();
        return false;
      }
      return true;
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dataDisposable.dispose();
      selectionDisposable.dispose();
      try {
        webglRef.current?.dispose();
      } catch {
        /* 已失效 */
      }
      webglRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // 每个标签页一个独立终端实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /* ---------- 连接传输层 ---------- */
  useEffect(() => {
    const target = hostRef.current;
    if (!target) return;
    const term = terminalRef.current;
    if (!term) return;

    const transport = createTransport();
    transportRef.current = transport;

    /* 手动重连时清屏，避免旧输出与新会话混淆；状态提示交给连接动效层 */
    if (session.reconnectNonce) {
      term.reset();
    }

    const offData = transport.onData((chunk) => {
      terminalRef.current?.write(chunk);
      const cwd = extractOsc7(chunk);
      if (cwd) terminalCwd.set(target.id, cwd);
    });
    const offStatus = transport.onStatus((status, detail) => {
      actions.updateSession(session.id, { status, detail });
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
      host: target,
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
    // 重连通过 reconnectNonce 递增触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.reconnectNonce]);

  /* ---------- 外观设置实时生效 ---------- */
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = FONT_STACKS[settings.fontFamily].stack;
    term.options.fontSize = settings.fontSize;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    term.options.theme = readTerminalTheme(resolvedTheme === 'light');
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

  return (
    <section
      id={`pane-${session.id}`}
      className={`terminal-pane${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-label={`${session.title} 终端`}
      aria-hidden={!active}
      inert={!active}
    >
      <div
        className="terminal-pane__screen"
        onContextMenu={(event) => {
          /* 右键直接粘贴；其余模式交回系统 */
          if (settings.pasteMode !== 'right-click') return;
          event.preventDefault();
          void pasteClipboard();
        }}
      >
        <div className="terminal-pane__xterm">
          <div ref={containerRef} className="terminal-pane__fit" />
        </div>
        <ConnectFX session={session} host={host} />
        {!host && session.status !== 'connected' && (
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
