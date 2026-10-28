/**
 * IPC channel names — import these from main, preload (and tests).
 * The renderer never sees them: it only touches `window.hop`.
 *
 * Naming: `hop:<domain>:<action>` for requests,
 *         `hop:session:<event>` for pushed events.
 */
export const CH = {
  /* request / response (ipcMain.handle) */
  info: 'hop:app:info',
  pickPrivateKey: 'hop:app:pick-private-key',
  clipboardWrite: 'hop:app:clipboard-write',
  clipboardRead: 'hop:app:clipboard-read',

  profilesList: 'hop:profiles:list',
  profilesSave: 'hop:profiles:save',
  profilesRemove: 'hop:profiles:remove',
  profilesReorder: 'hop:profiles:reorder',

  sessionsList: 'hop:sessions:list',
  sessionsOpen: 'hop:sessions:open',
  sessionsWrite: 'hop:sessions:write',
  sessionsResize: 'hop:sessions:resize',
  sessionsClose: 'hop:sessions:close',

  knownHostsList: 'hop:knownhosts:list',
  knownHostsForget: 'hop:knownhosts:forget',
  hostKeyAnswer: 'hop:hostkey:answer',

  windowMinimize: 'hop:window:minimize',
  windowToggleMaximize: 'hop:window:toggle-maximize',
  windowClose: 'hop:window:close',
  windowIsMaximized: 'hop:window:is-maximized',

  /* pushed events (webContents.send) */
  evData: 'hop:session:data',
  evStatus: 'hop:session:status',
  evClosed: 'hop:session:closed',
  evHostKey: 'hop:hostkey:challenge',
  evWindowMaximize: 'hop:window:maximize-changed',
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];
