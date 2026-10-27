import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger';

const log = createLogger('store');

interface Envelope<T> {
  version: number;
  data: T;
}

/**
 * Tiny, dependency-free JSON document store.
 *
 * - atomic writes (tmp file + rename), so a crash can never leave a
 *   half-written profile list behind;
 * - tolerates a corrupt file: it is copied to `<name>.corrupt` and the
 *   defaults are used instead of crashing the app;
 * - synchronous on purpose: these documents are tiny and only change on
 *   explicit user actions.
 */
export class JsonStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly file: string,
    private readonly defaults: () => T,
    private readonly version = 1,
  ) {}

  read(): T {
    if (this.cache) return this.cache;
    try {
      if (!fs.existsSync(this.file)) {
        this.cache = this.defaults();
        return this.cache;
      }
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Envelope<T> | T;
      if (parsed && typeof parsed === 'object' && 'version' in (parsed as object) && 'data' in (parsed as object)) {
        this.cache = (parsed as Envelope<T>).data ?? this.defaults();
      } else {
        // Legacy / hand-edited file without envelope
        this.cache = parsed as T;
      }
      return this.cache;
    } catch (err) {
      log.error('failed to read store, using defaults', { file: this.file, err: String(err) });
      try {
        if (fs.existsSync(this.file)) {
          fs.copyFileSync(this.file, `${this.file}.corrupt`);
        }
      } catch {
        /* ignore */
      }
      this.cache = this.defaults();
      return this.cache;
    }
  }

  write(next: T): T {
    this.cache = next;
    const dir = path.dirname(this.file);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      const payload: Envelope<T> = { version: this.version, data: next };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error('failed to write store', { file: this.file, err: String(err) });
    }
    return next;
  }

  update(mutator: (current: T) => T): T {
    return this.write(mutator(this.read()));
  }
}
