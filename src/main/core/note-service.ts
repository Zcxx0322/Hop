import { app } from 'electron';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger';

const log = createLogger('notes');

export interface StoredNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface NotesMeta {
  dir: string;
}

const META_FILE = 'notes-settings.json';
const DEFAULT_FOLDER = 'notes';

/**
 * 笔记存储：每条笔记一个 Markdown 文件（front matter 里放 id / 标题 / 时间），
 * 目录默认 `%APPDATA%/Hop/notes`，可以在偏好设置里改，文件可以用任何编辑器打开。
 */
export class NoteService {
  private metaPath = '';
  private dir = '';

  constructor() {
    this.metaPath = join(app.getPath('userData'), META_FILE);
    this.dir = this.readDir();
    this.ensure();
  }

  private defaultDir(): string {
    return join(app.getPath('userData'), DEFAULT_FOLDER);
  }

  private readDir(): string {
    try {
      if (!existsSync(this.metaPath)) return this.defaultDir();
      const meta = JSON.parse(readFileSync(this.metaPath, 'utf8')) as NotesMeta;
      return typeof meta.dir === 'string' && meta.dir.trim() ? meta.dir : this.defaultDir();
    } catch {
      return this.defaultDir();
    }
  }

  private writeDir(dir: string): void {
    try {
      writeFileSync(this.metaPath, JSON.stringify({ dir } satisfies NotesMeta, null, 2), 'utf8');
    } catch (error) {
      log.warn('write notes meta failed', { err: String(error) });
    }
  }

  private ensure(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      log.warn('create notes dir failed', { err: String(error) });
      this.dir = this.defaultDir();
      try {
        mkdirSync(this.dir, { recursive: true });
      } catch {
        /* 忽略：list 时会返回空 */
      }
    }
  }

  getDir(): string {
    return this.dir;
  }

  setDir(dir: string): string {
    const next = dir.trim();
    if (!next) throw Object.assign(new Error('目录不能为空'), { code: 'CONFIG_INVALID' });
    if (!existsSync(next) || !statSync(next).isDirectory()) {
      throw Object.assign(new Error('目录不存在'), { code: 'CONFIG_INVALID' });
    }
    this.dir = next;
    this.writeDir(next);
    return next;
  }

  list(): StoredNote[] {
    try {
      const files = readdirSync(this.dir).filter((name) => name.endsWith('.md'));
      const notes = files
        .map((name) => this.read(join(this.dir, name)))
        .filter((note): note is StoredNote => Boolean(note));
      return notes.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      log.warn('list notes failed', { err: String(error) });
      return [];
    }
  }

  private read(file: string): StoredNote | null {
    try {
      const raw = readFileSync(file, 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
      const meta: Record<string, string> = {};
      let body = raw;
      if (match) {
        body = raw.slice(match[0].length);
        for (const line of match[1].split(/\r?\n/)) {
          const idx = line.indexOf(':');
          if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      const id = meta.id || file.replace(/^.*[\\/]/, '').replace(/\.md$/, '');
      const stat = statSync(file);
      const createdAt = Number(meta.createdAt) || stat.birthtimeMs || stat.mtimeMs;
      const updatedAt = Number(meta.updatedAt) || stat.mtimeMs;
      return { id, title: meta.title ?? '', body, createdAt, updatedAt };
    } catch (error) {
      log.warn('read note failed', { err: String(error) });
      return null;
    }
  }

  save(input: { id: string; title: string; body: string }): StoredNote {
    const now = Date.now();
    const existing = this.list().find((note) => note.id === input.id);
    const note: StoredNote = {
      id: input.id,
      title: input.title.slice(0, 200),
      body: input.body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const front = [
      '---',
      `id: ${note.id}`,
      `title: ${note.title.replace(/\r?\n/g, ' ')}`,
      `createdAt: ${note.createdAt}`,
      `updatedAt: ${note.updatedAt}`,
      '---',
      '',
    ].join('\n');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${note.id}.md`), front + note.body, 'utf8');
    return note;
  }

  remove(id: string): void {
    const file = join(this.dir, `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.md`);
    try {
      rmSync(file, { force: true });
    } catch (error) {
      log.warn('remove note failed', { err: String(error) });
    }
  }
}
