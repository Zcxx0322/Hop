import { useId } from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

/** Hop 的渐变终端标记，颜色跟随强调色。 */
export function LogoMark({ size = 28, className = '' }: LogoProps) {
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9.5" fill={`url(#${gradientId})`} />
      <path
        d="M9.5 10.5l5 5.5-5 5.5"
        fill="none"
        style={{ stroke: 'var(--accent-ink)' }}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 21.5h6"
        fill="none"
        style={{ stroke: 'var(--accent-ink)' }}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
