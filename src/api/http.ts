import { runtimeConfig } from './config';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  /** 默认 15 秒；文件传输这类需要用户交互的接口会传入更长的值。 */
  timeoutMs?: number;
}

async function send<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetch(`${runtimeConfig.apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
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

/** 访问本机网关的统一入口。所有 api/* 模块都走这里，便于统一超时与错误处理。 */
export function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  return send<T>(path, rest, timeoutMs);
}
