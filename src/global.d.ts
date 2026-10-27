import type { HopBridge } from './preload';

declare global {
  interface Window {
    /** Injected by `src/preload/index.ts`; absent when the UI runs in a plain browser. */
    hop?: HopBridge;
  }
}

export {};
