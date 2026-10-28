import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppStore';
import {
  clearTransfers,
  listFiles,
  listTransfers,
  makeDirectory,
  removeRemote,
  renameRemote,
  startDownload,
  startUpload,
  type DirectoryListing,
  type RemoteFile,
  type Transfer,
} from '../api/workspace';
import { errorMessage } from '../lib/utils';
import { Icon } from './ui/Icon';
import { Modal } from './ui/Modal';
import { Spinner } from './ui/Spinner';
import './FilesPanel.css';

const TRANSFER_POLL_MS = 700;

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

export function FilesPanel() {
  const { state, actions } = useApp();
  const hostId = state.ui.filesHostId;
  const host = state.hosts.find((item) => item.id === hostId) ?? null;

  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [path, setPath] = useState('~');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const requestId = useRef(0);

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

  /* 打开面板或切换主机时载入根目录 */
  useEffect(() => {
    if (!hostId) return;
    setListing(null);
    setRenaming(null);
    setCreating(null);
    void load('~');
  }, [hostId, load]);

  /* 传输进度轮询：面板打开期间持续拉取，关闭即停 */
  useEffect(() => {
    if (!hostId) return;
    let disposed = false;
    let timer = 0;

    const tick = async () => {
      try {
        const rows = await listTransfers(hostId);
        if (!disposed) setTransfers(rows);
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
  }, [hostId]);

  const entries = useMemo(() => {
    const rows = listing?.entries ?? [];
    return [...rows].sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [listing]);

  if (!hostId) return null;

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

  const activeTransfers = transfers.filter((item) => item.status === 'active');
  const finishedTransfers = transfers.filter((item) => item.status !== 'active').slice(0, 6);
  const orderedTransfers = [...activeTransfers, ...finishedTransfers];

  return (
    <Modal
      open
      onClose={actions.closeFiles}
      title={`文件传输 · ${host?.name ?? '主机'}`}
      description={host ? `${host.username}@${host.host}:${host.port}` : undefined}
      size="xl"
      variant="drawer"
      panelClassName="modal--files"
      footer={
        <div className="files__footer">
          <button
            type="button"
            className="files__link"
            disabled={!orderedTransfers.length}
            onClick={() => {
              void clearTransfers().then(() => setTransfers([]));
            }}
          >
            清空传输记录
          </button>
          <div className="files__footer-actions">
            <button
              type="button"
              className="files__action"
              disabled={busy}
              onClick={() => void runAction(() => makeDirectory(hostId, path, '新建文件夹'))}
            >
              <Icon name="folder" size={13} /> 新建文件夹
            </button>
            <button type="button" className="files__action is-primary" disabled={busy} onClick={() => void handleUpload()}>
              <Icon name="upload" size={13} /> 上传文件
            </button>
          </div>
        </div>
      }
    >
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

        <div className="files__table" role="table" aria-label="远程文件">
          <div className="files__row files__row--head" role="row">
            <span role="columnheader">名称</span>
            <span role="columnheader">大小</span>
            <span role="columnheader">修改时间</span>
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
                      onChange={(event) =>
                        setRenaming({ from: entry.path, value: event.target.value })
                      }
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
            <h3 className="files__transfers-title">传输</h3>
            {orderedTransfers.map((transfer) => {
              const percent =
                transfer.total > 0
                  ? Math.min(100, Math.round((transfer.transferred / transfer.total) * 100))
                  : transfer.status === 'done'
                    ? 100
                    : 0;
              return (
                <div key={transfer.id} className="files__transfer" data-status={transfer.status}>
                  <Icon
                    name={transfer.direction === 'upload' ? 'upload' : 'download'}
                    size={12}
                  />
                  <span className="files__transfer-name truncate">{transfer.name}</span>
                  <span className="files__transfer-size mono">
                    {formatBytes(transfer.transferred)}
                    {transfer.total ? ` / ${formatBytes(transfer.total)}` : ''}
                  </span>
                  <span className="files__progress" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span className="files__transfer-state">
                    {transfer.status === 'active'
                      ? `${percent}%`
                      : transfer.status === 'done'
                        ? '完成'
                        : '失败'}
                  </span>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </Modal>
  );
}
