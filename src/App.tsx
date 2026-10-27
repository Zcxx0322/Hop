import { useEffect } from 'react';
import { useApp } from './store/AppStore';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
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

      if (typing) return;

      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        actions.openHostForm(null);
        return;
      }

      if (mod && event.key === ',') {
        event.preventDefault();
        actions.setSettingsOpen(true);
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
      <Sidebar />

      <main
        className={`workspace${hasSessions ? '' : ' workspace--empty'}`}
        aria-label="终端工作区"
      >
        {hasSessions && <TabBar sessions={sessions} activeSessionId={activeSessionId} />}

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
