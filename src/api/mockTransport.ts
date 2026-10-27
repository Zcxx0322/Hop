import type {
  ConnectOptions,
  DataListener,
  StatusListener,
  TerminalTransport,
} from './transport';
import { MockShell } from './mockShell';

/**
 * 演示用终端：不需要后端即可体验完整的连接流程。
 * 用 520~780ms 的握手延迟模拟真实 SSH 建链，随后进入内置 shell。
 */
export class MockTransport implements TerminalTransport {
  private dataListeners = new Set<DataListener>();
  private statusListeners = new Set<StatusListener>();
  private shell: MockShell | null = null;
  private timers: number[] = [];
  private disposed = false;

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitData(chunk: string): void {
    this.dataListeners.forEach((listener) => listener(chunk));
  }

  private emitStatus(status: Parameters<StatusListener>[0], detail?: string): void {
    this.statusListeners.forEach((listener) => listener(status, detail));
  }

  private schedule(callback: () => void, delay: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((timer) => timer !== id);
      if (!this.disposed) callback();
    }, delay);
    this.timers.push(id);
  }

  connect(options: ConnectOptions): void {
    this.disposed = false;
    this.emitStatus('connecting', '正在模拟 SSH 握手');
    const handshake = 520 + Math.round(Math.random() * 240);

    this.schedule(() => {
      this.emitStatus('connected', '演示会话');
      this.shell = new MockShell(
        (chunk) => this.emitData(chunk),
        options.host,
        () => this.schedule(() => this.emitStatus('closed', '会话已结束'), 160),
      );
      this.shell.start();
    }, handshake);
  }

  sendInput(data: string): void {
    this.shell?.handleInput(data);
  }

  resize(): void {
    /* 模拟 shell 不关心尺寸，真实实现会同步 PTY 的 winsize */
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
    this.shell = null;
    this.dataListeners.clear();
    this.statusListeners.clear();
  }
}
