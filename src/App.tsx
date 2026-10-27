import { useEffect } from 'react';
import { useApp } from './store/AppStore';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { TerminalPane } from './components/TerminalPane';
import { Welcome } from './components/Welcome';
import { StatusBar } from './components/StatusBar';
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

  /* 全局快捷键：命令面板 / 新建连接 / 设置 / 折叠侧栏 / 切换会话 */
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

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        actions.setPaletteOpen(!ui.paletteOpen);
        return;
      }

      /* 设置面板是应用级入口：终端聚焦时也要能用（shell 里 Ctrl+, 无特殊语义） */
      if (mod && event.key === ',') {
        event.preventDefault();
        actions.setSettingsOpen(true);
        return;
      }

      if (typing) return;

      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        actions.openHostForm(null);
        return;
      }

      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        actions.toggleSidebar();
        return;
      }

      if (mod && /^[1-9]$/.test(event.key)) {
        const session = sessions[Number(event.key) - 1];
        if (session) {
          event.preventDefault();
          actions.activateSession(session.id);
        }
        return;
      }

      if (event.key === 'Escape' && ui.navOpen) {
        actions.setNavOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, sessions, ui.paletteOpen, ui.navOpen]);

  return (
    <div
      className="app-shell"
      data-collapsed={settings.sidebarCollapsed}
      data-nav-open={ui.navOpen}
    >
      <TitleBar />

      <Sidebar />

      <main
        className={`workspace${hasSessions ? '' : ' workspace--empty'}`}
        aria-label="终端工作区"
      >
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
      </main>

      <StatusBar />

      <button
        type="button"
        className="workspace-scrim"
        aria-label="关闭导航抽屉"
        onClick={() => actions.setNavOpen(false)}
      />

      <CommandPalette />
      <HostFormDialog />
      <SettingsPanel />
      <ConfirmDialog />
      <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
    </div>
  );
}
