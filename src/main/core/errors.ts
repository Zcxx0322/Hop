import type { HopError, HopErrorCode, IpcResult } from '../../shared/contract';

/** An error that is safe (and meaningful) to hand to the renderer. */
export class HopFailure extends Error {
  readonly code: HopErrorCode;
  readonly detail?: string;

  constructor(code: HopErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'HopFailure';
    this.code = code;
    this.detail = detail;
  }

  toHopError(): HopError {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

export function fail(code: HopErrorCode, message: string, detail?: string): HopFailure {
  return new HopFailure(code, message, detail);
}

/**
 * Map anything thrown inside the backend to a serialisable HopError.
 * Keep the messages user-facing and calm; put the raw text in `detail`.
 */
export function toHopError(err: unknown): HopError {
  if (err instanceof HopFailure) return err.toHopError();

  if (err instanceof Error) {
    const anyErr = err as NodeJS.ErrnoException & { level?: string };
    const detail = anyErr.stack ?? err.message;

    switch (anyErr.code) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return { code: 'NETWORK', message: '无法解析主机名', detail };
      case 'ECONNREFUSED':
        return { code: 'NETWORK', message: '连接被拒绝（端口未开放或被防火墙拦截）', detail };
      case 'ECONNRESET':
      case 'EPIPE':
        return { code: 'NETWORK', message: '连接被远端重置', detail };
      case 'ETIMEDOUT':
        return { code: 'TIMEOUT', message: '连接超时', detail };
      case 'ENOENT':
        return { code: 'KEY_INVALID', message: '文件不存在', detail };
      case 'EACCES':
        return { code: 'KEY_INVALID', message: '没有读取权限', detail };
      default:
        break;
    }

    if (anyErr.level === 'client-authentication') {
      return { code: 'AUTH_FAILED', message: '认证失败，请检查用户名、密码或密钥', detail };
    }
    if (anyErr.level === 'client-timeout') {
      return { code: 'TIMEOUT', message: '握手超时', detail };
    }

    return { code: 'INTERNAL', message: err.message || '发生未知错误', detail };
  }

  return { code: 'INTERNAL', message: '发生未知错误', detail: String(err) };
}

/** Wrap a handler so it always resolves to an IpcResult envelope. */
export async function asResult<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: toHopError(err) };
  }
}
