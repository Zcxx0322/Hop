/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** REST 基础地址，例如 http://127.0.0.1:8080/api 。留空则使用内置模拟数据源。 */
  readonly VITE_HOP_API_BASE?: string;
  /** WebSocket 基础地址，例如 ws://127.0.0.1:8080/ws 。留空则使用内置模拟终端。 */
  readonly VITE_HOP_WS_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
