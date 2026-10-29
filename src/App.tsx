import { useEffect } from 'react';
import { useApp } from './store/AppStore';
import { TitleBar } from './components/TitleBar';
import { TerminalPane } from './components/TerminalPane';
import { Welcome } from './components/Welcome';
import { AssetsPage } from './components/AssetsPage';
import { NotesPage } from './components/NotesPage';
import { QuickNotes } from './components/QuickNotes';
import { SideDock } from './components/SideDock';
import { TransfersBar } from './components/TransfersBar';
import { useTransferHost } from './store/transfers';
import { CommandPalette } from './components/CommandPalette';
import { HostFormDialog } from './components/HostFormDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts } from './components/ui/Toasts';
import './App.css';

export default function App() {
  const { state, actions } = useApp();
  const { sessions, activeSessionId, hosts, ui, settings } = state;
  const hasSessions = sessions.length > 0;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  /* 传输进度是全局的：始终跟随当前会话所属主机 */
  useTransferHost(activeSession?.hostId ?? null);

  const withFiles = hasSessions && ui.dockFiles;
  const withMonitor = hasSessions && ui.dockMonitor;

  /* 全局快捷键：命令面板 / 新建连接 / 设置 / 面板开关 / 切换会话 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable),
      );

      const modalOpen = ui.hostForm !== null || ui.settingsOpen || ui.paletteOpen;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        actions.setPaletteOpen(!ui.paletteOpen);
        return;
      }

      /* 设置面板是应用级入口：终端聚焦时也要能用（shell 里 Ctrl+, 无特殊语义） */
      if (mod && event.key === ',') {
        event.preventDefault();
        if (ui.settingsOpen) {
          actions.setSettingsOpen(false);
        } else {
          actions.setSettingsOpen(true);
        }
        return;
      }

      /* 新建连接：终端聚焦时也应该能按（shell 里 Ctrl+N 用得少） */
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (ui.hostForm || ui.settingsOpen) return;
        actions.setPaletteOpen(false);
        actions.openHostForm(null);
        return;
      }

      /* 关闭标签：终端聚焦时保留 shell 的 ^W，改用 Ctrl+Shift+W */
      if (mod && event.key.toLowerCase() === 'w') {
        if (modalOpen) return;
        if (typing && !event.shiftKey) return;
        event.preventDefault();
        if (activeSessionId) actions.requestCloseSession(activeSessionId);
        return;
      }

      /* 笔记：Ctrl+Shift+N 在终端页唤起速记浮层，在笔记页则回终端 */
      if (mod && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (ui.page === 'notes') actions.setPage('terminal');
        else actions.toggleQuickNote();
        return;
      }

      /* 文件传输 / 主机状态：作用于当前会话对应的主机，终端聚焦时也可用 */
      if (
        mod &&
        event.shiftKey &&
        (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'm')
      ) {
        const active = sessions.find((session) => session.id === activeSessionId) ?? null;
        if (!active) return;
        event.preventDefault();
        if (event.key.toLowerCase() === 'f') actions.toggleDockFiles();
        else actions.toggleDockMonitor();
        return;
      }

      /* 资产页按 Esc 回终端（输入框里也生效，但浮层打开时交给浮层） */
      if (event.key === 'Escape' && ui.page === 'assets' && !modalOpen) {
        actions.setPage('terminal');
        return;
      }

      if (typing) return;

      if (mod && /^[1-9]$/.test(event.key)) {
        const session = sessions[Number(event.key) - 1];
        if (session) {
          event.preventDefault();
          actions.activateSession(session.id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    actions,
    sessions,
    activeSessionId,
    ui.paletteOpen,
    ui.hostForm,
    ui.settingsOpen,
    ui.page,
    ui.dockFiles,
    ui.dockMonitor,
  ]);

  return (
    <div
      className="app-shell"
    >
      <TitleBar />

      {ui.page === 'assets' ? (
        <AssetsPage />
      ) : ui.page === 'notes' ? (
        <NotesPage />
      ) : (
      <main
        className={`workspace${hasSessions ? '' : ' workspace--empty'}${
          withFiles ? ' with-files' : ''
        }${withMonitor ? ' with-monitor' : ''}`}
        aria-label="终端工作区"
      >
        <SideDock side="files" />

        <div className="terminal-stack">
          {hasSessions ? (
            sessions.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                host={hosts.find((host) => host.id === session.hostId) ?? null}
                active={session.id === activeSessionId}
              />
            ))
          ) : (
            <Welcome />
          )}
        </div>

        <SideDock side="monitor" />

        {/* 速记只属于终端页：切到资产 / 笔记页时自动收起 */}
        {ui.page === 'terminal' && ui.quickNote && <QuickNotes />}
      </main>
      )}

      <TransfersBar />


      <CommandPalette />
      <HostFormDialog />
      <SettingsPanel />
      <ConfirmDialog />
      <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
    </div>
  );
}
