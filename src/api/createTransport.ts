import { isLiveTerminal } from './config';
import { MockTransport } from './mockTransport';
import type { TerminalTransport } from './transport';
import { WebSocketTransport } from './wsTransport';

/** 根据运行环境挑选终端传输实现。 */
export function createTransport(): TerminalTransport {
  return isLiveTerminal() ? new WebSocketTransport() : new MockTransport();
}
