import { app, session, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import type { HopError, HostKeyChallenge, SessionSnapshot } from '../shared/contract';
import { KnownHostsStore } from './core/known-hosts';
import { flushLogger, initLogger, createLogger } from './core/logger';
import { ProfileStore } from './core/profile-store';
import { RemotePool } from './core/remote';
import { SecretStore } from './core/secret-store';
import { SessionManager } from './core/session-manager';
import { detectDistro } from './core/distro';
import { SftpService } from './core/sftp-service';
import { MonitorService } from './core/monitor-service';
import { registerIpc } from './ipc/register';
import { startGateway, type GatewayHandle } from './server/gateway';
import { broadcast, createMainWindow, focusMainWindow, getMainWindow } from './window';

const isDev = !app.isPackaged;
const devServerUrl = isDev ? process.env.HOP_DEV_SERVER_URL : undefined;

app.setName('Hop');
app.setAppUserModelId('com.hop.ssh');

/**
 * Portable installs (a `data` folder next to Hop.exe, VS Code convention) keep every
 * profile file beside the binary; otherwise data lives in %APPDATA%\Hop.
 * Must run before the single-instance lock, which is keyed on the userData path.
 */
function resolvePortableUserData(): string | null {
  const override = process.env.HOP_USER_DATA;
  if (override) return override;
  if (!app.isPackaged) return null;
  const sibling = path.join(path.dirname(app.getPath('exe')), 'data');
  return fs.existsSync(sibling) ? sibling : null;
}

const portableData = resolvePortableUserData();
if (portableData) {
  try {
    fs.mkdirSync(portableData, { recursive: true });
    app.setPath('userData', portableData);
  } catch {
    // Fall back to %APPDATA%\Hop when the portable folder is not writable.
  }
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());
  void app.whenReady().then(bootstrap);
}

const log = createLogger('main');

let gateway: GatewayHandle | null = null;

/** Loopback HTTP+WS gateway port; 0 or HOP_GATEWAY=0 disables it. */
function gatewayPort(): number {
  if (process.env.HOP_GATEWAY === '0') return 0;
  const raw = process.env.HOP_GATEWAY_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : 47100;
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 65_536 ? parsed : 47100;
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  initLogger(path.join(userData, 'logs'));
  log.info('boot', {
    version: app.getVersion(),
    electron: process.versions.electron,
    userData,
    dev: isDev,
  });

  if (process.platform === 'win32') app.setAppUserModelId('com.hop.ssh');

  const secrets = new SecretStore(path.join(userData, 'secrets.dat'));
  await secrets.init();
  const profiles = new ProfileStore(path.join(userData, 'profiles.json'), secrets);
  const knownHosts = new KnownHostsStore(path.join(userData, 'known_hosts.json'));

  // 文件传输 / 资源监控 / 发行版探测共用同一条按主机复用的连接（空闲 45 秒回收）。
  const remotePool = new RemotePool({ profiles, knownHosts });

  /* 会话刚连上时顺手认一下远端发行版，写进 profile 供资产页显示图标。 */
  const detectAndStore = (profileId: string): void => {
    void remotePool
      .with(profileId, (client) => detectDistro(client))
      .then((distro) => {
        if (distro) profiles.setDistro(profileId, distro);
      })
      .catch((err: unknown) => {
        log.warn('distro detect failed', { profileId, err: String(err) });
      });
  };

  const sessions = new SessionManager(
    {
      onData(sessionId: string, data: string) {
        broadcast(CH.evData, { sessionId, data });
      },
      onStatus(snapshot: SessionSnapshot) {
        broadcast(CH.evStatus, snapshot);
      },
      onClosed(sessionId: string, reason: HopError | null) {
        broadcast(CH.evClosed, { sessionId, reason });
      },
      onHostKey(challenge: HostKeyChallenge) {
        broadcast(CH.evHostKey, challenge);
        const win = getMainWindow();
        if (win && !win.isFocused()) win.flashFrame(true);
      },
    },
    {
      profiles,
      knownHosts,
      /* 连上就顺手认一下远端发行版，写进 profile 供资产页显示图标。 */
      onReady: detectAndStore,
    },
  );

  registerIpc({ profiles, knownHosts, sessions, secureStorage: secrets.isSecure });

  const sftp = new SftpService({ profiles, knownHosts }, remotePool);
  const monitor = new MonitorService({ profiles, knownHosts }, remotePool);

  // The renderer talks REST + WebSocket over loopback (see docs/API-CONTRACT.md).
  // Both transports share the same stores, so credentials and known hosts are
  // identical no matter which one the UI uses.
  try {
    gateway = await startGateway({
      profiles,
      knownHosts,
      secureStorage: secrets.isSecure,
      appVersion: app.getVersion(),
      preferredPort: gatewayPort(),
      sftp,
      monitor,
      onSessionReady: detectAndStore,
    });
    if (gateway) log.info('gateway ready', { origin: gateway.origin });
  } catch (err) {
    log.error('gateway failed to start', { err: String(err) });
  }

  hardenSession(session.defaultSession, Boolean(devServerUrl));

  // `HOP_SMOKE=1` runs assertions against the loopback gateway and exits —
  // see `scripts/smoke.mjs`. Never enabled in normal runs.
  if (process.env.HOP_SMOKE === '1') {
    const { runSelfCheck } = await import('./dev-smoke');
    await runSelfCheck({ gateway, userData });
  }

  createMainWindow({
    devServerUrl,
    rendererEntry: path.join(__dirname, '../renderer/index.html'),
  });

  app.on('activate', () => {
    if (!getMainWindow()) {
      createMainWindow({
        devServerUrl,
        rendererEntry: path.join(__dirname, '../renderer/index.html'),
      });
    }
  });

  app.on('before-quit', () => {
    log.info('shutting down');
    sessions.closeAll();
    void gateway?.close();
    gateway = null;
    remotePool.dispose();
    flushLogger();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Content Security Policy + a couple of renderer hardening rules.
 * Dev keeps `unsafe-inline`/`ws:` only because Vite needs them for HMR.
 */
function hardenSession(target: Session, dev: boolean): void {
  const csp = dev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: http: https:",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // Loopback only: the renderer's REST/WS transport (docs/API-CONTRACT.md).
        "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');

  target.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  target.setPermissionRequestHandler((_contents, permission, callback) => {
    // The app has no business with camera / mic / geolocation etc.
    log.warn('permission denied', { permission });
    callback(false);
  });
}
