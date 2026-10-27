import { safeStorage } from 'electron';
import { JsonStore } from './json-store';
import { createLogger } from './logger';

const log = createLogger('secrets');

type Vault = Record<string, string>;

/**
 * Credential vault.
 *
 * On Windows `safeStorage` is Chromium's OSCrypt, i.e. **DPAPI**: the
 * ciphertext is bound to the current Windows user profile, so copying
 * `secrets.dat` to another machine (or another user) yields nothing.
 *
 * Values are stored as `enc:<base64>` (OS keychain) or `mem:<plain>` when
 * no keychain is available (rare: e.g. Linux without a secret service).
 * In the `mem:` case nothing is persisted to disk and secrets live for
 * the lifetime of the process only.
 */
export class SecretStore {
  private readonly store: JsonStore<Vault>;
  private readonly memOnly = new Map<string, string>();
  private secureAvailable = false;

  constructor(file: string) {
    this.store = new JsonStore<Vault>(file, () => ({}), 1);
  }

  /**
   * Resolves whether the OS keychain is usable. Must be awaited once during
   * bootstrap, before any secret is read or written.
   */
  async init(): Promise<void> {
    this.secureAvailable = await SecretStore.probe();
    if (!this.secureAvailable) {
      log.warn('OS keychain unavailable — credentials stay in memory for this session only');
    }
  }

  private static async probe(): Promise<boolean> {
    try {
      // `isEncryptionAvailable()` is deprecated in Electron 45 in favour of the
      // async variant, which also waits for the keychain to unlock.
      const asyncCheck = (safeStorage as unknown as { isAsyncEncryptionAvailable?: () => Promise<boolean> })
        .isAsyncEncryptionAvailable;
      if (typeof asyncCheck === 'function') return await asyncCheck.call(safeStorage);
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  get isSecure(): boolean {
    return this.secureAvailable;
  }

  has(id: string): boolean {
    if (this.memOnly.has(id)) return true;
    return Boolean(this.store.read()[id]);
  }

  /** Returns the plaintext secret, or null when absent / undecryptable. */
  get(id: string): string | null {
    const inMemory = this.memOnly.get(id);
    if (inMemory !== undefined) return inMemory;

    const raw = this.store.read()[id];
    if (!raw) return null;

    if (raw.startsWith('mem:')) return raw.slice(4);
    if (raw.startsWith('enc:')) {
      try {
        const buf = Buffer.from(raw.slice(4), 'base64');
        const plain = safeStorage.decryptString(buf);
        this.memOnly.set(id, plain);
        return plain;
      } catch (err) {
        log.error('failed to decrypt secret', { id, err: String(err) });
        return null;
      }
    }
    return raw; // legacy plaintext
  }

  set(id: string, value: string): void {
    this.memOnly.set(id, value);
    if (!this.secureAvailable) {
      // No keychain: keep the secret in memory only, never on disk.
      this.store.update((vault) => {
        if (!(id in vault)) return vault;
        const next = { ...vault };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const encrypted = safeStorage.encryptString(value).toString('base64');
      this.store.update((vault) => ({ ...vault, [id]: `enc:${encrypted}` }));
    } catch (err) {
      log.error('failed to encrypt secret, keeping it in memory only', {
        id,
        err: String(err),
      });
      this.secureAvailable = false;
      this.store.update((vault) => {
        const next = { ...vault };
        delete next[id];
        return next;
      });
    }
  }

  delete(id: string): void {
    this.memOnly.delete(id);
    this.store.update((vault) => {
      if (!(id in vault)) return vault;
      const next = { ...vault };
      delete next[id];
      return next;
    });
  }

  /** Remove every secret whose id starts with the given prefix. */
  deleteByPrefix(prefix: string): void {
    for (const key of [...this.memOnly.keys()]) {
      if (key.startsWith(prefix)) this.memOnly.delete(key);
    }
    this.store.update((vault) => {
      const next: Vault = {};
      for (const [key, value] of Object.entries(vault)) {
        if (!key.startsWith(prefix)) next[key] = value;
      }
      return next;
    });
  }
}
