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

  /* pushed events (webContents.send) */
  evData: 'hop:session:data',
  evStatus: 'hop:session:status',
  evClosed: 'hop:session:closed',
  evHostKey: 'hop:hostkey:challenge',
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];
