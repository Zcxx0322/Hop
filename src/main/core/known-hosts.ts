import type { KnownHostEntry } from '../../shared/contract';
import { JsonStore } from './json-store';
import { createLogger } from './logger';

const log = createLogger('known-hosts');

interface StoredEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  addedAt: string;
}

export interface HostKeyCheck {
  known: boolean;
  match: boolean;
  /** Previous fingerprint when a stored key exists but differs. */
  previousFingerprint?: string;
  previousKeyType?: string;
}

/**
 * Trust-on-first-use host key store (~/.ssh/known_hosts equivalent).
 * Deliberately small: one fingerprint per host:port, newest wins.
 */
export class KnownHostsStore {
  private readonly store: JsonStore<StoredEntry[]>;

  constructor(file: string) {
    this.store = new JsonStore<StoredEntry[]>(file, () => [], 1);
  }

  private static id(host: string, port: number): string {
    return `${host.toLowerCase()}:${port}`;
  }

  check(host: string, port: number, keyType: string, fingerprint: string): HostKeyCheck {
    const entry = this.store.read().find((e) => KnownHostsStore.id(e.host, e.port) === KnownHostsStore.id(host, port));
    if (!entry) return { known: false, match: false };

    const match = entry.fingerprint === fingerprint && entry.keyType === keyType;
    return {
      known: true,
      match,
      previousFingerprint: entry.fingerprint,
      previousKeyType: entry.keyType,
    };
  }

  trust(host: string, port: number, keyType: string, fingerprint: string): void {
    const id = KnownHostsStore.id(host, port);
    this.store.update((list) => {
      const rest = list.filter((e) => KnownHostsStore.id(e.host, e.port) !== id);
      return [...rest, { host: host.toLowerCase(), port, keyType, fingerprint, addedAt: new Date().toISOString() }];
    });
    log.info('host key trusted', { host: id, keyType, fingerprint });
  }

  list(): KnownHostEntry[] {
    return this.store
      .read()
      .map((e) => ({
        id: KnownHostsStore.id(e.host, e.port),
        host: e.host,
        port: e.port,
        keyType: e.keyType,
        fingerprint: e.fingerprint,
        addedAt: e.addedAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  forget(id: string): void {
    this.store.update((list) => list.filter((e) => KnownHostsStore.id(e.host, e.port) !== id.toLowerCase()));
    log.info('host key forgotten', { id });
  }
}
