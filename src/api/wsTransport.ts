import type { SessionStatus } from '../types';
import { runtimeConfig } from './config';
import type {
  ConnectOptions,
  DataListener,
  StatusListener,
  TerminalTransport,
} from './transport';

type ServerControl =
  | { type: 'state'; state: SessionStatus; detail?: string }
  | { type: 'data'; data: string }
  | { type: 'error'; message?: string };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * 真实终端通道。
 *
 * 连接：ws(s)://{VITE_HOP_WS_BASE}/terminal?sessionId=...&hostId=...
 * 上行：JSON 文本帧 {type:'input'|'resize'|'close', ...}
 * 下行：JSON 文本帧 {type:'data'|'state'|'error', ...}，也接受二进制原文
 */
export class WebSocketTransport implements TerminalTransport {
  private socket: WebSocket | null = null;
  private dataListeners = new Set<DataListener>();
  private statusListeners = new Set<StatusListener>();
  private timeoutId: number | null = null;
  private disposed = false;
  private lastCols = 80;
  private lastRows = 24;

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitData(chunk: string): void {
    if (!chunk) return;
    this.dataListeners.forEach((listener) => listener(chunk));
  }

  private emitStatus(status: SessionStatus, detail?: string): void {
    this.statusListeners.forEach((listener) => listener(status, detail));
  }

  private clearTimer(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  connect(options: ConnectOptions): void {
    this.disposed = false;
    this.lastCols = options.cols;
    this.lastRows = options.rows;
    this.emitStatus('connecting');

    const params = new URLSearchParams({
      sessionId: options.sessionId,
      hostId: options.host.id,
      cols: String(options.cols),
      rows: String(options.rows),
    });
    const url = `${runtimeConfig.wsBase}/terminal?${params.toString()}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.emitStatus('error', error instanceof Error ? error.message : '无法创建 WebSocket 连接');
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';

    this.timeoutId = window.setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(4000, 'handshake timeout');
        this.emitStatus('error', 'SSH 握手超时，请确认目标主机可达或检查跳板配置');
      }
    }, options.timeoutMs);

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          sessionId: options.sessionId,
          hostId: options.host.id,
          cols: this.lastCols,
          rows: this.lastRows,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      const { data } = event;
      if (typeof data !== 'string') {
        this.emitData(decoder.decode(new Uint8Array(data as ArrayBuffer)));
        return;
      }

      let payload: ServerControl;
      try {
        payload = JSON.parse(data) as ServerControl;
      } catch {
        this.emitData(data);
        return;
      }

      switch (payload.type) {
        case 'state':
          this.clearTimer();
          this.emitStatus(payload.state, payload.detail);
          break;
        case 'data':
          this.emitData(payload.data);
          break;
        case 'error':
          this.clearTimer();
          this.emitStatus('error', payload.message ?? '会话异常中断');
          break;
        default:
          break;
      }
    });

    socket.addEventListener('close', (event) => {
      this.clearTimer();
      if (this.disposed) return;
      if (event.code === 1000 || event.code === 1005) {
        this.emitStatus('closed', event.reason || '会话已结束');
      } else {
        this.emitStatus('error', event.reason || `连接中断（code ${event.code}）`);
      }
    });

    socket.addEventListener('error', () => {
      this.clearTimer();
      if (!this.disposed) {
        this.emitStatus('error', '无法连接到 Hop 服务端 WebSocket');
      }
    });
  }

  sendInput(data: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'input', data }));
  }

  resize(cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'close' }));
      } catch {
        /* 已断开时忽略 */
      }
      socket.close(1000, 'tab closed');
    }
    this.dataListeners.clear();
    this.statusListeners.clear();
  }
}
