import type { Host, HostDraft } from '../types';
import { ApiError, request } from './http';
import type { HostRepository } from './hostRepository';

export { ApiError };

export function createHttpHostRepository(): HostRepository {
  return {
    list: () => request<Host[]>('/hosts'),
    create: (draft: HostDraft) =>
      request<Host>('/hosts', { method: 'POST', body: JSON.stringify(draft) }),
    update: (id: string, draft: HostDraft) =>
      request<Host>(`/hosts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      }),
    remove: (id: string) =>
      request<void>(`/hosts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
