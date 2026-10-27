import type { Host, SessionStatus } from '../types';

/**
 * 传输层接口：视图层只认识这一层，不关心底层是 WebSocket 还是本地 Mock。
 * 协议细节见 docs/API-CONTRACT.md。
 */
export interface ConnectOptions {
  sessionId: string;
  host: Host;
  cols: number;
  rows: number;
  timeoutMs: number;
}

export type DataListener = (chunk: string) => void;

export type StatusListener = (status: SessionStatus, detail?: string) => void;

export interface TerminalTransport {
  connect(options: ConnectOptions): void;
  /** 发送用户按键（已解码为字符串，UTF-8 由实现负责编码） */
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
  onData(listener: DataListener): () => void;
  onStatus(listener: StatusListener): () => void;
}
