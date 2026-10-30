import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
  size?: 'md' | 'sm';
}

/**
 * 自绘下拉选择：原生 `<select>` 的弹层由系统绘制，配色和圆角都跟应用不搭，
 * 这里用按钮 + listbox 弹层重做，键盘（↑ ↓ Home End Enter Esc）与点击外部都能用。
 */
export function Select({
  value,
  options,
  onChange,
  id,
  disabled,
  ariaLabel,
  title,
  className = '',
  size = 'md',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${Math.max(0, options.findIndex((o) => o.value === value))}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, options, value]);

  const commit = useCallback(
    (next: string) => {
      setOpen(false);
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => {
        const next = Math.min(options.length - 1, Math.max(0, index + delta));
        listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) commit(option.value);
    }
  };

  return (
    <div ref={rootRef} className={`ui-select ui-select--${size} ${className}`.trim()}>
      <button
        type="button"
        id={id}
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onKeyDown}
      >
        <span className="ui-select__value truncate">{selected?.label ?? ''}</span>
        <Icon name="chevron-down" size={13} className="ui-select__chevron" />
      </button>

      {open && (
        <div ref={listRef} id={listId} className="ui-select__list" role="listbox" tabIndex={-1}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-index={index}
              className={`ui-select__option${option.value === value ? ' is-selected' : ''}${
                index === activeIndex ? ' is-active' : ''
              }`}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => commit(option.value)}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
