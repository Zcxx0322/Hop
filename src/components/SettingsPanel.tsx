import type { CSSProperties } from 'react';
import { useApp } from '../store/AppStore';
import { ACCENTS, DEFAULT_SETTINGS, FONT_STACKS, SCROLLBACK_OPTIONS } from '../store/settings';
import type { CursorStyle, FontKey, ThemeMode } from '../types';
import type { Settings } from '../types';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Segmented, SelectField, Switch, TextField } from './ui/Field';
import './SettingsPanel.css';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: 'moon' | 'sun' | 'monitor' }> = [
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
];

const CURSOR_OPTIONS: Array<{ value: CursorStyle; label: string }> = [
  { value: 'block', label: '方块' },
  { value: 'bar', label: '竖线' },
  { value: 'underline', label: '下划线' },
];

const PASTE_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ctrl-v', label: 'Ctrl+V' },
  { value: 'right-click', label: '右键直接粘贴' },
];

const COPY_SHORTCUT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ctrl-c', label: 'Ctrl+C' },
  { value: 'ctrl-shift-c', label: 'Ctrl+Shift+C' },
];

const KEEPALIVE_OPTIONS = [
  { value: '0', label: '关闭' },
  { value: '15', label: '15 秒' },
  { value: '30', label: '30 秒' },
  { value: '60', label: '60 秒' },
];

const TIMEOUT_OPTIONS = [
  { value: '5000', label: '5 秒' },
  { value: '10000', label: '10 秒' },
  { value: '15000', label: '15 秒' },
  { value: '30000', label: '30 秒' },
];

export function SettingsPanel() {
  const { state, actions } = useApp();
  const { settings } = state;

  if (!state.ui.settingsOpen) return null;

  const fontStack = FONT_STACKS[settings.fontFamily].stack;

  return (
    <Modal
      open
      onClose={() => actions.setSettingsOpen(false)}
      title="偏好设置"
      description="所有改动都会即时生效，并保存在本机。"
      size="lg"
      variant="drawer"
      footer={
        <div className="settings-panel__footer">
          <span className="settings-panel__saved">
            <Icon name="check" size={12} /> 自动保存
          </span>
          <div className="settings-panel__footer-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                actions.updateSettings({ ...DEFAULT_SETTINGS });
                actions.toast('info', '已恢复默认设置');
              }}
            >
              恢复默认
            </Button>
            <Button variant="primary" size="sm" onClick={() => actions.setSettingsOpen(false)}>
              完成
            </Button>
          </div>
        </div>
      }
    >
      <div className="settings-panel">
        <section className="settings-group" aria-labelledby="settings-appearance">
          <h3 className="settings-group__title" id="settings-appearance">
            外观
          </h3>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">主题</span>
              <span className="settings-row__desc">界面明暗模式</span>
            </div>
            <Segmented
              label="主题"
              size="sm"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(value) => actions.updateSettings({ theme: value })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">折叠侧栏</span>
              <span className="settings-row__desc">只保留主机头像轨道</span>
            </div>
            <Switch
              label="折叠侧栏"
              checked={settings.sidebarCollapsed}
              onChange={(checked) => actions.updateSettings({ sidebarCollapsed: checked })}
            />
          </div>
        </section>

        <section className="settings-group" aria-labelledby="settings-terminal">
          <h3 className="settings-group__title" id="settings-terminal">
            终端
          </h3>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">字体</span>
              <span className="settings-row__desc">等宽字体，影响所有会话</span>
            </div>
            <SelectField
              label="终端字体"
              className="settings-control"
              value={settings.fontFamily}
              options={(Object.keys(FONT_STACKS) as FontKey[]).map((key) => ({
                value: key,
                label: FONT_STACKS[key].label,
              }))}
              onChange={(event) =>
                actions.updateSettings({ fontFamily: event.target.value as FontKey })
              }
            />
          </div>

          <div className="settings-row settings-row--stack">
            <div className="settings-row__text">
              <span className="settings-row__label">字号</span>
              <span className="settings-row__desc">调整后自动重新适配行列</span>
            </div>
            <div className="settings-range">
              <input
                type="range"
                min={11}
                max={20}
                step={1}
                value={settings.fontSize}
                aria-label="终端字号"
                style={
                  {
                    '--range-progress': `${((settings.fontSize - 11) / 9) * 100}%`,
                  } as CSSProperties
                }
                onChange={(event) =>
                  actions.updateSettings({ fontSize: Number(event.target.value) })
                }
              />
              <span className="settings-range__value mono">{settings.fontSize}px</span>
            </div>
            <div
              className="settings-terminal-preview mono"
              style={{ fontFamily: fontStack, fontSize: settings.fontSize }}
              aria-hidden="true"
            >
              <span className="settings-terminal-preview__prompt">root@prod-web</span>
              <span className="settings-terminal-preview__path">:~$</span> uptime
              <span
                className={`settings-terminal-preview__cursor settings-terminal-preview__cursor--${settings.cursorStyle}${
                  settings.cursorBlink ? ' is-blinking' : ''
                }`}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">光标样式</span>
              <span className="settings-row__desc">方块 / 竖线 / 下划线</span>
            </div>
            <Segmented
              label="光标样式"
              size="sm"
              value={settings.cursorStyle}
              options={CURSOR_OPTIONS}
              onChange={(value) => actions.updateSettings({ cursorStyle: value })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">光标闪烁</span>
              <span className="settings-row__desc">仅在窗口聚焦时闪烁</span>
            </div>
            <Switch
              label="光标闪烁"
              checked={settings.cursorBlink}
              onChange={(checked) => actions.updateSettings({ cursorBlink: checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">回滚缓冲区</span>
              <span className="settings-row__desc">每个会话保留的历史行数</span>
            </div>
            <SelectField
              label="回滚行数"
              className="settings-control"
              value={String(settings.scrollback)}
              options={SCROLLBACK_OPTIONS.map((value) => ({
                value: String(value),
                label: value.toLocaleString('zh-CN'),
              }))}
              onChange={(event) =>
                actions.updateSettings({ scrollback: Number(event.target.value) })
              }
            />
          </div>
        </section>

        <section className="settings-group" aria-labelledby="settings-clipboard">
          <h3 className="settings-group__title" id="settings-clipboard">
            复制与粘贴
          </h3>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">选中即复制</span>
              <span className="settings-row__desc">在终端里选中文本时自动写入剪贴板（纯文本）</span>
            </div>
            <Switch
              label="选中即复制"
              checked={settings.copyOnSelect}
              onChange={(checked) => actions.updateSettings({ copyOnSelect: checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">复制快捷键</span>
              <span className="settings-row__desc">
                Ctrl+C 只在有选中内容时复制，否则照常发送中断
              </span>
            </div>
            <Segmented
              label="复制快捷键"
              value={settings.copyShortcut}
              options={COPY_SHORTCUT_OPTIONS}
              onChange={(value) =>
                actions.updateSettings({ copyShortcut: value as Settings['copyShortcut'] })
              }
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">复制成功提示</span>
              <span className="settings-row__desc">复制后弹一个轻提示，方便确认已进剪贴板</span>
            </div>
            <Switch
              label="复制成功提示"
              checked={settings.copyToast}
              onChange={(checked) => actions.updateSettings({ copyToast: checked })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">粘贴方式</span>
              <span className="settings-row__desc">
                {settings.pasteMode === 'ctrl-v'
                  ? 'Ctrl+V（或 Ctrl+Shift+V / Shift+Insert）直接粘贴'
                  : '在终端里点右键直接粘贴'}
              </span>
            </div>
            <Segmented
              label="粘贴方式"
              value={settings.pasteMode}
              options={PASTE_MODE_OPTIONS}
              onChange={(value) =>
                actions.updateSettings({ pasteMode: value as Settings['pasteMode'] })
              }
            />
          </div>

          <p className="settings-hint">
            复制始终输出纯文本；<kbd>Ctrl+Shift+C</kbd> 在任何设置下都能复制。
          </p>
        </section>

        <section className="settings-group" aria-labelledby="settings-connection">
          <h3 className="settings-group__title" id="settings-connection">
            连接
          </h3>

          <div className="settings-grid">
            <TextField
              label="默认用户名"
              placeholder="留空则每次填写"
              value={settings.defaultUsername}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => actions.updateSettings({ defaultUsername: event.target.value })}
            />
            <TextField
              label="默认端口"
              inputMode="numeric"
              value={String(settings.defaultPort)}
              onChange={(event) => {
                const value = Number(event.target.value.replace(/[^\d]/g, ''));
                if (value >= 1 && value <= 65535) actions.updateSettings({ defaultPort: value });
              }}
            />
            <SelectField
              label="心跳间隔"
              hint="保持长连接活跃"
              value={String(settings.keepAliveSeconds)}
              options={KEEPALIVE_OPTIONS}
              onChange={(event) =>
                actions.updateSettings({ keepAliveSeconds: Number(event.target.value) })
              }
            />
            <SelectField
              label="连接超时"
              hint="握手阶段的等待上限"
              value={String(settings.connectTimeoutMs)}
              options={TIMEOUT_OPTIONS}
              onChange={(event) =>
                actions.updateSettings({ connectTimeoutMs: Number(event.target.value) })
              }
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <span className="settings-row__label">关闭会话前确认</span>
              <span className="settings-row__desc">避免误触断开正在运行的命令</span>
            </div>
            <Switch
              label="关闭会话前确认"
              checked={settings.confirmOnClose}
              onChange={(checked) => actions.updateSettings({ confirmOnClose: checked })}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}
