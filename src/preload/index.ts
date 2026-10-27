import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../shared/channels';
import type {
  AppInfo,
  ConnectionProfile,
  HostKeyChallenge,
  IpcResult,
  KnownHostEntry,
  OpenSessionRequest,
  ProfileInput,
  ResizeRequest,
  SessionSnapshot,
  TerminalDataEvent,
  Unsubscribe,
} from '../shared/contract';

/**
 * Rejections carry the HopError through `contextBridge`.
 * Electron only preserves `message`/`name`/`stack` for real Error objects,
 * so we reject with a plain, structured-clonable object and let the renderer
 * read `.code`, `.message`, `.detail` directly.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result || typeof result !== 'object') {
    throw { code: 'INTERNAL', message: '主进程返回了无效响应' };
  }
  if (!result.ok) throw result.error;
  return result.data;
}

/**
 * Event plumbing with an early-subscription buffer.
 *
 * The renderer subscribes *after* `open()` resolves, while the first PTY
 * output (banner / motd) may already be on its way. Anything produced before
 * the first listener attaches is queued here and replayed on subscribe, so no
 * bytes are ever lost.
 */
function eventChannel<T>(channel: string, maxBuffered = 400): (listener: (payload: T) => void) => Unsubscribe {
  const listeners = new Set<(payload: T) => void>();
  let buffer: T[] = [];

  ipcRenderer.on(channel, (_event, payload: T) => {
    if (listeners.size === 0) {
      buffer.push(payload);
      if (buffer.length > maxBuffered) buffer.shift();
      return;
    }
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[hop] event listener failed', channel, err);
      }
    }
  });

  return (listener: (payload: T) => void): Unsubscribe => {
    listeners.add(listener);
    if (buffer.length) {
      const replay = buffer;
      buffer = [];
      for (const payload of replay) {
        try {
          listener(payload);
        } catch (err) {
          console.error('[hop] buffered event listener failed', channel, err);
        }
      }
    }
    return () => {
      listeners.delete(listener);
    };
  };
}

const onData = eventChannel<TerminalDataEvent>(CH.evData);
const onStatus = eventChannel<SessionSnapshot>(CH.evStatus);
const onClosed = eventChannel<{ sessionId: string; reason: { code: string; message: string } | null }>(CH.evClosed);
const onHostKey = eventChannel<HostKeyChallenge>(CH.evHostKey);

const api = {
  info: () => invoke<AppInfo>(CH.info),

  profiles: {
    list: () => invoke<ConnectionProfile[]>(CH.profilesList),
    save: (profile: ProfileInput) => invoke<ConnectionProfile>(CH.profilesSave, profile),
    remove: (id: string) => invoke<boolean>(CH.profilesRemove, { id }),
    reorder: (ids: string[]) => invoke<ConnectionProfile[]>(CH.profilesReorder, { ids }),
  },

  sessions: {
    list: () => invoke<SessionSnapshot[]>(CH.sessionsList),
    open: (request: OpenSessionRequest) => invoke<SessionSnapshot>(CH.sessionsOpen, request),
    write: (sessionId: string, data: string) =>
      invoke<boolean>(CH.sessionsWrite, { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      invoke<boolean>(CH.sessionsResize, { sessionId, cols, rows } satisfies ResizeRequest),
    close: (sessionId: string) => invoke<boolean>(CH.sessionsClose, { sessionId }),
  },

  knownHosts: {
    list: () => invoke<KnownHostEntry[]>(CH.knownHostsList),
    forget: (id: string) => invoke<KnownHostEntry[]>(CH.knownHostsForget, { id }),
  },

  pickPrivateKey: () =>
    invoke<{ canceled: boolean; path: string | null; fingerprint: string | null }>(CH.pickPrivateKey),

  answerHostKey: (requestId: string, accept: boolean, persist = accept) =>
    invoke<boolean>(CH.hostKeyAnswer, { requestId, accept, persist }),

  events: { onData, onStatus, onClosed, onHostKey },
};

export type HopBridge = typeof api;

contextBridge.exposeInMainWorld('hop', api);
