import type { AccentKey, FontKey, Settings } from '../types';

const STORAGE_KEY = 'hop.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'green',
  fontSize: 13,
  fontFamily: 'jetbrains',
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 5000,
  confirmOnClose: false,
  defaultUsername: '',
  defaultPort: 22,
  keepAliveSeconds: 30,
  connectTimeoutMs: 15_000,
  copyOnSelect: true,
  copyShortcut: 'ctrl-c',
  copyToast: true,
  pasteMode: 'ctrl-v',
  followCwd: false,
  dockWidth: 332,
};

export const ACCENTS: Array<{
  key: AccentKey;
  label: string;
  swatch: string;
  swatch2: string;
}> = [{ key: 'green', label: '翠绿', swatch: '#2ee66b', swatch2: '#7bf5a3' }];

export const FONT_STACKS: Record<FontKey, { label: string; stack: string }> = {
  jetbrains: {
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', 'SFMono-Regular', 'Cascadia Code', Consolas, monospace",
  },
  cascadia: {
    label: 'Cascadia Code',
    stack: "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace",
  },
  menlo: {
    label: 'Menlo / Monaco',
    stack: "Menlo, Monaco, 'SFMono-Regular', Consolas, monospace",
  },
  system: {
    label: '系统等宽',
    stack:
      "ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
  },
};

export const SCROLLBACK_OPTIONS = [1000, 5000, 10_000, 50_000] as const;

const THEMES = ['dark', 'light', 'system'] as const;
const ACCENT_KEYS = ACCENTS.map((item) => item.key);
const FONT_KEYS = Object.keys(FONT_STACKS) as FontKey[];
const CURSORS = ['block', 'bar', 'underline'] as const;
const COPY_SHORTCUTS = ['ctrl-c', 'ctrl-shift-c'] as const;

/** 旧版本只有 both / shortcut / context 三种，升级时映射到新的两种模式。 */
function migratePasteMode(value: unknown): Settings['pasteMode'] {
  if (value === 'right-click') return 'right-click';
  if (value === 'ctrl-v') return 'ctrl-v';
  if (value === 'context') return 'right-click';
  return DEFAULT_SETTINGS.pasteMode;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(Math.round(value), min), max);

/** 兜底清洗，避免 localStorage 里的旧数据或手改数据破坏界面。 */
export function normalizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  return {
    ...merged,
    theme: THEMES.includes(merged.theme) ? merged.theme : DEFAULT_SETTINGS.theme,
    accent: ACCENT_KEYS.includes(merged.accent) ? merged.accent : DEFAULT_SETTINGS.accent,
    fontSize: Number.isFinite(merged.fontSize)
      ? clamp(merged.fontSize, 11, 20)
      : DEFAULT_SETTINGS.fontSize,
    fontFamily: FONT_KEYS.includes(merged.fontFamily)
      ? merged.fontFamily
      : DEFAULT_SETTINGS.fontFamily,
    cursorStyle: CURSORS.includes(merged.cursorStyle)
      ? merged.cursorStyle
      : DEFAULT_SETTINGS.cursorStyle,
    scrollback: [1000, 5000, 10_000, 50_000].includes(merged.scrollback)
      ? merged.scrollback
      : DEFAULT_SETTINGS.scrollback,
    confirmOnClose: Boolean(merged.confirmOnClose),
      cursorBlink: Boolean(merged.cursorBlink),
    defaultUsername: String(merged.defaultUsername ?? '').slice(0, 64),
    defaultPort: Number.isFinite(merged.defaultPort)
      ? clamp(merged.defaultPort, 1, 65_535)
      : DEFAULT_SETTINGS.defaultPort,
    keepAliveSeconds: Number.isFinite(merged.keepAliveSeconds)
      ? clamp(merged.keepAliveSeconds, 0, 600)
      : DEFAULT_SETTINGS.keepAliveSeconds,
    connectTimeoutMs: Number.isFinite(merged.connectTimeoutMs)
      ? clamp(merged.connectTimeoutMs, 3000, 60_000)
      : DEFAULT_SETTINGS.connectTimeoutMs,
    copyOnSelect: Boolean(merged.copyOnSelect),
    copyShortcut: COPY_SHORTCUTS.includes(merged.copyShortcut)
      ? merged.copyShortcut
      : DEFAULT_SETTINGS.copyShortcut,
    copyToast: merged.copyToast === undefined ? true : Boolean(merged.copyToast),
    pasteMode: migratePasteMode(merged.pasteMode),
    followCwd: typeof merged.followCwd === 'boolean' ? merged.followCwd : DEFAULT_SETTINGS.followCwd,
    dockWidth: Number.isFinite(merged.dockWidth)
      ? clamp(merged.dockWidth, 260, 620)
      : DEFAULT_SETTINGS.dockWidth,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}
