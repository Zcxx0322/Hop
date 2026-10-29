/**
 * 终端主题（与界面主题相互独立）。
 *
 * - `follow`：读取界面主题的 --term-* 变量（见 src/styles/tokens.css / themes.css）
 * - 其余为写死的 xterm 配色，风格与同名界面主题对应，但可以单独切换
 */

export interface TerminalTheme {
  id: string;
  name: string;
  hint: string;
  /** 设置面板里的示意色：底色 / 前景 / 强调 */
  swatch: [string, string, string];
}

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'follow',
    name: '跟随界面',
    hint: '随界面主题自动变化',
    swatch: ['#000000', '#cfd8d3', '#2ee66b'],
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    hint: 'Atom One Dark',
    swatch: ['#282c34', '#abb2bf', '#61afef'],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    hint: 'Dracula',
    swatch: ['#282a36', '#f8f8f2', '#bd93f9'],
  },
  {
    id: 'nord',
    name: 'Nord',
    hint: 'Nord',
    swatch: ['#2e3440', '#d8dee9', '#88c0d0'],
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    hint: '东京夜景',
    swatch: ['#1a1b26', '#c0caf5', '#7aa2f7'],
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox',
    hint: 'Gruvbox Dark',
    swatch: ['#282828', '#ebdbb2', '#fabd2f'],
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    hint: 'Catppuccin Mocha',
    swatch: ['#1e1e2e', '#cdd6f4', '#cba6f7'],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    hint: 'Solarized 深色',
    swatch: ['#002b36', '#93a1a1', '#268bd2'],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    hint: 'Solarized 浅色',
    swatch: ['#fdf6e3', '#073642', '#268bd2'],
  },
];

const THEMES: Record<string, XtermTheme> = {
  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#61afef',
    cursorAccent: '#282c34',
    selectionBackground: 'rgba(97, 175, 239, 0.28)',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#bd93f9',
    cursorAccent: '#282a36',
    selectionBackground: 'rgba(189, 147, 249, 0.28)',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#88c0d0',
    cursorAccent: '#2e3440',
    selectionBackground: 'rgba(136, 192, 208, 0.28)',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#7aa2f7',
    cursorAccent: '#1a1b26',
    selectionBackground: 'rgba(122, 162, 247, 0.28)',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
  'gruvbox-dark': {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#fabd2f',
    cursorAccent: '#282828',
    selectionBackground: 'rgba(250, 189, 47, 0.24)',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
  catppuccin: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#cba6f7',
    cursorAccent: '#1e1e2e',
    selectionBackground: 'rgba(203, 166, 247, 0.26)',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#268bd2',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(38, 139, 210, 0.28)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#268bd2',
    cursorAccent: '#fdf6e3',
    selectionBackground: 'rgba(38, 139, 210, 0.2)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

export function isTerminalThemeId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_THEMES.some((theme) => theme.id === value);
}

/** `follow` 返回 null，由调用方从 CSS 变量里取色 */
export function terminalThemeById(id: string): XtermTheme | null {
  return THEMES[id] ?? null;
}
