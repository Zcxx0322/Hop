import type { Host, HostDraft } from '../types';

/** 把完整 Host 还原成可提交的草稿（收藏开关等局部更新时复用）。 */
export function toHostDraft(host: Host): HostDraft {
  return {
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    authMethod: host.authMethod,
    privateKeyPath: host.privateKeyPath ?? '',
    tags: host.tags,
    color: host.color ?? '',
    note: host.note ?? '',
    favorite: Boolean(host.favorite),
  };
}
