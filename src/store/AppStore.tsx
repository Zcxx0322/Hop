import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  navOpen: boolean;
  /** null 表示关闭；hostId 为 null 表示「新建」 */
  hostForm: { hostId: string | null } | null;
  pendingCloseSessionId: string | null;
  pendingDeleteHostId: string | null;
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
  | { type: 'hosts/loaded'; hosts: Host[]; error?: string }
  | { type: 'hosts/upsert'; host: Host }
  | { type: 'hosts/removed'; id: string }
  | { type: 'session/connect'; sessionId: string; host: Host; now: number }
  | { type: 'session/update'; id: string; patch: Partial<Session> }
  | { type: 'session/close'; id: string }
  | { type: 'session/activate'; id: string }
  | { type: 'settings/patch'; patch: Partial<Settings> }
  | { type: 'ui/patch'; patch: Partial<UiState> }
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
      settingsOpen: false,
      paletteOpen: false,
      navOpen: false,
      hostForm: null,
      pendingCloseSessionId: null,
      pendingDeleteHostId: null,
    },
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hosts/loaded':
      return {
        ...state,
        hosts: action.hosts,
        hostsLoaded: true,
        hostsError: action.error ?? null,
      };

    case 'hosts/upsert': {
      const exists = state.hosts.some((host) => host.id === action.host.id);
      return {
        ...state,
        hostsLoaded: true,
        hosts: exists
          ? state.hosts.map((host) => (host.id === action.host.id ? action.host : host))
          : [action.host, ...state.hosts],
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
      const existing = state.sessions.find((session) => session.hostId === action.host.id);
      const ui = { ...state.ui, paletteOpen: false, navOpen: false };
      if (existing) {
        return { ...state, activeSessionId: existing.id, ui };
      }
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
        sessions: [...state.sessions, session],
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
        sessions,
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
        ui: { ...state.ui, navOpen: false },
      };

    case 'settings/patch':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'ui/patch':
      return { ...state, ui: { ...state.ui, ...action.patch } };

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
  setNavOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  openHostForm: (hostId?: string | null) => void;
  closeHostForm: () => void;
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
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.accent = state.settings.accent;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#090c12' : '#f4f6fb');
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
        hosts: [],
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

  const setNavOpen = useCallback((open: boolean) => {
    dispatch({ type: 'ui/patch', patch: { navOpen: open } });
  }, []);

  const toggleSidebar = useCallback(() => {
    const isNarrow = window.matchMedia('(max-width: 980px)').matches;
    if (isNarrow) {
      dispatch({ type: 'ui/patch', patch: { navOpen: !state.ui.navOpen } });
      return;
    }
    dispatch({
      type: 'settings/patch',
      patch: { sidebarCollapsed: !state.settings.sidebarCollapsed },
    });
  }, [state.settings.sidebarCollapsed, state.ui.navOpen]);

  const openHostForm = useCallback((hostId: string | null = null) => {
    dispatch({ type: 'ui/patch', patch: { hostForm: { hostId } } });
  }, []);

  const closeHostForm = useCallback(() => {
    dispatch({ type: 'ui/patch', patch: { hostForm: null } });
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
      setNavOpen,
      toggleSidebar,
      openHostForm,
      closeHostForm,
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
      setNavOpen,
      toggleSidebar,
      openHostForm,
      closeHostForm,
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
