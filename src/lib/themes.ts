/**
 * 界面主题（外部主题）。
 *
 * 每套主题 = 一个 `base`（dark / light，决定阴影、滚动条与系统配色）
 *            + `src/styles/themes.css` 里的一组 CSS 变量覆盖。
 * 「跟随系统」不是独立配色，而是在 hop-black / hop-white 之间自动切换。
 */

export type PaletteBase = 'dark' | 'light';

export interface UiPalette {
  id: string;
  name: string;
  base: PaletteBase;
  /** 一句话来源说明，展示在设置里 */
  hint: string;
  /** 设置面板里的三色示意：底色 / 面板 / 强调色 */
  swatch: [string, string, string];
}

export const UI_PALETTES: UiPalette[] = [
  {
    id: 'auto',
    name: '跟随系统',
    base: 'dark',
    hint: '深色系统用纯黑，浅色系统用纯白',
    swatch: ['#000000', '#101310', '#2ee66b'],
  },
  {
    id: 'hop-black',
    name: '纯黑 + 绿',
    base: 'dark',
    hint: 'Hop 默认',
    swatch: ['#000000', '#101310', '#2ee66b'],
  },
  {
    id: 'hop-white',
    name: '纯白 + 绿',
    base: 'light',
    hint: 'Hop 默认',
    swatch: ['#ffffff', '#f4f7f4', '#12a150'],
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    base: 'dark',
    hint: 'Atom One Dark',
    swatch: ['#282c34', '#353b45', '#61afef'],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    base: 'dark',
    hint: 'Dracula 官方配色',
    swatch: ['#282a36', '#343746', '#bd93f9'],
  },
  {
    id: 'nord',
    name: 'Nord',
    base: 'dark',
    hint: 'Nord 极地蓝',
    swatch: ['#2e3440', '#3b4252', '#88c0d0'],
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    base: 'dark',
    hint: '东京夜景',
    swatch: ['#1a1b26', '#24283b', '#7aa2f7'],
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox',
    base: 'dark',
    hint: 'Gruvbox Dark',
    swatch: ['#282828', '#3c3836', '#fabd2f'],
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    base: 'dark',
    hint: 'Catppuccin Mocha',
    swatch: ['#1e1e2e', '#313244', '#cba6f7'],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    base: 'dark',
    hint: 'Solarized 深色',
    swatch: ['#002b36', '#073642', '#268bd2'],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    base: 'light',
    hint: 'Solarized 浅色',
    swatch: ['#fdf6e3', '#f5efdc', '#268bd2'],
  },
];

const BY_ID = new Map(UI_PALETTES.map((palette) => [palette.id, palette]));

export function isPaletteId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/**
 * 把设置里的主题 id 解析成真正要写到 <html data-palette> 上的 id。
 * `auto` 与未知值都会落到 hop-black / hop-white。
 */
export function resolvePalette(
  id: string,
  systemDark: boolean,
): { id: string; base: PaletteBase } {
  const palette = BY_ID.get(id);
  if (!palette || palette.id === 'auto') {
    const fallback = systemDark ? 'hop-black' : 'hop-white';
    return { id: fallback, base: BY_ID.get(fallback)!.base };
  }
  return { id: palette.id, base: palette.base };
}

export function paletteById(id: string): UiPalette {
  return BY_ID.get(id) ?? UI_PALETTES[1];
}
