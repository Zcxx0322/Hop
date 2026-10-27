import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  block = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn__spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />
      )}
      {children && <span className="btn__label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 14 : 15} />}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
  filled?: boolean;
  active?: boolean;
}

export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  filled = false,
  active = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`icon-btn icon-btn--${variant} icon-btn--${size}${
        active ? ' is-active' : ''
      } ${className}`.trim()}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} filled={filled} />
    </button>
  );
}
