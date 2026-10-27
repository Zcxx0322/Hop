# Hop 架构说明

## 1. 进程模型

```
┌─────────────────────────────── Electron 主进程 (Node 22) ───────────────────────────────┐
│                                                                                          │
│  index.ts  ──┬── window.ts        BrowserWindow / CSP / 权限收紧                          │
│              ├── ipc/register.ts   ipcMain.handle → IpcResult<T> 信封                     │
│              └── server/gateway.ts 127.0.0.1 HTTP + WebSocket（REST/WS 传输）             │
│                        │                        │                                        │
│                        └────────┬───────────────┘                                        │
│                                 ▼                                                        │
│                        core/session-manager.ts   会话表、并发上限、几何钳制                 │
│                                 ▼                                                        │
│                        core/ssh-session.ts       ssh2 Client、跳板转发、PTY、批量输出      │
│                                 ▼                                                        │
│              core/profile-store.ts ── core/secret-store.ts (safeStorage/DPAPI)            │
│                                 └───── core/known-hosts.ts (TOFU pin)                     │
│                                        core/json-store.ts 原子写 + core/logger.ts          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ contextBridge                              ▲ fetch / WebSocket
┌───────┴───────────────┐                  ┌─────────┴──────────────────────────┐
│ preload/index.ts       │                  │ 渲染进程 (Chromium, sandbox:true)   │
│ window.hop.* 类型化 API │                  │  src/api/{httpHostRepository,      │
│ 事件早订阅缓冲 (400)    │                  │  wsTransport} · xterm.js           │
└────────────────────────┘                  └────────────────────────────────────┘
```

- 渲染进程 `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true`，生产环境 CSP 只放行自身资源与 `127.0.0.1` 的 HTTP/WS。
- 主进程是唯一持有 SSH 连接、文件与 DPAPI 的地方；渲染层拿不到任何密钥材料。
- 单实例锁（`app.requestSingleInstanceLock`）+ `setAppUserModelId('com.hop.ssh')`。

## 2. 模块职责

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `src/shared/contract.ts` | 唯一契约源：DTO、错误码、`HopApi`、`IpcResult`、`CONTRACT_VERSION = 1` | 类型 + 常量 |
| `src/shared/channels.ts` | IPC 通道常量与四个事件通道 | `CH` |
| `src/main/index.ts` | 装配：日志 → 密钥库 → 三个 store → 会话管理器 → IPC → 网关 → 窗口 | — |
| `src/main/window.ts` | 创建窗口、加载 dev server 或 `dist/renderer/index.html`、广播、聚焦 | `createMainWindow` `broadcast` |
| `src/main/ipc/register.ts` | IPC 端点实现，统一 `asResult()` 信封，逐个通道校验入参；`pickPrivateKey` 走原生文件对话框 | `registerIpc()` → disposer |
| `src/main/server/gateway.ts` | 环回 HTTP/WS 网关，把 core 映射成前端的 REST/WS 协议 | `startGateway()` → `GatewayHandle` |
| `src/main/core/session-manager.ts` | 会话生命周期、`MAX_SESSIONS = 24`、`cols/rows` 钳制、钩子转事件 | `SessionManager` |
| `src/main/core/ssh-session.ts` | 单条 SSH 连接：跳板 `forwardOut`、`hostVerifier` 质询、PTY shell、输出批量、resize 节流、幂等 terminate | `SshSession` |
| `src/main/core/profile-store.ts` | 连接配置读写、校验、公共视图（剥离机密）、解析成连接参数 | `ProfileStore.resolve()` |
| `src/main/core/secret-store.ts` | `safeStorage` 加解密，`enc:` 落盘、无密钥环则纯内存 | `SecretStore` |
| `src/main/core/known-hosts.ts` | `host:port` → 指纹 pin 的检查/信任/列表/遗忘 | `KnownHostsStore` |
| `src/main/core/json-store.ts` | 带版本号的 JSON 原子写（tmp + rename），损坏文件另存 `.corrupt` | `JsonStore<T>` |
| `src/main/core/errors.ts` | `HopFailure`、`fail(code, msg)`、`toHopError()` 归一化 | `fail` `toHopError` `asResult` |
| `src/main/core/keys.ts` | 私钥读取、`utils.parseKey`、SHA-256 指纹、`~` 展开、口令缺失识别 | `parsePrivateKey` `sha256Fingerprint` |
| `src/preload/index.ts` | `contextBridge` 暴露 `window.hop`；解信封并抛错；事件通道带早订阅缓冲 | — |
| `tests/e2e-ssh.ts` | 内部起一台假 SSH 服务器（ssh2.Server）跑真连接；再起网关跑 HTTP/WS | — |

## 3. 数据模型与存储布局

```
%APPDATA%\Hop\
├── profiles.json      { version: 1, data: StoredProfile[] }   连接配置（无密码）
├── secrets.dat        { id → "enc:<base64>" }                 DPAPI 加密的密码/口令/私钥
├── known_hosts.json   { version: 1, data: [{ host, port, keyType, fingerprint, firstSeenAt, addedAt }] }
└── logs\hop.log       滚动日志：2 MB × 5
```

`StoredProfile`（内部）字段：`id, name, host, port, username, auth{type, privateKeyPath?, agentSocket?}, jump?, tags, color, note, favorite, cols, rows, term, keepAliveMs, createdAt, updatedAt, lastConnectedAt`。

对外 `ConnectionProfile`（IPC）会剥掉 `auth` 里的密钥材料，只留 `PublicAuth{type, hasSecret, privateKeyPath?, agentSocket?, keyFingerprint?}`；HTTP 面的 `HostDto` 是同一信息的扁平化投影（`authMethod` + `hasPassword` + `keyFingerprint`）。

**为什么要两份 DTO**：IPC 的消费者是自家 preload（可以表达嵌套对象），HTTP 的消费者是前端已有的 `Host` 类型（扁平、便于表单双向绑定）。映射集中在 `gateway.ts` 的 `toHost()` / `toProfileInput()`，不允许两侧各自长出逻辑。

## 4. 会话状态机

```
        open()                 connect 成功 + shell ready
  ──────────────► connecting ────────────────────────────► connected
                     │  │                                   │   ▲
      host key 质询  │  │ 认证失败/网络错误                  │   │ resize/write
        (挂起)       │  └──────────────► error ◄────────────┘   │
                     ▼                     │                     │
              authenticating               │ close()/对端断开     │
                     └──► connected        ▼                     │
                                        disconnected ────────────┘ (不可逆)
```

- `open()` **立即返回快照**（`status: 'connecting'`），真正的连接在后台进行；只有「主机不存在 / 参数非法 / 并发超限」这类本地错误才同步 reject。
- 主机密钥：`hostVerifier` 收到 key 后向 UI 发 `HostKeyChallenge`，30 s 内无应答按拒绝处理（`HOST_KEY_REJECTED`）。
- `terminate()` 幂等：清理定时器 → 冲刷剩余输出 → `decoder.end()` → 置终态 → 只发一次 `onClosed`。

## 5. 终端数据流与性能条款

```
pty 输出 ──► channel.on('data') ──► StringDecoder(增量 UTF-8)
                                     │
                                     ├─ 累积 ≥ 32768 B 或距上次冲刷 ≥ 6 ms ──► 合并成一帧
                                     └─ resize 请求：50 ms 尾随节流 ──► setWindow
```

- **合并冲刷**（`FLUSH_MS = 6`、`FLUSH_BYTES = 32768`）：把 `ls -la` 这类上千次的 1–2 KB 分片压成几十帧，跨进程开销从 O(分片) 降到 O(时间窗)。
- **增量解码**：多字节 UTF-8 字符被分片切断时不会出现 `�`（`StringDecoder` 保留半个字符到下一片）。
- **resize 节流**：拖拽窗口时只在静止 50 ms 后发一次 `window-change`，避免远端 `ncurses` 重绘风暴。
- **背压防线**：WS 侧若某 socket 的 `bufferedAmount` 超过 8 MB（接收方已明显掉队），直接回一帧 `{type:'error'}` 并以 1013 关闭该 socket，由 `onClosed` 收掉会话——宁可让一个失控的消费者断开，也不让主进程内存无界增长。IPC 侧由 Electron 自带的消息队列承担。

## 6. 双传输的映射表

| 能力 | IPC（`docs/IPC-CONTRACT.md`） | HTTP/WS（`docs/API-CONTRACT.md`） |
| --- | --- | --- |
| 列主机 | `profiles.list()` | `GET /hosts` |
| 新建/修改 | `profiles.save(input)` | `POST /hosts` / `PUT /hosts/:id` |
| 删除 | `profiles.remove(id)` | `DELETE /hosts/:id` |
| 设置密码 | 随 `save(input.auth.password)` 上行 | `PUT /hosts/:id/credentials` 或写入体内 `password` |
| 打开会话 | `sessions.open({profileId, cols, rows})` | `WS /terminal?hostId=…` + `{type:'hello'}` |
| 键盘输入 | `sessions.write({sessionId, data})` | `{type:'input', data}` |
| 调整尺寸 | `sessions.resize(...)` | `{type:'resize', cols, rows}` |
| 数据/状态/关闭 | `evData` / `evStatus` / `evClosed` | `{type:'data'}` / `{type:'state'}` / 关闭码 1000·1011 |
| 主机密钥 | `evHostKey` + `answerHostKey()` | TOFU，变更即 `{type:'error'}` |
| 健康检查 | `info()` | `GET /health`（供前端 47100–47119 端口探测） |

两条传输各自持有独立的 `SessionManager` 实例（复用同一 `ProfileStore` / `KnownHostsStore`），会话 id 空间互不干扰；任一传输关闭其会话都不会误伤另一端。

## 7. 安全模型

1. **凭据**只以 DPAPI 密文存在于 `secrets.dat`；无密钥环时只在内存，不落盘。
2. **只读接口永远不返回机密**：`PublicAuth.hasSecret`、`HostDto.hasPassword` 是布尔值，`keyFingerprint` 是不可逆摘要。
3. **一次性凭据**：HTTP `hello` 帧可携带 `password`/`passphrase`，用后即弃、不写日志、不落盘（便于「连接时不保存密码」）。
4. **网关**仅绑定 `127.0.0.1`，校验 Origin，无跨站写入面；CSP 限制渲染进程只能连本机网关。
5. **私钥文件**由主进程读取（`pickPrivateKey` 走原生对话框），渲染层只拿到路径与指纹。
6. **主机密钥**变更一律拒绝；pin 的增删都必须显式发生。
7. 日志脱敏：`logger` 只记录主机/用户名/认证类型，不记录密码、口令、私钥内容。

## 8. 启动时序

```
app.whenReady
 ├─ initLogger(userData/logs)
 ├─ SecretStore(secrets.dat).init()          ← 探测 DPAPI 可用性
 ├─ ProfileStore / KnownHostsStore            ← 读 JSON（损坏则备份 .corrupt 并重置）
 ├─ SessionManager(hooks → broadcast)
 ├─ registerIpc({ profiles, knownHosts, sessions, secureStorage })
 ├─ startGateway({ …, preferredPort: HOP_GATEWAY_PORT ?? 47100 })   ← EADDRINUSE 时 +1 重试 20 次
 ├─ createMainWindow()                        ← dev 用 HOP_DEV_SERVER_URL，否则 file://dist/renderer
 └─ app.on('before-quit') → flushLogger + gateway.close() + sessions.closeAll()
```

`HOP_GATEWAY=0` 可整体关闭网关；`HOP_SMOKE=1` 会在主进程内跑一遍自检后退出（`pnpm smoke`）。

## 9. 错误模型

所有跨进程错误归一为 `HopError { code, message, detail? }`，码表见 `docs/IPC-CONTRACT.md`。`toHopError()` 负责把 ssh2/Node 的原始错误翻译成稳定码：`ENOTFOUND`/`ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT` → `NETWORK`/`TIMEOUT`，`client-authentication` 级别 → `AUTH_FAILED`，私钥口令缺失 → `KEY_PASSPHRASE_REQUIRED`。

IPC 用 `IpcResult<T>` 信封（`{ok:true,data} | {ok:false,error}`），preload 解包后 `throw`，前端可以用 `try/catch` 或 `ApiError` 风格统一处理；HTTP 面则映射为 `{message, code}` + 合适的 4xx/5xx。

## 10. 验证策略

| 手段 | 覆盖 | 命令 |
| --- | --- | --- |
| 类型检查 | 主进程 + preload + shared（`noUnusedLocals`/`strict`） | `pnpm typecheck` |
| 端到端（真 SSH） | 假 SSH 服务器：主机密钥质询/信任/复用、PTY 输出、按键、resize、关闭；网关：CRUD、校验 400、WS 数据通路 | `pnpm test:e2e`（20 项断言） |
| 启动自检 | 真实 Electron 内：网关绑定、`/health`、CRUD、`profiles.json`、`secrets.dat`、渲染产物存在 | `pnpm smoke`（13 项断言） |
| 构建 | main/preload/renderer 三产物 | `pnpm build` |

之所以要「真 Electron 自检」而不是只跑 Node 单测：DPAPI、`app.getPath('userData')`、打包后的 `file://` 加载、CSP 这些只有真进程里才成立。
