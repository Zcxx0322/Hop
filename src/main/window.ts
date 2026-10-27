import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import { createLogger } from './core/logger';

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

  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 960,
    minHeight: 560,
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

  win.once('ready-to-show', () => {
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
