import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { AuthMethod, Host, HostDraft } from '../types';
import { useApp } from '../store/AppStore';
import { HOST_COLORS, hostAccent, hostInitials } from '../lib/visual';
import type { IconName } from './ui/Icon';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Segmented, Switch, TextareaField, TextField } from './ui/Field';
import './HostFormDialog.css';

interface FormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath: string;
  /** 写时密码，只上行提交、绝不回显 */
  password: string;
  passphrase: string;
  tags: string;
  color: string;
  note: string;
  favorite: boolean;
}

type FieldErrors = Partial<
  Record<'name' | 'host' | 'port' | 'username' | 'privateKeyPath' | 'password' | 'tags', string>
>;

const AUTH_OPTIONS: Array<{ value: AuthMethod; label: string; icon: IconName }> = [
  { value: 'key', label: '密钥', icon: 'key' },
  { value: 'password', label: '密码', icon: 'lock' },
  { value: 'agent', label: 'SSH Agent', icon: 'shield' },
];

const HOST_PATTERN = /^[a-zA-Z0-9._:[\]-]+$/;

function parseTags(raw: string): string[] {
  const unique = new Set<string>();
  for (const tag of raw.split(/[,，\s]+/)) {
    const value = tag.trim();
    if (value) unique.add(value.slice(0, 24));
    if (unique.size >= 8) break;
  }
  return Array.from(unique);
}

function toFormValues(host: Host | null, defaults: { username: string; port: number }): FormValues {
  if (!host) {
    return {
      name: '',
      host: '',
      port: String(defaults.port),
      username: defaults.username,
      authMethod: 'key',
      privateKeyPath: '',
      password: '',
      passphrase: '',
      tags: '',
      color: '',
      note: '',
      favorite: false,
    };
  }
  return {
    name: host.name,
    host: host.host,
    port: String(host.port),
    username: host.username,
    authMethod: host.authMethod,
    privateKeyPath: host.privateKeyPath ?? '',
    password: '',
    passphrase: '',
    tags: host.tags.join(', '),
    color: host.color ?? '',
    note: host.note ?? '',
    favorite: Boolean(host.favorite),
  };
}

export function HostFormDialog() {
  const { state } = useApp();
  const hostForm = state.ui.hostForm;
  if (!hostForm) return null;
  return (
    <HostFormInner
      key={hostForm.hostId ?? 'new'}
      hostId={hostForm.hostId}
    />
  );
}

function HostFormInner({ hostId }: { hostId: string | null }) {
  const { state, actions } = useApp();
  const existing = hostId ? (state.hosts.find((host) => host.id === hostId) ?? null) : null;

  const [form, setForm] = useState<FormValues>(() =>
    toFormValues(existing, {
      username: state.settings.defaultUsername,
      port: state.settings.defaultPort,
    }),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.getElementById('host-name')?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  const patch = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const accent = hostAccent({ id: existing?.id ?? 'preview', color: form.color });

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!form.name.trim()) next.name = '给这台主机起一个便于识别的名字';
    else if (form.name.trim().length > 48) next.name = '名称请控制在 48 个字符以内';

    const hostValue = form.host.trim();
    if (!hostValue) next.host = '填写域名或 IP 地址';
    else if (/\s/.test(hostValue)) next.host = '地址里不能包含空格';
    else if (!HOST_PATTERN.test(hostValue)) next.host = '只支持域名、IPv4 或 IPv6 地址';

    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) next.port = '端口需在 1–65535 之间';

    if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) next.username = '填写有效的登录用户名';

    if (form.authMethod === 'key' && !form.privateKeyPath.trim()) {
      next.privateKeyPath = '密钥登录需要填写私钥路径';
    }

    if (form.authMethod === 'password' && !form.password && !existing?.hasPassword) {
      next.password = '填写登录密码，或改用密钥 / SSH Agent';
    }
    if (parseTags(form.tags).length > 8) next.tags = '最多保留 8 个标签';

    return next;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      actions.toast('error', '请检查表单里标记的字段');
      return;
    }

    const draft: HostDraft = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      authMethod: form.authMethod,
      privateKeyPath: form.authMethod === 'key' ? form.privateKeyPath.trim() : '',
      ...(form.authMethod === 'password' && form.password ? { password: form.password } : {}),
      ...(form.authMethod === 'key' && form.passphrase ? { passphrase: form.passphrase } : {}),
      tags: parseTags(form.tags),
      color: form.color,
      note: form.note.trim(),
      favorite: form.favorite,
    };

    setSaving(true);
    const host = existing
      ? await actions.updateHost(existing.id, draft)
      : await actions.createHost(draft);
    setSaving(false);
    if (host && !existing) {
      // 新建成功后直接打开一个会话，符合“保存即用”的预期
      actions.connectHost(host);
    }
  };

  const handleHostBlur = () => {
    let value = form.host.trim().replace(/^ssh:\/\//i, '');
    if (!value) return;
    const match = /^([^@\s]+)@([^:\s]+)(?::(\d+))?$/.exec(value);
    if (match) {
      setForm((current) => ({
        ...current,
        host: match[2],
        username: current.username.trim() ? current.username : match[1],
        port: match[3] && Number(match[3]) <= 65535 ? match[3] : current.port,
      }));
      setErrors((current) => ({ ...current, host: undefined }));
      return;
    }
    if (value !== form.host) {
      setForm((current) => ({ ...current, host: value }));
    }
  };

  const tagPreview = parseTags(form.tags);
  const isEdit = Boolean(existing);

  return (
    <Modal
      open
      onClose={actions.closeHostForm}
      title={isEdit ? '编辑主机' : '新建连接'}
      description={
        isEdit ? '修改后立即生效，已打开的会话不受影响。' : '保存到主机列表，随时一键回到这台服务器。'
      }
      size="lg"
      dismissible={!saving}
      footer={
        <div className="hostform__footer">
          <span className="hostform__foot-note">
            <kbd className="kbd">Enter</kbd> 保存 · <kbd className="kbd">Esc</kbd> 取消
          </span>
          <div className="hostform__foot-actions">
            <Button variant="secondary" onClick={actions.closeHostForm} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="host-form" variant="primary" loading={saving} icon="check">
              {isEdit ? '保存修改' : '保存并连接'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="host-form" className="hostform" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="hostform__preview" aria-hidden="true">
          <span
            className="hostform__preview-avatar"
            style={{ '--host-color': accent } as CSSProperties}
          >
            {hostInitials(form.name || form.host || '新主机')}
          </span>
          <span className="hostform__preview-main">
            <span className="hostform__preview-name">{form.name.trim() || '未命名主机'}</span>
            <span className="hostform__preview-addr mono">
              {(form.username.trim() || 'user') + '@' + (form.host.trim() || 'host') + ':' + (form.port || '22')}
            </span>
          </span>
          <span className="hostform__preview-auth">{AUTH_OPTIONS.find((option) => option.value === form.authMethod)?.label}</span>
        </div>

        <fieldset className="hostform__section">
          <legend>基本信息</legend>
          <div className="hostform__grid">
            <TextField
              id="host-name"
              label="名称"
              placeholder="例如：生产 Web 网关"
              value={form.name}
              error={errors.name}
              maxLength={48}
              autoComplete="off"
              onChange={(event) => patch('name', event.target.value)}
            />
            <TextField
              label="标签"
              placeholder="生产, nginx"
              value={form.tags}
              error={errors.tags}
              hint="用逗号分隔，最多 8 个"
              autoComplete="off"
              onChange={(event) => patch('tags', event.target.value)}
            />
          </div>
          {tagPreview.length > 0 && (
            <div className="hostform__tag-preview" aria-label="标签预览">
              {tagPreview.map((tag) => (
                <span key={tag} className="hostform__tag">
                  <Icon name="tag" size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="hostform__section">
          <legend>连接</legend>
          <div className="hostform__grid hostform__grid--target">
            <TextField
              label="主机地址"
              placeholder="10.0.4.21 或 example.com"
              value={form.host}
              error={errors.host}
              hint="可粘贴 user@host:port，会自动拆分"
              autoComplete="off"
              spellCheck={false}
              className="hostform__host"
              onChange={(event) => patch('host', event.target.value)}
              onBlur={handleHostBlur}
            />
            <TextField
              label="端口"
              inputMode="numeric"
              value={form.port}
              error={errors.port}
              maxLength={5}
              onChange={(event) => patch('port', event.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
          <div className="hostform__grid">
            <TextField
              label="用户名"
              placeholder="root"
              value={form.username}
              error={errors.username}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => patch('username', event.target.value)}
            />
            <div className="hostform__auth">
              <span className="hostform__label">认证方式</span>
              <Segmented
                label="认证方式"
                value={form.authMethod}
                options={AUTH_OPTIONS}
                onChange={(value) => {
                  patch('authMethod', value);
                  if (value === 'key' && !form.privateKeyPath.trim()) {
                    patch('privateKeyPath', '~/.ssh/id_ed25519');
                  }
                }}
              />
            </div>
          </div>

          {form.authMethod === 'key' && (
            <>
              <TextField
                label="私钥路径"
                placeholder="~/.ssh/id_ed25519"
                value={form.privateKeyPath}
                error={errors.privateKeyPath}
                hint="私钥内容由本机后端读取，不会上传"
                prefix={<Icon name="key" size={13} />}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => patch('privateKeyPath', event.target.value)}
              />
              <TextField
                label="私钥口令（可选）"
                type="password"
                placeholder="私钥没有口令时留空"
                value={form.passphrase}
                hint="口令同样加密保存，明文不会回传"
                prefix={<Icon name="lock" size={13} />}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(event) => patch('passphrase', event.target.value)}
              />
            </>
          )}
          {form.authMethod === 'password' && (
            <TextField
              label="登录密码"
              type="password"
              placeholder={
                existing?.hasPassword ? '已保存密码，留空则保持不变' : '仅保存在本机加密存储'
              }
              value={form.password}
              error={errors.password}
              hint="DPAPI / Keychain 加密，明文不会回传"
              prefix={<Icon name="lock" size={13} />}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => patch('password', event.target.value)}
            />
          )}
          {form.authMethod === 'agent' && (
            <p className="hostform__note-line">
              <Icon name="shield" size={12} />
              使用 ssh-agent 中已加载的密钥，无需填写私钥路径。
            </p>
          )}
        </fieldset>

        <fieldset className="hostform__section">
          <legend>外观与备注</legend>
          <div className="hostform__appearance">
            <div className="hostform__colors" role="group" aria-label="主机色标">
              <span className="hostform__label">色标</span>
              <div className="hostform__swatches">
                <button
                  type="button"
                  className={`hostform__swatch hostform__swatch--auto${form.color === '' ? ' is-active' : ''}`}
                  aria-label="自动配色"
                  aria-pressed={form.color === ''}
                  title="自动配色"
                  onClick={() => patch('color', '')}
                >
                  <Icon name="spark" size={11} />
                </button>
                {HOST_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`hostform__swatch${form.color === color ? ' is-active' : ''}`}
                    style={{ '--host-color': color } as CSSProperties}
                    aria-label={`使用颜色 ${color}`}
                    aria-pressed={form.color === color}
                    onClick={() => patch('color', color)}
                  />
                ))}
              </div>
            </div>
            <Switch
              label="收藏这台主机"
              description="收藏后会置顶显示"
              checked={form.favorite}
              onChange={(checked) => patch('favorite', checked)}
            />
          </div>

          <TextareaField
            label="备注"
            placeholder="跳板机、用途、维护窗口……"
            rows={2}
            maxLength={500}
            value={form.note}
            onChange={(event) => patch('note', event.target.value)}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
