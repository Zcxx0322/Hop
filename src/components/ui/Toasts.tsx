import type { Toast } from '../../types';
import { Icon, type IconName } from './Icon';
import './Toasts.css';

const TONE_META: Record<Toast['tone'], { icon: IconName; label: string }> = {
  success: { icon: 'check', label: '成功' },
  error: { icon: 'alert', label: '错误' },
  info: { icon: 'info', label: '提示' },
};

interface ToastsProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/** 右下角轻提示，由 store 负责自动消失。 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const meta = TONE_META[toast.tone];
        return (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span className="toast__icon">
              <Icon name={meta.icon} size={14} />
            </span>
            <div className="toast__body">
              <span className="toast__label mono">{meta.label}</span>
              <p className="toast__message">{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast__close"
              aria-label="关闭提示"
              onClick={() => onDismiss(toast.id)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
