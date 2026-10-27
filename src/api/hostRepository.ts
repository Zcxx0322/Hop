import type { Host, HostDraft } from '../types';
import { isLiveHosts } from './config';
import { createHttpHostRepository } from './httpHostRepository';
import { createMockHostRepository } from './mockHostRepository';

/**
 * 主机数据仓储。前端只依赖这个接口，Mock 与 HTTP 实现可无缝替换。
 */
export interface HostRepository {
  list(): Promise<Host[]>;
  create(draft: HostDraft): Promise<Host>;
  update(id: string, draft: HostDraft): Promise<Host>;
  remove(id: string): Promise<void>;
}

let repository: HostRepository | null = null;

export function getHostRepository(): HostRepository {
  if (!repository) {
    repository = isLiveHosts() ? createHttpHostRepository() : createMockHostRepository();
  }
  return repository;
}
