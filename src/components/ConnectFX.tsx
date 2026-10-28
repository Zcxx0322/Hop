import { useEffect, useState } from 'react';
import type { Host, Session } from '../types';
import { formatAddress } from '../lib/visual';
import { Icon } from './ui/Icon';
import './ConnectFX.css';

/** 连接过程的分段文案：和真实握手阶段大体对应，不假装精确进度 */
const STEPS = ['建立安全通道', '协商主机密钥', '验证身份凭据', '启动远端终端'] as const;

type Phase = 'run' | 'done' | 'hidden';

interface ConnectFXProps {
  session: Session;
  host: Host | null;
}

/**
 * 连接特效：连接/重连期间盖住终端，用呼吸光环 + 阶段文案提示进度，
 * 连接成功后短暂闪光再淡出，露出终端里的欢迎信息。
 */
export function ConnectFX({ session, host }: ConnectFXProps) {
  const busy = session.status === 'connecting' || session.status === 'reconnecting';
  const [phase, setPhase] = useState<Phase>(busy ? 'run' : 'hidden');
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (busy) {
      setStep(0);
      setPhase('run');
      return;
    }
    // 从连接中切到 connected/error/closed：先播完成闪光，再隐藏
    setPhase((current) => (current === 'run' ? 'done' : current));
  }, [busy]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = window.setTimeout(() => setPhase('hidden'), 620);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'run') return;
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % STEPS.length);
    }, 900);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (phase === 'hidden') return null;

  const failed = session.status === 'error';
  const label = failed ? '连接失败' : phase === 'done' ? '已连接' : STEPS[step];

  return (
    <div
      className={`connectfx connectfx--${phase}${failed ? ' connectfx--error' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`正在连接 ${host?.name ?? session.title}`}
    >
      <div className="connectfx__stage" aria-hidden="true">
        <span className="connectfx__ring" />
        <span className="connectfx__ring" />
        <span className="connectfx__ring" />
        <span className="connectfx__core">
          <Icon name={phase === 'done' ? 'check' : 'terminal'} size={20} />
        </span>
      </div>

      <p className="connectfx__host">{host?.name ?? session.title}</p>
      <p className="connectfx__addr mono">{host ? formatAddress(host) : session.address}</p>
      <p className="connectfx__step">
        <span>{label}</span>
        {phase === 'run' && (
          <span className="connectfx__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </p>

      <div className="connectfx__bar" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
