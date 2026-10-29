import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Host } from '../types';
import {
  clearTransfers,
  listFiles,
  listTransfers,
  makeDirectory,
  openRemoteFile,
  removeRemote,
  renameRemote,
  startDownload,
  startUpload,
  type DirectoryListing,
  type RemoteFile,
  type Transfer,
} from '../api/workspace';
import { useApp } from '../store/AppStore';
import { errorMessage } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { Icon } from './ui/Icon';
import { Spinner } from './ui/Spinner';
import './FilesPanel.css';

const TRANSFER_POLL_MS = 700;

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 后端统一给出毫秒时间戳。 */
function formatTime(millis: number): string {
  if (!millis) return '—';
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fileIcon(entry: RemoteFile): 'folder' | 'file' | 'link' {
  if (entry.type === 'dir') return 'folder';
  if (entry.type === 'link') return 'link';
  return 'file';
}

interface FilesBrowserProps {
  host: Host;
}

/**
 * 文件浏览主体（不含外框）：常驻面板复用，命令面板/快捷键也走同一套状态。
 */
export function FilesBrowser({ host }: FilesBrowserProps) {
  const { actions } = useApp();
  const hostId = host.id;

  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [path, setPath] = useState('~');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: RemoteFile } | null>(null);
  const requestId = useRef(0);
  /* 上传结束要自动刷新当前目录，这里用 ref 读取最新的路径与上一轮记录 */
  const pathRef = useRef('~');
  const transfersRef = useRef<Transfer[]>([]);

  const load = useCallback(
    async (target: string) => {
      if (!hostId) return;
      const ticket = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const next = await listFiles(hostId, target);
        if (ticket !== requestId.current) return;
        setListing(next);
        setPath(next.path);
      } catch (err) {
        if (ticket !== requestId.current) return;
        setError(errorMessage(err, '读取目录失败'));
      } finally {
        if (ticket === requestId.current) setLoading(false);
      }
    },
    [hostId],
  );

  /* 切换主机时回到主目录 */
  useEffect(() => {
    setListing(null);
    setRenaming(null);
    setCreating(null);
    void load('~');
  }, [hostId, load]);

  /* 传输进度轮询：面板可见期间持续拉取，隐藏即停 */
  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const openedAt = Date.now();

    const tick = async () => {
      try {
        const rows = await listTransfers(hostId);
        if (disposed) return;
        const previous = transfersRef.current;
        const justUploaded = rows.some(
          (row) =>
            row.direction === 'upload' &&
            row.status !== 'active' &&
            row.startedAt >= openedAt - 1000 &&
            !previous.some((old) => old.id === row.id && old.status === row.status),
        );
        setTransfers(rows);
        transfersRef.current = rows;
        /* 上传落地后立刻重列目录，避免用户还要手动刷新才看见文件 */
        if (justUploaded) void load(pathRef.current);
      } catch {
        /* 轮询失败不打断主界面，下一轮会自然恢复 */
      }
      if (!disposed) timer = window.setTimeout(tick, TRANSFER_POLL_MS);
    };

    void tick();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [hostId, load]);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  /* 右键菜单：点空白处或 Esc 收起 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const entries = useMemo(() => {
    const rows = listing?.entries ?? [];
    return [...rows].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [listing]);

  const runAction = async (task: () => Promise<DirectoryListing | null>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await task();
      if (next) {
        setListing(next);
        setPath(next.path);
      }
    } catch (err) {
      setError(errorMessage(err, '操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    setBusy(true);
    setError(null);
    try {
      const { transfer } = await startUpload(hostId, path);
      if (transfer) actions.toast('info', `开始上传 ${transfer.name}`);
      const rows = await listTransfers(hostId);
      setTransfers(rows);
    } catch (err) {
      setError(errorMessage(err, '上传失败'));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (entry: RemoteFile) => {
    if (entry.type === 'dir') return;
    try {
      const { transfer } = await startDownload(hostId, entry.path);
      if (transfer) actions.toast('info', `开始下载 ${transfer.name}`);
    } catch (err) {
      setError(errorMessage(err, '下载失败'));
    }
  };

  const handleDelete = (entry: RemoteFile) => {
    void runAction(() => removeRemote(hostId, entry.path));
  };

  /* 打开：目录进入；文件交给系统默认程序（xdg-open / open / start） */
  const handleOpen = async (entry: RemoteFile) => {
    if (entry.type === 'dir') {
      void load(entry.path);
      return;
    }
    try {
      const result = await openRemoteFile(hostId, entry.path);
      if (!result.opened) actions.toast('error', '服务器上没有可用的打开方式');
    } catch (err) {
      actions.toast('error', errorMessage(err, '打开文件失败'));
    }
  };

  const activeTransfers = transfers.filter((item) => item.status === 'active');
  const finishedTransfers = transfers.filter((item) => item.status !== 'active').slice(0, 4);
  const orderedTransfers = [...activeTransfers, ...finishedTransfers];

  return (
    <div className="files">
      <div className="files__bar">
        <button
          type="button"
          className="files__icon-btn"
          title="上一级"
          aria-label="上一级"
          disabled={!listing?.parent || loading}
          onClick={() => listing?.parent && void load(listing.parent)}
        >
          <Icon name="arrow-up" size={14} />
        </button>
        <button
          type="button"
          className="files__icon-btn"
          title="刷新"
          aria-label="刷新目录"
          disabled={loading}
          onClick={() => void load(path)}
        >
          <Icon name="refresh" size={14} />
        </button>
        <button
          type="button"
          className="files__icon-btn"
          title="新建文件夹"
          aria-label="新建文件夹"
          disabled={busy}
          onClick={() => {
            setCreating('新建文件夹');
            void runAction(() => makeDirectory(hostId, path, '新建文件夹'));
          }}
        >
          <Icon name="folder" size={14} />
        </button>
        <button
          type="button"
          className="files__icon-btn files__icon-btn--upload"
          title="上传文件"
          aria-label="上传文件"
          disabled={busy}
          onClick={() => void handleUpload()}
        >
          <Icon name="upload" size={14} />
        </button>
        <span className="files__path mono truncate" title={path}>
          {path}
        </span>
        {loading && <Spinner size={12} />}
      </div>

      {error && (
        <div className="files__error" role="alert">
          <Icon name="alert" size={13} /> {error}
        </div>
      )}

      {/* key 变化会让表格重新挂载：切换目录时播放淡入上移的过渡，并回到顶部 */}
      <div key={path} className="files__table" role="table" aria-label="远程文件">
        <div className="files__row files__row--head" role="row">
          <span role="columnheader">名称</span>
          <span role="columnheader">大小</span>
          <span role="columnheader">修改日期</span>
          <span aria-hidden="true" />
        </div>

        {listing?.parent && (
          <button
            type="button"
            className="files__row files__row--up"
            role="row"
            onClick={() => void load(listing.parent ?? '~')}
          >
            <span className="files__name">
              <Icon name="arrow-up" size={13} /> 上一级
            </span>
            <span className="files__meta" />
            <span className="files__meta" />
            <span />
          </button>
        )}

        {creating !== null && (
          <div className="files__row files__row--edit" role="row">
            <span className="files__name">
              <Icon name="folder" size={13} />
              <input
                autoFocus
                className="files__rename-input"
                value={creating}
                aria-label="新文件夹名称"
                onChange={(event) => setCreating(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const name = creating.trim();
                    if (name) void runAction(() => makeDirectory(hostId, path, name));
                    setCreating(null);
                  }
                  if (event.key === 'Escape') setCreating(null);
                }}
                onBlur={() => setCreating(null)}
              />
            </span>
            <span className="files__meta" />
            <span className="files__meta" />
            <span />
          </div>
        )}

        {entries.map((entry) => {
          const isRenaming = renaming?.from === entry.path;
          return (
            <div
              key={entry.path}
              className={`files__row${entry.type === 'dir' ? ' is-dir' : ''}`}
              role="row"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, entry });
              }}
              onDoubleClick={() => {
                if (entry.type === 'dir') void load(entry.path);
                else void handleDownload(entry);
              }}
            >
              <span className="files__name">
                <Icon name={fileIcon(entry)} size={13} />
                {isRenaming ? (
                  <input
                    autoFocus
                    className="files__rename-input"
                    value={renaming.value}
                    aria-label="新名称"
                    onChange={(event) => setRenaming({ from: entry.path, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        const name = renaming.value.trim();
                        if (name && name !== entry.name) {
                          void runAction(() => renameRemote(hostId, entry.path, name));
                        }
                        setRenaming(null);
                      }
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="files__name-btn truncate"
                    title={entry.name}
                    onClick={() => {
                      if (entry.type === 'dir') void load(entry.path);
                    }}
                  >
                    {entry.name}
                  </button>
                )}
              </span>
              <span className="files__meta">{entry.type === 'dir' ? '—' : formatBytes(entry.size)}</span>
              <span className="files__meta">{formatTime(entry.mtime)}</span>
              <span className="files__actions">
                {entry.type !== 'dir' && (
                  <button
                    type="button"
                    className="files__mini"
                    title="下载"
                    aria-label={`下载 ${entry.name}`}
                    onClick={() => void handleDownload(entry)}
                  >
                    <Icon name="download" size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="files__mini"
                  title="重命名"
                  aria-label={`重命名 ${entry.name}`}
                  onClick={() => setRenaming({ from: entry.path, value: entry.name })}
                >
                  <Icon name="pencil" size={13} />
                </button>
                <button
                  type="button"
                  className="files__mini is-danger"
                  title="删除"
                  aria-label={`删除 ${entry.name}`}
                  onClick={() => handleDelete(entry)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          );
        })}

        {!loading && entries.length === 0 && !creating && (
          <div className="files__empty">
            <Icon name="folder" size={18} />
            <span>这个目录是空的</span>
          </div>
        )}
      </div>

      {orderedTransfers.length > 0 && (
        <section className="files__transfers" aria-label="传输进度">
          <header className="files__transfers-head">
            <span className="files__transfers-title">
              传输
              {activeTransfers.length > 0 && (
                <span className="files__transfers-badge">{activeTransfers.length}</span>
              )}
            </span>
            <button
              type="button"
              className="files__link"
              onClick={() => {
                void clearTransfers().then(() => setTransfers([]));
              }}
            >
              清空记录
            </button>
          </header>
          {orderedTransfers.map((transfer) => {
            const active = transfer.status === 'active';
            const percent = active
              ? transfer.total > 0
                ? Math.min(100, Math.round((transfer.transferred / transfer.total) * 100))
                : 0
              : transfer.status === 'done'
                ? 100
                : 0;
            const endAt = transfer.finishedAt ?? Date.now();
            const seconds = Math.max(0.4, (endAt - transfer.startedAt) / 1000);
            const speed = transfer.transferred / seconds;
            const remain = active && speed > 0 && transfer.total > 0
              ? Math.max(0, Math.round((transfer.total - transfer.transferred) / speed))
              : null;
            return (
              <article key={transfer.id} className="xfer" data-status={transfer.status}>
                <span className="xfer__icon" data-dir={transfer.direction}>
                  <Icon name={transfer.direction === 'upload' ? 'arrow-up' : 'download'} size={13} />
                </span>
                <div className="xfer__body">
                  <div className="xfer__top">
                    <span className="xfer__name truncate" title={transfer.name}>
                      {transfer.name}
                    </span>
                    <span className="xfer__state">
                      {active ? `${percent}%` : transfer.status === 'done' ? '完成' : '失败'}
                    </span>
                  </div>
                  <div
                    className="xfer__track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={`${transfer.name} 传输进度`}
                  >
                    <span className="xfer__fill" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="xfer__meta">
                    <span className="mono">
                      {formatBytes(transfer.transferred)}
                      {transfer.total > 0 ? ` / ${formatBytes(transfer.total)}` : ''}
                    </span>
                    <span className="xfer__speed mono">
                      {active ? `${formatBytes(speed)}/s` : transfer.direction === 'upload' ? '已上传' : '已下载'}
                    </span>
                    <span className="xfer__eta">
                      {active
                        ? remain === null
                          ? '计算中…'
                          : remain > 0
                            ? `剩余 ${formatDuration(remain)}`
                            : '即将完成'
                        : formatDuration(Math.round(seconds))}
                    </span>
                  </div>
                </div>
                {transfer.status === 'error' && transfer.error && (
                  <p className="xfer__error" title={transfer.error}>
                    {transfer.error}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      {menu && (
        <div
          className="files__menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleOpen(menu.entry);
              setMenu(null);
            }}
          >
            <Icon name="enter" size={13} />
            {menu.entry.type === 'dir' ? '打开目录' : '打开文件'}
          </button>
          {menu.entry.type !== 'dir' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void handleDownload(menu.entry);
                setMenu(null);
              }}
            >
              <Icon name="download" size={13} />
              下载到本机
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenaming({ from: menu.entry.path, value: menu.entry.name });
              setMenu(null);
            }}
          >
            <Icon name="pencil" size={13} />
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = menu.entry.path;
              void copyText(target).then((ok) => {
                actions.toast(ok ? 'success' : 'error', ok ? '已复制路径' : '剪贴板不可用');
              });
              setMenu(null);
            }}
          >
            <Icon name="copy" size={13} />
            复制路径
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCreating('新建文件夹');
              void runAction(() => makeDirectory(hostId, path, '新建文件夹'));
              setMenu(null);
            }}
          >
            <Icon name="folder" size={13} />
            新建文件夹
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              handleDelete(menu.entry);
              setMenu(null);
            }}
          >
            <Icon name="trash" size={13} />
            删除
          </button>
        </div>
      )}
    </div>
  );
}
