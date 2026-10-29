/**
 * Hop 领域模型。
 * 这里的类型即前后端共享契约，与 docs/API-CONTRACT.md 一一对应。
 */

export type AuthMethod = 'password' | 'key' | 'agent';

export interface Host {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  tags: string[];
  color?: string;
  note?: string;
  favorite?: boolean;
  lastConnectedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  /** 只读：后端是否保存了登录密码（明文永不回传） */
  hasPassword?: boolean;
  /** 只读：私钥指纹，用于在列表/详情里做二次确认 */
  keyFingerprint?: string;
}

/**
 * 新建/更新主机时提交的数据。
 * password / passphrase 只在写操作时上行，读取接口永远不会返回。
 */
export type HostDraft = Omit<
  Host,
  'id' | 'createdAt' | 'updatedAt' | 'lastConnectedAt' | 'hasPassword' | 'keyFingerprint'
> & {
  password?: string;
  passphrase?: string;
};

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface Session {
  id: string;
  hostId: string;
  title: string;
  address: string;
  status: SessionStatus;
  detail?: string;
  createdAt: number;
  /** 标题栏「重新连接」递增，终端面板据此重建传输层 */
  reconnectNonce?: number;
}

export type ThemeMode = 'dark' | 'light' | 'system';

export type AccentKey = 'green';

export type FontKey = 'jetbrains' | 'cascadia' | 'menlo' | 'system';

export type CursorStyle = 'block' | 'bar' | 'underline';

export interface Settings {
  theme: ThemeMode;
  accent: AccentKey;
  fontSize: number;
  fontFamily: FontKey;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  confirmOnClose: boolean;
  defaultUsername: string;
  defaultPort: number;
  keepAliveSeconds: number;
  connectTimeoutMs: number;
  /** 终端内选中文本即复制到剪贴板 */
  copyOnSelect: boolean;
  /** 复制快捷键：Ctrl+C（有选中时复制，无选中时发送中断）/ Ctrl+Shift+C */
  copyShortcut: 'ctrl-c' | 'ctrl-shift-c';
  /** 复制成功是否弹提示 */
  copyToast: boolean;
  /** 粘贴触发方式：Ctrl+V 直接粘贴 / 右键直接粘贴 */
  pasteMode: 'ctrl-v' | 'right-click';
  /** 右侧常驻面板宽度（像素） */
  dockWidth: number;
}

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}
