import { app, session, type Session } from 'electron';
import path from 'node:path';
import { CH } from '../shared/channels';
import type { HopError, HostKeyChallenge, SessionSnapshot } from '../shared/contract';
import { KnownHostsStore } from './core/known-hosts';
import { flushLogger, initLogger, createLogger } from './core/logger';
import { ProfileStore } from './core/profile-store';
import { SecretStore } from './core/secret-store';
import { SessionManager } from './core/session-manager';
import { registerIpc } from './ipc/register';
import { startGateway, type GatewayHandle } from './server/gateway';
import { broadcast, createMainWindow, focusMainWindow, getMainWindow } from './window';

const isDev = !app.isPackaged;
const devServerUrl = isDev ? process.env.HOP_DEV_SERVER_URL : undefined;

app.setName('Hop');
app.setAppUserModelId('com.hop.ssh');

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
    { profiles, knownHosts },
  );

  registerIpc({ profiles, knownHosts, sessions, secureStorage: secrets.isSecure });

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
    customTitleBar: process.env.HOP_CUSTOM_TITLEBAR === '1',
  });

  app.on('activate', () => {
    if (!getMainWindow()) {
      createMainWindow({
        devServerUrl,
        rendererEntry: path.join(__dirname, '../renderer/index.html'),
        customTitleBar: process.env.HOP_CUSTOM_TITLEBAR === '1',
      });
    }
  });

  app.on('before-quit', () => {
    log.info('shutting down');
    sessions.closeAll();
    void gateway?.close();
    gateway = null;
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
