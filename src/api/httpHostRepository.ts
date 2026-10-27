import type { Host, HostDraft } from '../types';
import { runtimeConfig } from './config';
import type { HostRepository } from './hostRepository';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${runtimeConfig.apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    ...init,
  });

  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch {
      /* 响应体不是 JSON 时沿用默认文案 */
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

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
