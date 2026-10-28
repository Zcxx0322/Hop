import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import { createLogger } from './core/logger';
import { JsonStore } from './core/json-store';

const log = createLogger('window');

let mainWindow: BrowserWindow | null = null;

const BACKGROUND = '#000000';

/**
 * 256 px master from `build/icons/`. Packaged Windows builds take their icon
 * from `win.icon` in electron-builder.yml, so a missing file is not fatal —
 * it only matters for the window/taskbar in dev and on Linux.
 */
function windowIcon(): string | undefined {
  const file = path.join(app.getAppPath(), 'build/icons/icon-256.png');
  return fs.existsSync(file) ? file : undefined;
}

export interface WindowOptions {
  /** Vite dev server URL, e.g. http://localhost:5173 */
  devServerUrl?: string;
  /** Renderer entry for the packaged app. */
  rendererEntry: string;
}

/* ---------- 窗口几何记忆 ---------- */

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1380, height: 880, maximized: false };
const MIN_WIDTH = 960;
const MIN_HEIGHT = 560;

let boundsStore: JsonStore<WindowBounds> | null = null;

function getBoundsStore(): JsonStore<WindowBounds> {
  if (!boundsStore) {
    boundsStore = new JsonStore<WindowBounds>(
      path.join(app.getPath('userData'), 'window.json'),
      () => DEFAULT_BOUNDS,
    );
  }
  return boundsStore;
}

/** 只有窗口至少有一部分落在某个显示器的工作区里才恢复位置，避免换屏后跑到看不见的地方。 */
function isOnScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= 120 && overlapY >= 60;
  });
}

function restoreBounds(): { bounds: WindowBounds; usable: boolean } {
  const saved = getBoundsStore().read();
  const width = Number.isFinite(saved.width) && saved.width >= MIN_WIDTH ? saved.width : DEFAULT_BOUNDS.width;
  const height = Number.isFinite(saved.height) && saved.height >= MIN_HEIGHT ? saved.height : DEFAULT_BOUNDS.height;
  const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);
  if (hasPosition && isOnScreen({ x: saved.x as number, y: saved.y as number, width, height })) {
    return { bounds: { x: saved.x, y: saved.y, width, height, maximized: Boolean(saved.maximized) }, usable: true };
  }
  return { bounds: { width, height, maximized: Boolean(saved.maximized) }, usable: false };
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const current = getBoundsStore().read();
  const bounds = win.getNormalBounds();
  const next: WindowBounds = maximized
    ? { ...current, width: bounds.width, height: bounds.height, maximized: true }
    : {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: false,
      };
  if (next.width < MIN_WIDTH || next.height < MIN_HEIGHT) return;
  getBoundsStore().write(next);
}

/** Window-chrome IPC is registered once per process, not per window. */
let windowIpcReady = false;

function registerWindowIpc(): void {
  if (windowIpcReady) return;
  windowIpcReady = true;

  ipcMain.handle(CH.windowMinimize, () => {
    getMainWindow()?.minimize();
    return { ok: true, data: true } as const;
  });
  ipcMain.handle(CH.windowToggleMaximize, () => {
    const win = getMainWindow();
    if (!win) return { ok: true, data: false } as const;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, data: win.isMaximized() } as const;
  });
  ipcMain.handle(CH.windowClose, () => {
    getMainWindow()?.close();
    return { ok: true, data: true } as const;
  });
  ipcMain.handle(CH.windowIsMaximized, () => ({
    ok: true,
    data: Boolean(getMainWindow()?.isMaximized()),
  }));
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  registerWindowIpc();

  const { bounds: savedBounds, usable } = restoreBounds();

  const win = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    ...(usable ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: BACKGROUND,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    roundedCorners: true,
    autoHideMenuBar: true,
    title: 'Hop',
    ...(windowIcon() ? { icon: windowIcon() as string } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  const pushMaximized = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(CH.evWindowMaximize, win.isMaximized());
  };
  win.on('maximize', pushMaximized);
  win.on('unmaximize', pushMaximized);

  /* 关窗前把几何写盘；移动/缩放时也做一次防抖保存，进程被杀也不会丢。 */
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistBounds(win);
    }, 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistBounds(win);
  });

  win.once('ready-to-show', () => {
    if (savedBounds.maximized) win.maximize();
    win.show();
    if (process.env.HOP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // External links belong in the user's browser, never in an app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const target = options.devServerUrl;
    if (target && url.startsWith(target)) return; // vite HMR navigations
    event.preventDefault();
    log.warn('blocked navigation', { url });
  });

  if (options.devServerUrl) {
    log.info('loading dev server', { url: options.devServerUrl });
    void win.loadURL(options.devServerUrl);
  } else {
    log.info('loading renderer', { file: options.rendererEntry });
    void win.loadFile(options.rendererEntry);
  }

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Push an event to the renderer; a closed window simply drops it. */
export function broadcast(channel: string, payload: unknown): void {
  const win = getMainWindow();
  if (!win) return;
  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    log.warn('broadcast failed', { channel, err: String(err) });
  }
}

export function focusMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}
