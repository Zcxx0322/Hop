import type { ReactNode, SVGProps } from 'react';

/**
 * 内置图标集（24×24，线性描边）。
 * 不引入图标库：体积可控、描边粗细与视觉语言统一。
 */
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 13l4 4L19 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="7" cy="17" r="2" />
    </>
  ),
  /** 偏好设置：齿轮 */
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6L6 18M18 6l1.6-1.6" />
      <circle cx="12" cy="12" r="8.2" strokeDasharray="1.6 3.1" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7.5 9.5l3 2.5-3 2.5M13 15h4" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01M11 7.5h2M11 16.5h2" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-up-right': <path d="M7 17L17 7M9 7h8v8" />,
  'arrow-left': <path d="M19 12H5M11 18l-6-6 6-6" />,
  pencil: (
    <>
      <path d="M12.5 20H21" />
      <path d="M16.4 3.6a2.1 2.1 0 013 3L7.5 18.5 3 20l1.5-4.5L16.4 3.6z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2" />
      <path d="M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  star: (
    <path d="M12 3.6l2.6 5.3 5.8.9-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.9L12 3.6z" />
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.9 12.1L20 3M16.4 6.6l2.4 2.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10.5" rx="2.5" />
      <path d="M8 10V7.8a4 4 0 018 0V10M12 14v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.5-7 9-4-1.5-7-4.6-7-9V6l7-3z" />
      <path d="M9.2 12.2l2 2 3.6-3.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 10-2.5 5.8" />
      <path d="M20 5v6h-6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0012.5 3H5.5A2.5 2.5 0 003 5.5v7A2.5 2.5 0 005.5 15" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M7.4 6.4a7.5 7.5 0 1010.2 0" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9L12 3.5z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </>
  ),
  enter: (
    <>
      <path d="M9 10l-5 5 5 5" />
      <path d="M20 4v7a4 4 0 01-4 4H4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.6 8.6 0 019.4 3.5a8.6 8.6 0 1011.1 11.1z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2.5" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12.1V5.5A2.5 2.5 0 015.5 3h6.6L21 11.9 11.9 21 3 12.1z" />
      <circle cx="7.6" cy="7.6" r="1.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20.2a7.2 7.2 0 0114 0" />
    </>
  ),
  network: (
    <>
      <path d="M4.5 11.5a10.5 10.5 0 0115 0" />
      <path d="M8 15a6.5 6.5 0 018 0" />
      <path d="M12 19h.01" />
    </>
  ),
  folder: (
    <path d="M3 7.5A2.5 2.5 0 015.5 5h3.2l2 2.2h7.8A2.5 2.5 0 0121 9.7v7.8a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5v-10z" />
  ),
  zap: <path d="M13.5 3L4.5 14H11l-1 7 9-11h-6.5l1-7z" />,
  file: (
    <>
      <path d="M6 3.5h7.5L19 9v11.5H6z" />
      <path d="M13.5 3.5V9H19" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4 4 0 005.7 0l2.8-2.8a4 4 0 10-5.7-5.7L11.4 6.4" />
      <path d="M14 10.5a4 4 0 00-5.7 0l-2.8 2.8a4 4 0 105.7 5.7l1.4-1.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M7.5 11.5L12 16l4.5-4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19V5" />
      <path d="M6.5 10.5L12 5l5.5 5.5" />
    </>
  ),
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
    </>
  ),
  'hard-drive': (
    <>
      <rect x="3" y="12" width="18" height="7" rx="2" />
      <path d="M5.5 12L8 5h8l2.5 7" />
      <path d="M7 15.5h.01M11 15.5h.01" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  size?: number;
  /** 星标等需要实心的图标 */
  filled?: boolean;
}

export function Icon({ name, size = 16, filled = false, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
