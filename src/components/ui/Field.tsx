import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './Icon';
import './Field.css';

/* ------------------------------------------------------------------ */
/* 文本输入                                                            */
/* ------------------------------------------------------------------ */

interface FieldExtras {
  label: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export type TextFieldProps = FieldExtras &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>;

export function TextField({
  label,
  hint,
  error,
  prefix,
  suffix,
  id,
  className = '',
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className={`field__control${error ? ' is-invalid' : ''}`}>
        {prefix && <span className="field__affix">{prefix}</span>}
        <input id={inputId} className="field__input" aria-invalid={error ? true : undefined} {...rest} />
        {suffix && <span className="field__affix">{suffix}</span>}
      </div>
      {(error || hint) && (
        <p className={`field__hint${error ? ' is-error' : ''}`}>{error ?? hint}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 下拉选择                                                            */
/* ------------------------------------------------------------------ */

export interface SelectFieldProps
  extends FieldExtras,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'prefix'> {
  options: Array<{ value: string; label: string }>;
}

export function SelectField({
  label,
  hint,
  error,
  options,
  prefix: _prefix,
  suffix: _suffix,
  id,
  className = '',
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={selectId}>
        {label}
      </label>
      <div className={`field__control field__control--select${error ? ' is-invalid' : ''}`}>
        <select id={selectId} className="field__input field__select" {...rest}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} className="field__chevron" />
      </div>
      {(error || hint) && (
        <p className={`field__hint${error ? ' is-error' : ''}`}>{error ?? hint}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 多行文本                                                            */
/* ------------------------------------------------------------------ */

export type TextareaFieldProps = FieldExtras &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'prefix'>;

export function TextareaField({
  label,
  hint,
  error,
  prefix: _prefix,
  suffix: _suffix,
  id,
  className = '',
  rows = 3,
  ...rest
}: TextareaFieldProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={textareaId}>
        {label}
      </label>
      <div className={`field__control field__control--area${error ? ' is-invalid' : ''}`}>
        <textarea id={textareaId} className="field__input" rows={rows} {...rest} />
      </div>
      {(error || hint) && (
        <p className={`field__hint${error ? ' is-error' : ''}`}>{error ?? hint}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 开关                                                                */
/* ------------------------------------------------------------------ */

export interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  return (
    <label className={`switch-row${disabled ? ' is-disabled' : ''}`}>
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {description && <span className="switch-row__desc">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* 分段控件                                                            */
/* ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: SegmentedProps<T>) {
  return (
    <div className={`segmented segmented--${size}`} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`segmented__item${active ? ' is-active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={14} />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
