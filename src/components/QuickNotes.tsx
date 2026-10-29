import { useEffect, useRef, useState } from 'react';
import { noteStore, type Note } from '../store/notes';
import { useApp } from '../store/AppStore';
import { pushOverlay, isTopOverlay } from '../lib/overlayStack';
import { Icon } from './ui/Icon';
import './QuickNotes.css';

const OVERLAY_ID = 'quick-note';

/**
 * 速记浮层：在终端页上滑出一块，随手记两行，不用跳走。
 * 和笔记页共用同一份本地存储，标题留空时显示「未命名笔记」。
 */
export function QuickNotes() {
  const { actions } = useApp();
  const [notes, setNotes] = useState<Note[]>(() => noteStore.list());
  const [activeId, setActiveId] = useState<string | null>(() => noteStore.list()[0]?.id ?? null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const active = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    const release = pushOverlay(OVERLAY_ID);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !isTopOverlay(OVERLAY_ID)) return;
      event.preventDefault();
      event.stopPropagation();
      actions.toggleQuickNote();
    };
    document.addEventListener('keydown', onKey, true);
    bodyRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      release();
    };
    /* 只在挂载时登记一次，避免每次输入都重绑监听 */
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createNote = (): void => {
    const note = noteStore.create();
    setNotes(noteStore.list());
    setActiveId(note.id);
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  return (
    <aside className="quicknote" role="dialog" aria-label="速记">
      <header className="quicknote__head">
        <Icon name="pencil" size={14} />
        <span>速记</span>
        {notes.length > 1 && (
          <select
            className="quicknote__switch"
            aria-label="切换笔记"
            value={activeId ?? ''}
            onChange={(event) => setActiveId(event.target.value)}
          >
            {notes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.title.trim() || '未命名笔记'}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="quicknote__ghost" aria-label="新建笔记" title="新建笔记" onClick={createNote}>
          <Icon name="plus" size={14} />
        </button>
        <button
          type="button"
          className="quicknote__ghost"
          aria-label="打开笔记页"
          title="打开笔记页"
          onClick={() => {
            actions.toggleQuickNote();
            actions.setPage('notes');
          }}
        >
          <Icon name="arrow-up-right" size={14} />
        </button>
        <button type="button" className="quicknote__ghost" aria-label="关闭速记" title="关闭（Esc）" onClick={actions.toggleQuickNote}>
          <Icon name="x" size={14} />
        </button>
      </header>

      {active ? (
        <div className="quicknote__body">
          <input
            className="quicknote__title"
            value={active.title}
            placeholder="未命名笔记"
            aria-label="笔记标题"
            onChange={(event) => {
              noteStore.update(active.id, { title: event.target.value.slice(0, 80) });
              setNotes(noteStore.list());
            }}
          />
          <textarea
            ref={bodyRef}
            className="quicknote__editor mono"
            value={active.body}
            placeholder={'随手记点什么，支持 Markdown…\n\n# 标题\n- 列表\n`代码`'}
            spellCheck={false}
            onChange={(event) => {
              noteStore.update(active.id, { body: event.target.value });
              setNotes(noteStore.list());
            }}
          />
          <footer className="quicknote__foot">
            <span>{active.body.length} 字符</span>
            <span className="quicknote__hint">已自动保存在本机</span>
          </footer>
        </div>
      ) : (
        <div className="quicknote__empty">
          <p>还没有笔记</p>
          <button type="button" className="quicknote__primary" onClick={createNote}>
            新建一篇
          </button>
        </div>
      )}
    </aside>
  );
}
