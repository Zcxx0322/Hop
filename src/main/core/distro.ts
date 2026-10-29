import type { Client } from 'ssh2';
import type { HostDistro } from '../../shared/contract';
import { createLogger } from './logger';
import { execOnce } from './remote';

const log = createLogger('distro');

/**
 * 只读探测远端发行版：优先 os-release（几乎所有现代发行版都有），
 * 拿不到就退回 `uname -s`。命令本身不写任何东西，输出也很小。
 */
const PROBE = [
  'cat /etc/os-release 2>/dev/null',
  'echo "##uname"',
  'uname -s 2>/dev/null',
].join('; ');

const UNAME_TO_ID: Record<string, { id: string; name: string }> = {
  Linux: { id: 'linux', name: 'Linux' },
  FreeBSD: { id: 'freebsd', name: 'FreeBSD' },
  Darwin: { id: 'apple', name: 'macOS' },
  OpenBSD: { id: 'openbsd', name: 'OpenBSD' },
  NetBSD: { id: 'netbsd', name: 'NetBSD' },
};

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

/** 把 os-release 文本解析成稳定的 `HostDistro`，解析不出来时回退 uname。 */
export function parseOsRelease(raw: string): HostDistro | null {
  const [osPart = '', unamePart = ''] = raw.split('##uname');
  const fields = new Map<string, string>();

  for (const line of osPart.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) fields.set(match[1], unquote(match[2]));
  }

  const uname = unamePart.split(/\r?\n/)[0]?.trim() ?? '';
  const fallback = UNAME_TO_ID[uname] ?? null;

  const id = (fields.get('ID') ?? '').toLowerCase();
  if (!id) {
    return fallback ? { ...fallback, version: '' } : null;
  }

  const pretty = fields.get('PRETTY_NAME') ?? fields.get('NAME') ?? id;
  const version = fields.get('VERSION_ID') ?? '';

  return {
    id,
    name: pretty.slice(0, 80),
    version: version.slice(0, 32),
  };
}

export async function detectDistro(client: Client): Promise<HostDistro | null> {
  const output = await execOnce(client, PROBE, 6_000);
  const distro = parseOsRelease(output);
  if (distro) {
    log.info('distro detected', { id: distro.id, version: distro.version });
  }
  return distro;
}
