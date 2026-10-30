/**
 * 笔记：主进程按 Markdown 文件存盘（默认 `%APPDATA%/Hop/notes`，可在偏好设置里改），
 * 浏览器 / 演示模式下退回 localStorage。渲染层只拿到纯文本，Markdown 渲染在前端完成。
 */

import { runtimeConfig } from '../api/config';

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'hop.notes.v1';
const DIR_KEY = 'hop.notes.dir.v1';

function readLocal(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Note[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((note) => note && typeof note.id === 'string')
      .map((note) => ({
        id: note.id,
        title: typeof note.title === 'string' ? note.title : '',
        body: typeof note.body === 'string' ? note.body : '',
        createdAt: Number(note.createdAt) || Date.now(),
        updatedAt: Number(note.updatedAt) || Number(note.createdAt) || Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeLocal(notes: Note[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.slice(0, 500)));
  } catch {
    /* 空间不足时静默失败：下次保存再试 */
  }
}

type Listener = (notes: Note[]) => void;
type DirListener = (dir: string) => void;

let cache: Note[] | null = null;
const listeners = new Set<Listener>();
const dirListeners = new Set<DirListener>();
let dir = '';
let apiReady = false;
let saveTimer = 0;

function emit(): void {
  const rows = cache ?? [];
  listeners.forEach((listener) => listener(rows));
}

function emitDir(): void {
  dirListeners.forEach((listener) => listener(dir));
}

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}

function apiBase(): string {
  return runtimeConfig.apiBase;
}

/** 首次使用时拉一次磁盘上的笔记；失败（演示模式 / 网关未启动）就用本地缓存。 */
export async function hydrateNotes(): Promise<void> {
  const response = await call('/notes');
  if (!response) {
    apiReady = false;
    if (!cache) cache = readLocal();
    emit();
    return;
  }
  const payload = (await response.json()) as { dir?: string; notes?: Note[] };
  apiReady = true;
  cache = Array.isArray(payload.notes) ? payload.notes : [];
  dir = typeof payload.dir === 'string' ? payload.dir : '';
  writeLocal(cache);
  emitDir();
  emit();
}

function scheduleSave(note: Note): void {
  if (!apiReady) {
    writeLocal(cache ?? []);
    return;
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void call('/notes', {
      method: 'PUT',
      body: JSON.stringify({ id: note.id, title: note.title, body: note.body }),
    });
  }, 400);
}

export const noteStore = {
  list(): Note[] {
    if (!cache) cache = readLocal();
    return cache;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  subscribeDir(listener: DirListener): () => void {
    dirListeners.add(listener);
    return () => dirListeners.delete(listener);
  },

  dir(): string {
    return dir || localStorage.getItem(DIR_KEY) || '';
  },

  async setDir(next: string): Promise<{ ok: boolean; message?: string }> {
    const response = await call('/notes/dir', { method: 'PUT', body: JSON.stringify({ dir: next }) });
    if (!response) return { ok: false, message: '无法连接到本地服务' };
    const payload = (await response.json().catch(() => ({}))) as { dir?: string; notes?: Note[] };
    if (payload.dir) {
      dir = payload.dir;
      localStorage.setItem(DIR_KEY, dir);
      if (Array.isArray(payload.notes)) cache = payload.notes;
      emitDir();
      emit();
    }
    return { ok: true };
  },

  create(): Note {
    const now = Date.now();
    const note: Note = {
      id: `n_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now,
    };
    cache = [note, ...noteStore.list()];
    writeLocal(cache);
    emit();
    return note;
  },

  update(id: string, patch: Partial<Pick<Note, 'title' | 'body'>>): void {
    cache = noteStore.list().map((note) =>
      note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
    );
    const current = noteStore.get(id);
    if (current) scheduleSave(current);
    writeLocal(cache);
    emit();
  },

  remove(id: string): void {
    cache = noteStore.list().filter((note) => note.id !== id);
    writeLocal(cache);
    emit();
    if (apiReady) void call(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  get(id: string): Note | undefined {
    return noteStore.list().find((note) => note.id === id);
  },
};
