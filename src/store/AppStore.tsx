import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { getHostRepository } from '../api/hostRepository';
import { ensureTransportConfig } from '../api/config';
import { useSystemTheme, type ResolvedTheme } from '../hooks/useSystemTheme';
import type { Host, HostDraft, Session, Settings, Toast } from '../types';
import { createId, errorMessage } from '../lib/utils';
import { toHostDraft } from '../lib/host';
import { loadSettings, saveSettings } from './settings';

interface UiState {
  settingsOpen: boolean;
  paletteOpen: boolean;
  /** null 表示关闭；hostId 为 null 表示「新建」 */
  hostForm: { hostId: string | null } | null;
  pendingCloseSessionId: string | null;
  pendingDeleteHostId: string | null;
  /** 右侧常驻面板：文件 / 主机状态 */
  dockFiles: boolean;
  dockMonitor: boolean;
  /** 主视图：终端工作区 / 资产页 / 笔记页 */
  page: 'terminal' | 'assets' | 'notes';
  /** 终端页上的速记浮层 */
  quickNote: boolean;
}

export interface AppState {
  hosts: Host[];
  hostsLoaded: boolean;
  hostsError: string | null;
  sessions: Session[];
  activeSessionId: string | null;
  settings: Settings;
  toasts: Toast[];
  ui: UiState;
}

type Action =
  | { type: 'hosts/loaded'; hosts?: Host[]; error?: string }
  | { type: 'hosts/upsert'; host: Host }
  | { type: 'hosts/removed'; id: string }
  | { type: 'session/connect'; sessionId: string; host: Host; now: number }
  | { type: 'session/update'; id: string; patch: Partial<Session> }
  | { type: 'session/close'; id: string }
  | { type: 'session/activate'; id: string }
  | { type: 'settings/patch'; patch: Partial<Settings> }
  | { type: 'ui/patch'; patch: Partial<UiState> }
  | { type: 'ui/toggle-dock'; pane: 'files' | 'monitor' }
  | { type: 'ui/toggle-quick-note' }
  | { type: 'toast/add'; toast: Toast }
  | { type: 'toast/dismiss'; id: string };

function createInitialState(): AppState {
  return {
    hosts: [],
    hostsLoaded: false,
    hostsError: null,
    sessions: [],
    activeSessionId: null,
    settings: loadSettings(),
    toasts: [],
    ui: {
      page: 'terminal',
      quickNote: false,
      settingsOpen: false,
      paletteOpen: false,
      hostForm: null,
      pendingCloseSessionId: null,
      pendingDeleteHostId: null,
      dockFiles: false,
      dockMonitor: false,
    },
  };
}

/**
 * 同一台主机可以并行开多个会话，标签名按开session顺序追加序号：
 * 「生产 Web 网关」「生产 Web 网关 (2)」……
 * 主机改名或会话关闭后统一重算，避免出现「(3) 却只有两个标签」的断号。
 */
function retitleSessions(sessions: Session[], hosts: Host[]): Session[] {
  const seen = new Map<string, number>();
  let changed = false;
  const next = sessions.map((session) => {
    const order = (seen.get(session.hostId) ?? 0) + 1;
    seen.set(session.hostId, order);
    const base = hosts.find((host) => host.id === session.hostId)?.name ?? session.title.replace(/ \(\d+\)$/, '');
    const title = order === 1 ? base : `${base} (${order})`;
    if (title === session.title) return session;
    changed = true;
    return { ...session, title };
  });
  return changed ? next : sessions;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hosts/loaded': {
      /* 拉取失败时保留已有列表：后端偶尔抖动不该把侧栏清空 */
      const hosts = action.hosts ?? state.hosts;
      return {
        ...state,
        hosts,
        hostsLoaded: true,
        hostsError: action.error ?? null,
        sessions: retitleSessions(state.sessions, hosts),
      };
    }

    case 'hosts/upsert': {
      const exists = state.hosts.some((host) => host.id === action.host.id);
      const hosts = exists
        ? state.hosts.map((host) => (host.id === action.host.id ? action.host : host))
        : [action.host, ...state.hosts];
      return {
        ...state,
        hostsLoaded: true,
        hosts,
        sessions: retitleSessions(state.sessions, hosts),
      };
    }

    case 'hosts/removed':
      return {
        ...state,
        hosts: state.hosts.filter((host) => host.id !== action.id),
        ui: {
          ...state.ui,
          pendingDeleteHostId:
            state.ui.pendingDeleteHostId === action.id ? null : state.ui.pendingDeleteHostId,
        },
      };

    case 'session/connect': {
      /* 新建会话时把文件传输和主机状态一起展开，开箱即用 */
      const ui = { ...state.ui, paletteOpen: false, dockFiles: true, dockMonitor: true };
      const session: Session = {
        id: action.sessionId,
        hostId: action.host.id,
        title: action.host.name,
        address: `${action.host.username}@${action.host.host}:${action.host.port}`,
        status: 'connecting',
        createdAt: action.now,
      };
      return {
        ...state,
        /* 同一主机允许并行多个会话：每次点击都新开一个标签，序号由 retitleSessions 统一分配 */
        sessions: retitleSessions([...state.sessions, session], state.hosts),
        activeSessionId: session.id,
        ui,
      };
    }

    case 'session/update':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, ...action.patch } : session,
        ),
      };

    case 'session/close': {
      const index = state.sessions.findIndex((session) => session.id === action.id);
      if (index === -1) return state;
      const sessions = state.sessions.filter((session) => session.id !== action.id);
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === action.id) {
        const neighbour = sessions[Math.min(index, sessions.length - 1)];
        activeSessionId = neighbour ? neighbour.id : null;
      }
      return {
        ...state,
        sessions: retitleSessions(sessions, state.hosts),
        activeSessionId,
        ui: {
          ...state.ui,
          pendingCloseSessionId:
            state.ui.pendingCloseSessionId === action.id
              ? null
              : state.ui.pendingCloseSessionId,
        },
      };
    }

    case 'session/activate':
      return {
        ...state,
        activeSessionId: action.id,
        ui: { ...state.ui },
      };

    case 'settings/patch':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'ui/patch':
      return { ...state, ui: { ...state.ui, ...action.patch } };

    case 'ui/toggle-quick-note':
      return { ...state, ui: { ...state.ui, quickNote: !state.ui.quickNote } };

    case 'ui/toggle-dock':
      return {
        ...state,
        ui: {
          ...state.ui,
          dockFiles: action.pane === 'files' ? !state.ui.dockFiles : state.ui.dockFiles,
          dockMonitor: action.pane === 'monitor' ? !state.ui.dockMonitor : state.ui.dockMonitor,
        },
      };

    case 'toast/add':
      return { ...state, toasts: [...state.toasts, action.toast].slice(-4) };

    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };

    default:
      return state;
  }
}

export interface AppActions {
  refreshHosts: () => Promise<void>;
  createHost: (draft: HostDraft) => Promise<Host | null>;
  updateHost: (id: string, draft: HostDraft) => Promise<Host | null>;
  toggleFavorite: (host: Host) => Promise<void>;
  requestDeleteHost: (id: string) => void;
  confirmDeleteHost: () => void;
  cancelDeleteHost: () => void;
  deleteHost: (id: string) => Promise<void>;
  connectHost: (host: Host) => void;
  updateSession: (id: string, patch: Partial<Session>) => void;
  activateSession: (id: string) => void;
  requestCloseSession: (id: string) => void;
  confirmCloseSession: () => void;
  cancelCloseSession: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  openHostForm: (hostId?: string | null) => void;
  setPage: (page: 'terminal' | 'assets' | 'notes') => void;
  closeHostForm: () => void;
  /** 右侧常驻面板：开关文件 / 主机状态，以及整体展开 */
  toggleQuickNote: () => void;
  toggleDockFiles: () => void;
  toggleDockMonitor: () => void;
  closeDockFiles: () => void;
  closeDockMonitor: () => void;
  expandDock: () => void;
  toast: (tone: Toast['tone'], message: string) => void;
  dismissToast: (id: string) => void;
}

interface AppContextValue {
  state: AppState;
  resolvedTheme: ResolvedTheme;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const repository = useMemo(() => getHostRepository(), []);
  const systemTheme = useSystemTheme();
  const toastTimers = useRef<number[]>([]);

  const resolvedTheme: ResolvedTheme =
    state.settings.theme === 'system' ? systemTheme : state.settings.theme;

  /* ---------- 主题落到 <html> 上，CSS 变量随之切换 ---------- */
  /* 用 layout effect：子组件的被动 effect（如终端主题）必须读到已切换的 CSS 变量 */
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.accent = state.settings.accent;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#000000' : '#ffffff');
  }, [resolvedTheme, state.settings.accent]);

  /* ---------- 偏好持久化 ---------- */
  useEffect(() => {
    saveSettings(state.settings);
  }, [state.settings]);

  useEffect(
    () => () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: 'toast/dismiss', id });
  }, []);

  const toast = useCallback((tone: Toast['tone'], message: string) => {
    const id = createId('toast');
    dispatch({ type: 'toast/add', toast: { id, tone, message } });
    const timer = window.setTimeout(() => {
      dispatch({ type: 'toast/dismiss', id });
      toastTimers.current = toastTimers.current.filter((item) => item !== timer);
    }, 3800);
    toastTimers.current.push(timer);
  }, []);

  const refreshHosts = useCallback(async () => {
    await ensureTransportConfig();
    try {
      const hosts = await getHostRepository().list();
      dispatch({ type: 'hosts/loaded', hosts });
    } catch (error) {
      dispatch({
        type: 'hosts/loaded',
        error: errorMessage(error, '加载主机列表失败'),
      });
    }
  }, []);

  useEffect(() => {
    void refreshHosts();
  }, [refreshHosts]);

  const createHost = useCallback(
    async (draft: HostDraft) => {
      try {
        const host = await repository.create(draft);
        dispatch({ type: 'hosts/upsert', host });
        dispatch({ type: 'ui/patch', patch: { hostForm: null } });
        toast('success', `已保存「${host.name}」`);
        return host;
      } catch (error) {
        toast('error', errorMessage(error, '保存主机失败'));
        return null;
      }
    },
    [repository, toast],
  );

  const updateHost = useCallback(
    async (id: string, draft: HostDraft) => {
      try {
        const host = await repository.update(id, draft);
        dispatch({ type: 'hosts/upsert', host });
        dispatch({ type: 'ui/patch', patch: { hostForm: null } });
        toast('success', `已更新「${host.name}」`);
        return host;
      } catch (error) {
        toast('error', errorMessage(error, '更新主机失败'));
        return null;
      }
    },
    [repository, toast],
  );

  const deleteHost = useCallback(
    async (id: string) => {
      try {
        await repository.remove(id);
        dispatch({ type: 'hosts/removed', id });
        toast('success', '主机已删除');
      } catch (error) {
        toast('error', errorMessage(error, '删除主机失败'));
      }
    },
    [repository, toast],
  );

  const toggleFavorite = useCallback(
    async (host: Host) => {
      try {
        const next = await repository.update(host.id, {
          ...toHostDraft(host),
          favorite: !host.favorite,
        });
        dispatch({ type: 'hosts/upsert', host: next });
      } catch (error) {
        toast('error', errorMessage(error, '更新收藏失败'));
      }
    },
    [repository, toast],
  );

  const requestDeleteHost = useCallback((id: string) => {
    dispatch({ type: 'ui/patch', patch: { pendingDeleteHostId: id } });
  }, []);

  const cancelDeleteHost = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { pendingDeleteHostId: null } });
  }, []);

  const confirmDeleteHost = useCallback(() => {
    const id = state.ui.pendingDeleteHostId;
    if (!id) return;
    dispatch({ type: 'ui/patch', patch: { pendingDeleteHostId: null } });
    void deleteHost(id);
  }, [state.ui.pendingDeleteHostId, deleteHost]);

  const connectHost = useCallback((host: Host) => {
    dispatch({
      type: 'session/connect',
      sessionId: createId('session'),
      host,
      now: Date.now(),
    });
    dispatch({ type: 'ui/patch', patch: { page: 'terminal' } });
  }, []);

  const updateSession = useCallback((id: string, patch: Partial<Session>) => {
    dispatch({ type: 'session/update', id, patch });
  }, []);

  const activateSession = useCallback((id: string) => {
    dispatch({ type: 'session/activate', id });
  }, []);

  const requestCloseSession = useCallback(
    (id: string) => {
      const session = state.sessions.find((item) => item.id === id);
      if (!session) return;
      const needsConfirm =
        state.settings.confirmOnClose &&
        (session.status === 'connected' || session.status === 'connecting');
      if (needsConfirm) {
        dispatch({ type: 'ui/patch', patch: { pendingCloseSessionId: id } });
      } else {
        dispatch({ type: 'session/close', id });
      }
    },
    [state.sessions, state.settings.confirmOnClose],
  );

  const confirmCloseSession = useCallback(() => {
    const id = state.ui.pendingCloseSessionId;
    if (id) dispatch({ type: 'session/close', id });
  }, [state.ui.pendingCloseSessionId]);

  const cancelCloseSession = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { pendingCloseSessionId: null } });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    dispatch({ type: 'settings/patch', patch });
  }, []);

  const setSettingsOpen = useCallback((open: boolean) => {
    dispatch({ type: 'ui/patch', patch: { settingsOpen: open } });
  }, []);

  const setPaletteOpen = useCallback((open: boolean) => {
    dispatch({ type: 'ui/patch', patch: { paletteOpen: open } });
  }, []);

  const openHostForm = useCallback((hostId: string | null = null) => {
    dispatch({ type: 'ui/patch', patch: { hostForm: { hostId } } });
  }, []);

  const closeHostForm = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { hostForm: null } });
  }, []);

  const setPage = useCallback((page: 'terminal' | 'assets' | 'notes') => {
    dispatch({ type: 'ui/patch', patch: { page } });
  }, []);

  const toggleQuickNote = useCallback(() => {
    dispatch({ type: 'ui/toggle-quick-note' });
  }, []);

  const toggleDockFiles = useCallback(() => {
    dispatch({ type: 'ui/toggle-dock', pane: 'files' });
  }, []);

  const toggleDockMonitor = useCallback(() => {
    dispatch({ type: 'ui/toggle-dock', pane: 'monitor' });
  }, []);

  const closeDockFiles = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { dockFiles: false } });
  }, []);

  const closeDockMonitor = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { dockMonitor: false } });
  }, []);

  const expandDock = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { dockFiles: true, dockMonitor: true } });
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      refreshHosts,
      createHost,
      updateHost,
      toggleFavorite,
      requestDeleteHost,
      confirmDeleteHost,
      cancelDeleteHost,
      deleteHost,
      connectHost,
      updateSession,
      activateSession,
      requestCloseSession,
      confirmCloseSession,
      cancelCloseSession,
      updateSettings,
      setSettingsOpen,
      setPaletteOpen,
      openHostForm,
      setPage,
      closeHostForm,
      toggleQuickNote,
      toggleDockFiles,
      toggleDockMonitor,
      closeDockFiles,
      closeDockMonitor,
      expandDock,
      toast,
      dismissToast,
    }),
    [
      refreshHosts,
      createHost,
      updateHost,
      toggleFavorite,
      requestDeleteHost,
      confirmDeleteHost,
      cancelDeleteHost,
      deleteHost,
      connectHost,
      updateSession,
      activateSession,
      requestCloseSession,
      confirmCloseSession,
      cancelCloseSession,
      updateSettings,
      setSettingsOpen,
      setPaletteOpen,
      openHostForm,
      setPage,
      closeHostForm,
      toggleQuickNote,
      toggleDockFiles,
      toggleDockMonitor,
      closeDockFiles,
      closeDockMonitor,
      expandDock,
      toast,
      dismissToast,
    ],
  );

  const value = useMemo<AppContextValue>(
    () => ({ state, resolvedTheme, actions }),
    [state, resolvedTheme, actions],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp 必须在 <AppProvider> 内使用');
  return context;
}
