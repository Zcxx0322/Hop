/**
 * Hop — shared contract (v1)
 * ---------------------------------------------------------------
 * This file is the single source of truth for the boundary between
 * the Electron main process (SSH backend) and the renderer (UI).
 *
 * Both sides import ONLY types from here. It must never import
 * `electron`, `node:*` or any runtime module, so it can be bundled
 * into the sandboxed renderer safely.
 *
 * The wire format of every IPC channel is described in
 * docs/IPC-CONTRACT.md — keep both in sync when you change anything.
 */

export const CONTRACT_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export type HopErrorCode =
  | 'CONFIG_INVALID'
  | 'PROFILE_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'KEY_INVALID'
  | 'KEY_PASSPHRASE_REQUIRED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'HOST_KEY_REJECTED'
  | 'SHELL_FAILED'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'INTERNAL';

/** A serialisable error. Never throw raw Error instances across IPC. */
export interface HopError {
  code: HopErrorCode;
  /** Short, human readable, already localised for the end user. */
  message: string;
  /** Optional technical detail (stderr of ssh, stack, ...). */
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* Connection profiles                                                */
/* ------------------------------------------------------------------ */

export type AuthType = 'password' | 'privateKey' | 'agent';

/**
 * What the UI sends when creating/updating a profile.
 * Secrets are plain strings *here only*: the main process encrypts them
 * immediately with the OS keychain (DPAPI on Windows) and never echoes
 * them back. Omit a secret field to keep the previously stored value.
 */
export interface AuthInput {
  type: AuthType;
  /** type === 'password' */
  password?: string;
  /** type === 'privateKey': read the key from disk (preferred) … */
  privateKeyPath?: string;
  /** … or use the pasted key material. */
  privateKey?: string;
  /** type === 'privateKey' */
  passphrase?: string;
  /** type === 'agent' (defaults to the platform agent: OpenSSH auth socket,
   *  Pageant on Windows) */
  agentSocket?: string;
}

export interface JumpHostInput {
  host: string;
  port?: number;
  username: string;
  auth: AuthInput;
}

/** Payload for `profiles.save()`. `id` absent => create. */
export interface ProfileInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  auth: AuthInput;
  /** Optional bastion. TODO(v2): chain more than one. */
  jump?: JumpHostInput | null;
  /** Terminal preferences. */
  cols?: number;
  rows?: number;
  /** TERM value, default "xterm-256color". */
  term?: string;
  /** Keepalive interval in ms, 0 disables. Default 20000. */
  keepAliveMs?: number;
  /** UI accent, e.g. "#8b5cf6". Purely cosmetic, stored by the backend. */
  color?: string;
  /** Free-form tags used by the UI for grouping/filtering. */
  tags?: string[];
  /** Free-form note shown in the host details panel. */
  note?: string;
  /** Pinned to the top of the sidebar. */
  favorite?: boolean;
}

/** What the backend returns: no secrets, ever. */
export interface PublicAuth {
  type: AuthType;
  /** True when a password / passphrase is stored for this profile. */
  hasSecret: boolean;
  privateKeyPath?: string;
  agentSocket?: string;
  /** SHA256 fingerprint of the loaded private key (nice UI touch). */
  keyFingerprint?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: PublicAuth;
  jump: { host: string; port: number; username: string; auth: PublicAuth } | null;
  cols: number;
  rows: number;
  term: string;
  keepAliveMs: number;
  color: string | null;
  tags: string[];
  note: string;
  favorite: boolean;
  /** Sort index in the sidebar (0-based, dense). */
  order: number;
  createdAt: string;
  updatedAt: string;
  /** Last successful connection, ISO string or null. */
  lastConnectedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

export type SessionStatus =
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface SessionSnapshot {
  id: string;
  profileId: string;
  /** Display label, defaults to the profile name. */
  label: string;
  status: SessionStatus;
  /** Server banner (e.g. "SSH-2.0-OpenSSH_9.6"). Available once identified. */
  serverBanner: string | null;
  createdAt: number;
  cols: number;
  rows: number;
  error?: HopError;
}

export interface OpenSessionRequest {
  profileId: string;
  /** Transient secret override for profiles without a stored password. */
  password?: string;
  /** Transient passphrase override. */
  passphrase?: string;
  cols?: number;
  rows?: number;
  /** Optional label override (e.g. "prod · web-01"). */
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Terminal data                                                      */
/* ------------------------------------------------------------------ */

/**
 * Terminal bytes always travel as *strings*.
 * The backend decodes UTF-8 incrementally (see SshSession), so a
 * multi-byte glyph split across two SSH packets never arrives broken.
 * For binary-ish data (rare in an interactive shell) invalid sequences
 * become U+FFFD rather than corrupting the surrounding text.
 */
export interface TerminalDataEvent {
  sessionId: string;
  /** UTF-8 text, already decoded. May be empty (ignored by the UI). */
  data: string;
}

export interface ResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

/* ------------------------------------------------------------------ */
/* Host keys (TOFU)                                                   */
/* ------------------------------------------------------------------ */

export interface HostKeyChallenge {
  requestId: string;
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  /** "SHA256:…" — the format `ssh-keygen -lf` prints. */
  fingerprint: string;
  /** true => host already in known_hosts (mismatch is a hard error, see below) */
  known: boolean;
  /** Set when known === true and the presented key differs: serious warning. */
  mismatch?: { previousFingerprint: string };
}

export interface KnownHostEntry {
  /** "host:port", the storage key. */
  id: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  addedAt: string;
}

/* ------------------------------------------------------------------ */
/* App info                                                           */
/* ------------------------------------------------------------------ */

export interface AppInfo {
  name: string;
  version: string;
  /** `process.platform` of the main process (e.g. "win32", "darwin"). */
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  contractVersion: number;
  /** False when the OS keychain is unavailable (profile secrets then live
   *  in memory only for the session). */
  secureStorage: boolean;
}

/* ------------------------------------------------------------------ */
/* Renderer-facing API (exposed as `window.hop` by the preload)       */
/* ------------------------------------------------------------------ */

export type Unsubscribe = () => void;

/**
 * Wire envelope used on every ipcMain.handle channel.
 * The preload bridge unwraps it: `{ok:false}` becomes a rejected promise
 * whose reason is the `HopError` object itself. The renderer therefore
 * only ever sees `Promise<T>` that rejects with `HopError`.
 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: HopError };

export interface HopApi {
  /** Frozen app/runtime facts. */
  info(): Promise<AppInfo>;

  profiles: {
    list(): Promise<ConnectionProfile[]>;
    save(input: ProfileInput): Promise<ConnectionProfile>;
    remove(id: string): Promise<void>;
    reorder(orderedIds: string[]): Promise<ConnectionProfile[]>;
    /** Mark a profile as recently used (called by the backend on connect). */
    markUsed?(id: string): Promise<void>;
  };

  sessions: {
    list(): Promise<SessionSnapshot[]>;
    open(request: OpenSessionRequest): Promise<SessionSnapshot>;
    /** Fire-and-forget keystrokes; never await this on the hot path. */
    write(sessionId: string, data: string): void;
    resize(request: ResizeRequest): void;
    close(sessionId: string): Promise<void>;
  };

  knownHosts: {
    list(): Promise<KnownHostEntry[]>;
    forget(id: string): Promise<void>;
  };

  events: {
    /** Terminal output — the only high-frequency channel. */
    onData(listener: (event: TerminalDataEvent) => void): Unsubscribe;
    /** Any status change; also fired for the initial snapshot. */
    onSessionStatus(listener: (session: SessionSnapshot) => void): Unsubscribe;
    /** Ask the user to trust / distrust an unknown or changed host key. */
    onHostKeyChallenge(listener: (challenge: HostKeyChallenge) => void): Unsubscribe;
    /** The session is gone; fired exactly once, after the final status. */
    onSessionClosed(listener: (event: { sessionId: string; reason: HopError | null }) => void): Unsubscribe;
  };

  /** Answer an `onHostKeyChallenge`. `persist` adds it to known_hosts. */
  answerHostKey(requestId: string, decision: 'accept' | 'reject', persist: boolean): void;

  /** Native file picker for a private key. Returns null when cancelled. */
  pickPrivateKey(): Promise<{ path: string; name: string } | null>;
}
