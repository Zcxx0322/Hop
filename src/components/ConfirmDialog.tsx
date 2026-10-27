import { useApp } from '../store/AppStore';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './ConfirmDialog.css';

export function ConfirmDialog() {
  const { state, actions } = useApp();
  const pendingDelete = state.ui.pendingDeleteHostId;
  const pendingClose = state.ui.pendingCloseSessionId;

  if (!pendingDelete && !pendingClose) return null;

  const host = pendingDelete ? state.hosts.find((item) => item.id === pendingDelete) : null;
  const session = pendingClose
    ? state.sessions.find((item) => item.id === pendingClose) ?? null
    : null;

  const isDelete = Boolean(pendingDelete);
  const title = isDelete ? '删除这台主机？' : '关闭当前会话？';
  const description = isDelete
    ? '主机配置将从连接列表中移除，本机保存的收藏与标签也会一并清理。'
    : '会话中正在运行的进程会随连接一起结束，未保存的输出将无法恢复。';

  const handleClose = () => {
    if (isDelete) actions.cancelDeleteHost();
    else actions.cancelCloseSession();
  };

  const handleConfirm = () => {
    if (isDelete) actions.confirmDeleteHost();
    else actions.confirmCloseSession();
  };

  return (
    <Modal
      open
      onClose={handleClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            取消
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            {isDelete ? '删除主机' : '断开连接'}
          </Button>
        </>
      }
    >
      <div className="confirm-dialog__subject">
        <span
          className="confirm-dialog__swatch"
          style={
            host?.color ? { background: host.color } : undefined
          }
          aria-hidden="true"
        />
        <div className="confirm-dialog__meta">
          <span className="confirm-dialog__name">
            {isDelete ? host?.name ?? '未知主机' : session?.title ?? '当前会话'}
          </span>
          <span className="confirm-dialog__sub mono">
            {isDelete && host
              ? `${host.username}@${host.host}:${host.port}`
              : session?.address ?? ''}
          </span>
        </div>
        <span className={`confirm-dialog__tag${isDelete ? ' is-danger' : ''}`}>
          {isDelete ? '不可撤销' : '连接将中断'}
        </span>
      </div>
    </Modal>
  );
}
