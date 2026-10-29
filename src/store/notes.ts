/**
 * 笔记：存在本机 localStorage，按更新时间倒序。
 * 结构保持极简（纯文本 Markdown），渲染在前端完成，不上传任何内容。
 */

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'hop.notes.v1';

function read(): Note[] {
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

function write(notes: Note[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.slice(0, 500)));
  } catch {
    /* 空间不足时静默失败：下次保存再试 */
  }
}

type Listener = (notes: Note[]) => void;

let cache: Note[] | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  const rows = cache ?? [];
  listeners.forEach((listener) => listener(rows));
}

export const noteStore = {
  list(): Note[] {
    if (!cache) cache = read();
    return cache;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  create(): Note {
    const now = Date.now();
    const note: Note = {
      id: `note_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now,
    };
    cache = [note, ...noteStore.list()];
    write(cache);
    emit();
    return note;
  },

  update(id: string, patch: Partial<Pick<Note, 'title' | 'body'>>): void {
    cache = noteStore.list().map((note) =>
      note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
    );
    write(cache);
    emit();
  },

  remove(id: string): void {
    cache = noteStore.list().filter((note) => note.id !== id);
    write(cache);
    emit();
  },

  get(id: string): Note | undefined {
    return noteStore.list().find((note) => note.id === id);
  },
};
