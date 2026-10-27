import type { Host } from '../types';

/** 主机色标可选值，新增主机时按顺序展示。 */
export const HOST_COLORS = [
  '#7c8cf8',
  '#43d9b8',
  '#f2b45c',
  '#f4718f',
  '#a78bfa',
  '#22d3ee',
];

function hash(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) >>> 0;
  }
  return value;
}

/** 主机没有显式色标时，用 id 稳定地派生一个颜色。 */
export function hostAccent(host: Pick<Host, 'id' | 'color'>): string {
  if (host.color) return host.color;
  return HOST_COLORS[hash(host.id) % HOST_COLORS.length];
}

const CJK = /[\u3400-\u9fff]/;

/** 头像缩写：中文取首字，拉丁取前两个词首字母。 */
export function hostInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (CJK.test(trimmed)) return Array.from(trimmed)[0];
  const words = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** 最近连接时间的相对描述。 */
export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '尚未连接';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚连接';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 地址栏展示：user@host:port */
export function formatAddress(host: Pick<Host, 'username' | 'host' | 'port'>): string {
  return `${host.username}@${host.host}:${host.port}`;
}
