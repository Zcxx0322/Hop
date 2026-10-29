import type { HostDistro } from '../../types';
import { resolveDistroGlyph } from './distroIcons';
import { Icon } from './Icon';
import './DistroIcon.css';

interface DistroIconProps {
  distro?: HostDistro | null;
  /** 没有识别出发行版时用主机名首字兜底。 */
  fallbackText?: string;
  fallbackColor?: string;
  size?: number;
  className?: string;
}

/**
 * 主机图标：识别出发行版就画对应发行版标志（Simple Icons，CC0），
 * 否则回退到主机名首字。颜色取自图标本身，不跟着主题变。
 */
export function DistroIcon({
  distro,
  fallbackText,
  fallbackColor,
  size = 30,
  className,
}: DistroIconProps) {
  const glyph = resolveDistroGlyph(distro?.id);

  if (glyph) {
    return (
      <span
        className={`distro-icon ${className ?? ''}`}
        style={{
          width: size,
          height: size,
          background: `color-mix(in srgb, ${glyph.color} 16%, transparent)`,
          borderColor: `color-mix(in srgb, ${glyph.color} 38%, transparent)`,
          color: glyph.color,
        }}
        title={distro?.name ? `${distro.name}` : glyph.name}
      >
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} aria-hidden="true">
          <path d={glyph.path} fill="currentColor" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`distro-icon distro-icon--fallback ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: fallbackColor ? `${fallbackColor}26` : undefined,
        borderColor: fallbackColor ? `${fallbackColor}66` : undefined,
        color: fallbackColor ?? undefined,
        fontSize: Math.round(size * 0.43),
      }}
      title={distro?.name ?? '未识别到发行版'}
    >
      {fallbackText ? fallbackText.slice(0, 1) : <Icon name="server" size={Math.round(size * 0.5)} />}
    </span>
  );
}
