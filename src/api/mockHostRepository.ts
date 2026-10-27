import type { Host, HostDraft } from '../types';
import type { HostRepository } from './hostRepository';

const STORAGE_KEY = 'hop.hosts.v1';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `host_${Math.random().toString(36).slice(2, 10)}`;

const now = Date.now();

/** 首次进入模拟模式时预置的示例主机，让界面一打开就有内容可看。 */
function seedHosts(): Host[] {
  const base = { createdAt: now, updatedAt: now };
  return [
    {
      ...base,
      id: 'demo-prod-web',
      name: '生产 Web 网关',
      host: '10.0.4.21',
      port: 22,
      username: 'zcx',
      authMethod: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      tags: ['生产', 'nginx'],
      color: '#2ee66b',
      note: '入口网关，改动需走发布流程。',
      favorite: true,
      lastConnectedAt: now - 1000 * 60 * 42,
    },
    {
      ...base,
      id: 'demo-staging-app',
      name: '预发布应用',
      host: '10.0.8.14',
      port: 2222,
      username: 'deploy',
      authMethod: 'password',
      tags: ['预发布', 'node'],
      color: '#26c281',
      note: '每日 02:00 由 CI 重新部署。',
      favorite: true,
      lastConnectedAt: now - 1000 * 60 * 60 * 5,
    },
    {
      ...base,
      id: 'demo-analytics-db',
      name: '数据仓库',
      host: '10.0.12.7',
      port: 22,
      username: 'analyst',
      authMethod: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
      tags: ['生产', 'postgres'],
      color: '#f2b45c',
      note: '只读账号，长时间查询请走离线任务。',
      favorite: false,
      lastConnectedAt: now - 1000 * 60 * 60 * 26,
    },
    {
      ...base,
      id: 'demo-homelab',
      name: '家庭实验室',
      host: 'homelab.local',
      port: 22,
      username: 'root',
      authMethod: 'agent',
      tags: ['实验'],
      color: '#f4718f',
      note: '树莓派 5，跑着 Home Assistant 与内网 DNS。',
      favorite: false,
      lastConnectedAt: null,
    },
  ];
}

function readStorage(): Host[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Host[]) : null;
  } catch {
    return null;
  }
}

function writeStorage(hosts: Host[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
  } catch {
    /* 隐私模式下写入失败时仅影响持久化，不影响本次会话 */
  }
}

/**
 * 浏览器内的主机仓储：数据落在 localStorage，行为与 HTTP 版一致，
 * 方便在没有后端时完整体验增删改查。
 */
export function createMockHostRepository(): HostRepository {
  let cache: Host[] | null = readStorage();

  const load = (): Host[] => {
    if (!cache) {
      cache = seedHosts();
      writeStorage(cache);
    }
    return cache;
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  /** 密码只用于「是否已保存」的标记，绝不写入 localStorage。 */
  const splitSecrets = (draft: HostDraft) => {
    const { password, passphrase: _passphrase, ...profile } = draft;
    return { profile, password };
  };

  return {
    async list() {
      await sleep(140);
      return clone(load());
    },

    async create(draft: HostDraft) {
      await sleep(260);
      const timestamp = Date.now();
      const { profile, password } = splitSecrets(draft);
      const host: Host = {
        ...profile,
        id: createId(),
        hasPassword: draft.authMethod === 'password' && Boolean(password),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastConnectedAt: null,
      };
      cache = [host, ...load()];
      writeStorage(cache);
      return clone(host);
    },

    async update(id: string, draft: HostDraft) {
      await sleep(240);
      const hosts = load();
      const index = hosts.findIndex((item) => item.id === id);
      if (index === -1) throw new Error('主机不存在或已被删除');
      const previous = hosts[index];
      const { profile, password } = splitSecrets(draft);
      const next: Host = {
        ...previous,
        ...profile,
        hasPassword:
          draft.authMethod === 'password' ? Boolean(password) || previous.hasPassword : false,
        updatedAt: Date.now(),
      };
      cache = hosts.map((item, itemIndex) => (itemIndex === index ? next : item));
      writeStorage(cache);
      return clone(next);
    },

    async remove(id: string) {
      await sleep(200);
      const hosts = load();
      if (!hosts.some((item) => item.id === id)) return;
      cache = hosts.filter((item) => item.id !== id);
      writeStorage(cache);
    },
  };
}
