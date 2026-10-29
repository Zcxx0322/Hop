import { useEffect, useMemo, useRef, useState } from 'react';
import { noteStore, type Note } from '../store/notes';
import { renderMarkdown } from '../lib/markdown';
import { Icon } from './ui/Icon';
import './NotesPage.css';

const LIVE_KEY = 'hop.notes.live.v1';

function relative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function snippet(body: string): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.slice(0, 56);
}

/** 笔记：左侧列表 + 右侧编辑，可选 Typora 式即时渲染 */
export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>(() => noteStore.list());
  const [activeId, setActiveId] = useState<string | null>(() => noteStore.list()[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [live, setLive] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LIVE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => noteStore.subscribe(setNotes), []);

  useEffect(() => {
    try {
      localStorage.setItem(LIVE_KEY, live ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }, [live]);

  const active = notes.find((note) => note.id === activeId) ?? null;

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(keyword) || note.body.toLowerCase().includes(keyword),
    );
  }, [notes, query]);

  const createNote = (): void => {
    const note = noteStore.create();
    setActiveId(note.id);
    setQuery('');
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const removeNote = (id: string): void => {
    noteStore.remove(id);
    const rest = noteStore.list();
    setActiveId(rest[0]?.id ?? null);
  };

  /* 即时渲染开启时，编辑区滚动同步到预览区 */
  const syncScroll = (): void => {
    const source = bodyRef.current;
    const target = previewRef.current;
    if (!source || !target) return;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = ratio * Math.max(0, target.scrollHeight - target.clientHeight);
  };

  return (
    <section className="notes" aria-label="笔记">
      <aside className="notes__list">
        <div className="notes__list-head">
          <div className="notes__search">
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索笔记"
              aria-label="搜索笔记"
            />
          </div>
          <button type="button" className="notes__new" onClick={createNote} title="新建笔记">
            <Icon name="plus" size={14} />
          </button>
        </div>

        <div className="notes__items">
          {visible.length === 0 ? (
            <p className="notes__empty">{notes.length === 0 ? '还没有笔记' : '没有匹配的笔记'}</p>
          ) : (
            visible.map((note) => (
              <button
                key={note.id}
                type="button"
                className="notes__item"
                data-on={note.id === activeId}
                onClick={() => setActiveId(note.id)}
              >
                <span className="notes__item-title truncate">{note.title || '未命名笔记'}</span>
                <span className="notes__item-snippet truncate">{snippet(note.body) || '空空如也'}</span>
                <span className="notes__item-time">{relative(note.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="notes__main">
        {active ? (
          <>
            <header className="notes__bar">
              <input
                className="notes__title"
                value={active.title}
                aria-label="笔记标题"
                onChange={(event) =>
                  noteStore.update(active.id, { title: event.target.value.slice(0, 80) })
                }
              />
              <div className="notes__actions">
                <label className="notes__toggle" title="开启后右侧实时渲染 Markdown">
                  <input
                    type="checkbox"
                    checked={live}
                    onChange={(event) => setLive(event.target.checked)}
                  />
                  <span className="notes__toggle-track" aria-hidden="true">
                    <span className="notes__toggle-thumb" />
                  </span>
                  即时渲染
                </label>
                <button
                  type="button"
                  className="notes__ghost"
                  title="删除这篇笔记"
                  aria-label="删除这篇笔记"
                  onClick={() => removeNote(active.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </header>

            <div className="notes__split" data-live={live}>
              <textarea
                ref={bodyRef}
                className="notes__editor mono"
                value={active.body}
                spellCheck={false}
                placeholder={'# 标题\n\n支持 Markdown：**粗体**、`代码`、- 列表、> 引用、```代码块```、| 表格 |'}
                onChange={(event) => noteStore.update(active.id, { body: event.target.value })}
                onScroll={live ? syncScroll : undefined}
              />
              {live && (
                <div className="notes__preview markdown" ref={previewRef}>
                  {renderMarkdown(active.body)}
                </div>
              )}
            </div>

            <footer className="notes__foot">
              <span>{active.body.length} 字符</span>
              <span>{live ? '即时渲染：开' : '即时渲染：关'}</span>
              <span>自动保存在本机</span>
            </footer>
          </>
        ) : (
          <div className="notes__blank">
            <Icon name="pencil" size={22} />
            <p>还没有选中笔记</p>
            <button type="button" className="notes__primary" onClick={createNote}>
              新建笔记
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
