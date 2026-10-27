import { Icon, type IconName } from './Icon';

interface SpinnerProps {
  size?: number;
  label?: string;
}

/** 环形加载指示器，颜色跟随 currentColor。 */
export function Spinner({ size = 16, label }: SpinnerProps) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 9) }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function StatusDot({ tone }: { tone: 'connected' | 'connecting' | 'error' | 'idle' }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

export const STATUS_META: Record<
  string,
  { label: string; icon: IconName; tone: 'connected' | 'connecting' | 'error' | 'idle' }
> = {
  connecting: { label: '连接中', icon: 'refresh', tone: 'connecting' },
  connected: { label: '已连接', icon: 'zap', tone: 'connected' },
  reconnecting: { label: '重连中', icon: 'refresh', tone: 'connecting' },
  closed: { label: '已断开', icon: 'power', tone: 'idle' },
  error: { label: '连接失败', icon: 'alert', tone: 'error' },
};

export { Icon };
