# Hop IPC 接口约定 v1

> 状态：**已冻结（v1）** · 契约版本：`CONTRACT_VERSION = 1`
> 唯一事实来源：`src/shared/contract.ts`（类型）+ `src/main/ipc/channels.ts`（频道名）
> 本文档与代码必须同步修改：**任何字段增删都要同时改两处，并提升契约版本号**。

---

## 0. 一页速览

```
Renderer (React + xterm.js)          Main (Node + ssh2)            远端 SSH
──────────────────────────           ────────────────────          ────────
window.hop.sessions.open(req)  ──►   ipcMain 'hop:sessions:open'
                                     ├─ 读取 profile + 解密凭据(DPAPI)
                                     ├─ Client.connect() ─────────► TCP/TLS
                                     │  ├─ hostVerifier ──► 'hop:hostkey:challenge'
                                     │  │                   ◄── 'hop:hostkey:answer'
                                     │  └─ shell({pty}) ──────────► PTY
window.hop.events.onData(cb)   ◄──   'hop:session:data'      ◄──── stdout
window.hop.sessions.write(id)  ──►   'hop:sessions:write'   ────► stdin
window.hop.sessions.resize(id) ──►   'hop:sessions:resize'  ────► window-change
window.hop.events.onSessionStatus ◄ 'hop:session:status'
window.hop.events.onSessionClosed ◄ 'hop:session:closed'
```

**前端只需要认三样东西**：`window.hop` 的方法签名（本文 §4）、事件语义（§5）、错误码（§7）。
所有业务逻辑（加密、连接、重连、多路复用、TOFU 校验）都在 main 进程。

---

## 1. 边界与安全规则

| 规则 | 说明 |
| --- | --- |
| 渲染进程**没有** Node 权限 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；preload 只通过 `contextBridge` 暴露 `window.hop`。 |
| 只用类型 | 渲染层 `import type { … } from '../shared/contract'`，禁止 import 任何 `src/main/**`。 |
| 密钥永不回传 | `profiles.save()` 收明文，之后任何读接口只返回 `hasSecret: boolean`，明文不出 main 进程。 |
| 不允许直连？ | 允许：UI 侧选私钥文件走 `window.hop.pickPrivateKey()`（main 弹原生对话框），**不要**自己拼 `dialog`。 |
| 通道列表固定 | 渲染层只能调 preload 暴露的方法，不能自己 `ipcRenderer.invoke` 任意频道。 |

加密方案：Electron `safeStorage`（Windows 下即 **DPAPI**，绑定当前用户账户 + `app.getPath('userData')` 下的存储文件）。
若 `safeStorage.isEncryptionAvailable()` 为 false（极少数无密钥环环境），secret 仅存内存、进程退出即失效，`AppInfo.secureStorage = false`，UI 应给出提示。

---

## 2. 数据目录（main 进程管理，渲染层不要读盘）

`%APPDATA%\Hop\`（`app.getPath('userData')`）

| 文件 | 内容 |
| --- | --- |
| `profiles.json` | 连接配置（**无明文密钥**，只有 `secretRef`） |
| `secrets.dat` | `safeStorage` 加密后的密文 Blob（base64） |
| `known_hosts.json` | TOFU 主机指纹库 |
| `logs\hop.log` | 滚动日志（10 个文件 × 2MB），排查连接失败用 |

---

## 3. 数据结构（`src/shared/contract.ts` 摘录）

### 3.1 输入：`ProfileInput`（新建/更新配置）

```ts
{
  id?: string;              // 省略 => 新建
  name: string;             // 必填，侧栏显示名
  host: string;             // 必填，域名或 IP
  port?: number;            // 默认 22
  username: string;         // 必填
  auth: {
    type: 'password' | 'privateKey' | 'agent';
    password?: string;      // type=password
    privateKeyPath?: string;// type=privateKey，从磁盘读
    privateKey?: string;    // type=privateKey，粘贴的 OpenSSH/PEM 文本
    passphrase?: string;    // type=privateKey，可选
    agentSocket?: string;   // type=agent，缺省用系统 agent
  };
  jump?: {                  // 可选跳板机（单跳）
    host: string; port?: number; username: string; auth: { … };
  } | null;
  cols?: number;            // 默认 120
  rows?: number;            // 默认 32
  term?: string;            // 默认 "xterm-256color"
  keepAliveMs?: number;     // 默认 20000，0 = 关闭
  color?: string;           // "#8b5cf6" 之类，纯装饰
  tags?: string[];          // 默认 []
}
```

> **省略某个 secret 字段 = 保留旧值**（编辑资料时不用重新输入密码）。
> 传空字符串 `''` = 清空该 secret。

### 3.2 输出：`ConnectionProfile`（只读视图，无密钥）

```ts
{
  id, name, host, port, username,
  auth: { type, hasSecret, privateKeyPath?, agentSocket?, keyFingerprint? },
  jump: { host, port, username, auth: PublicAuth } | null,
  cols, rows, term, keepAliveMs,
  color: string | null, tags: string[], order: number,
  createdAt: string, updatedAt: string, lastConnectedAt: string | null
}
```

`keyFingerprint` 形如 `SHA256:9f3a…`，用于在 UI 上展示「已加载的私钥」。

### 3.3 会话：`SessionSnapshot`

```ts
{
  id: string;               // "ses_7f3a…"，main 生成
  profileId: string;
  label: string;            // 默认 = profile.name
  status: 'connecting' | 'authenticating' | 'connected' | 'disconnected' | 'error';
  serverBanner: string | null;  // "SSH-2.0-OpenSSH_9.6"
  createdAt: number;        // epoch ms
  cols: number; rows: number;
  error?: HopError;         // 仅 status = error 时存在
}
```

---

## 4. 方法表（`window.hop.*`）

所有方法返回 Promise（`write` / `resize` 例外：同步 fire-and-forget）。
**失败一律 reject 一个 `HopError` 对象**，绝不抛裸 Error。

### `hop.info(): Promise<AppInfo>`

```ts
{ name, version, platform, arch, electron, chrome, node, contractVersion, secureStorage }
```

### `hop.profiles`

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `list()` | — | `ConnectionProfile[]` | 已按 `order` 升序 |
| `save(input)` | `ProfileInput` | `ConnectionProfile` | 有 `id` 则更新 |
| `remove(id)` | `string` | `void` | 同时删除其 secret |
| `reorder(orderedIds)` | `string[]` | `ConnectionProfile[]` | 全量重排，返回新顺序 |

校验失败（缺字段、端口越界）→ reject `CONFIG_INVALID`，`detail` 里带字段名。

### `hop.sessions`

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `list()` | — | `SessionSnapshot[]` | 进程重启后为空（会话不持久化） |
| `open(req)` | `OpenSessionRequest` | `SessionSnapshot` | 立刻返回 `connecting` 快照；后续状态走事件 |
| `write(sessionId, data)` | `string`（UTF-8 文本） | `void` | 高频，不抛错；会话不存在时静默丢弃 |
| `resize({sessionId, cols, rows})` | | `void` | 节流由 main 负责（最多 20 次/秒） |
| `close(sessionId)` | | `Promise<void>` | 幂等 |

`OpenSessionRequest`:

```ts
{
  profileId: string;
  password?: string;   // profile.auth.hasSecret === false 时由 UI 临时提供
  passphrase?: string; // 同上
  cols?: number; rows?: number;
  label?: string;      // 例如 "prod · web-01"
}
```

> **UI 流程建议**：打开前若 `hasSecret === false`，先弹「输入密码」对话框，把密码放进 `open()` 的 `password` 字段；**不要**为了登录去改 profile。

### `hop.knownHosts`

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `list()` | — | `KnownHostEntry[]`（`{id:"host:port", host, port, keyType, fingerprint, addedAt}`） |
| `forget(id)` | `"host:port"` | `void` |

### `hop.pickPrivateKey(): Promise<{path, name} | null>`

原生文件选择器，默认目录 `~/.ssh`；取消返回 `null`。

### `hop.answerHostKey(requestId, decision, persist)`

见 §5.3。**必须对每个 challenge 调用一次**，否则连接会在 30 秒后以 `TIMEOUT` 失败。

---

## 5. 事件

订阅方法都返回 `Unsubscribe`，组件卸载时务必调用，避免泄漏。

### 5.1 `onData(cb: (e: {sessionId, data: string}) => void)`

终端输出。**唯一的推送式事件。**

- `data` 是已按 UTF-8 增量解码的字符串（跨包的多字节字符不会乱码）。
- **已经批量合并**：main 每 ~6ms 或累计 32KB 合并一次，单连接每秒最多约 160 次 IPC。UI 拿到直接 `term.write(data)` 即可，不要自己再拼。
- 顺序严格保证；同一 session 的事件不会乱序。
- `status !== 'connected'` 时不会产生数据。

### 5.2 `onSessionStatus(cb: (snapshot: SessionSnapshot) => void)`

状态机流转（同一状态不会重复推送）：

```
connecting ──► authenticating ──► connected ──► disconnected
     │                │                │
     └────────────────┴────────────────┴──► error   (error 一定先于 closed)
```

- `open()` 的返回值与「首个 `onSessionStatus`」内容一致，UI 可只依赖事件、也可只依赖返回值（**推荐两者都处理，用 `sessionId` 去重**）。
- `error` 时 `snapshot.error` 必有 `code/message`。

### 5.3 `onHostKeyChallenge(cb: (c: HostKeyChallenge) => void)`

首次连接一台主机时触发（TOFU）：

```ts
{ requestId, sessionId, host, port, keyType, fingerprint, known, mismatch? }
```

UI 必须提示用户后调用 `hop.answerHostKey(requestId, 'accept' | 'reject', persist)`：

| 情况 | 建议 UI |
| --- | --- |
| `known === false` | 「未知主机，指纹 SHA256:…，是否信任？[信任并保存 / 仅本次 / 取消]」→ `persist` 对应 `true` / `false` |
| `known === true && mismatch` | **红色高危警告**（中间人攻击可能），默认拒绝；拒绝后连接以 `HOST_KEY_REJECTED` 结束 |

### 5.4 `onSessionClosed(cb: (e: {sessionId, reason: HopError | null}) => void)`

每个 session **恰好一次**，且一定在最后一个 `onSessionStatus` 之后。UI 收到后可关闭标签页；`reason` 非空表示异常断开（如 `NETWORK`）。

**完整时序（正常连接）**

```
UI                          main                          server
 open() ───────────────────►
 ◄── snapshot:connecting
                             connect()
 ◄── hostkey challenge  ──── (首次)
 answerHostKey(accept, true) ►
 ◄── snapshot:authenticating
 ◄── snapshot:connected  ─── (此后可收发数据)
 ◄── onData("Welcome…")
 write("ls\r") ────────────►  ──► stdin
 ◄── onData("file1 file2\r\n")
 close() ──────────────────►
 ◄── snapshot:disconnected
 ◄── onSessionClosed(reason:null)
```

---

## 6. 终端数据流约定（性能条款）

1. **xterm 侧**：`term.onData(d => hop.sessions.write(id, d))`，**不要**在中间做 debounce（会吞掉方向键/粘贴）。
2. **resize**：`FitAddon` 触发后调用 `hop.sessions.resize({sessionId, cols, rows})`；main 内部节流 50ms，UI 不必再防抖，但请在 `ResizeObserver` 里做一次 `requestAnimationFrame` 合并。
3. **回放/scrollback** 全在前端（xterm 内置），后端不保留历史缓冲，只有 `data` 事件流。
4. **粘贴保护**：多行粘贴前由 UI 弹确认（后端不拦），避免误执行。
5. **上限**：单次 `write` 建议 < 256KB；超长粘贴请自行切块（每块 64KB），否则 IPC 序列化会卡顿 1–2 帧。
6. **会话数**：单进程默认上限 24 个并发会话，超过 `open()` reject `UNSUPPORTED`。

---

## 7. 错误码（`HopError.code`）

| code | 触发场景 | UI 建议文案 |
| --- | --- | --- |
| `CONFIG_INVALID` | 保存/打开时字段非法 | 表单行内报错 |
| `PROFILE_NOT_FOUND` | 配置被删/ID 不存在 | 刷新列表 |
| `SESSION_NOT_FOUND` | 对已关闭会话操作 | 静默忽略 |
| `AUTH_REQUIRED` | 无存储密码且未提供 | 弹密码框 |
| `AUTH_FAILED` | 密码/密钥错误 | 「认证失败，请检查用户名或密码」 |
| `KEY_INVALID` | 私钥无法解析 / 文件缺失 | 重新选择私钥 |
| `KEY_PASSPHRASE_REQUIRED` | 加密私钥缺 passphrase | 弹 passphrase 框 |
| `NETWORK` | DNS/连接被拒/断链 | 「无法连接到 host:port」+ detail |
| `TIMEOUT` | 连接或主机指纹确认超时（30s） | 重试 |
| `HOST_KEY_REJECTED` | 用户拒绝指纹 / 指纹不匹配 | 显示指纹对比 |
| `SHELL_FAILED` | 认证成功但 shell 申请失败 | 只读会话/退出 |
| `SECRET_STORE_UNAVAILABLE` | 系统密钥环不可用 | 提示将以临时凭据运行 |
| `UNSUPPORTED` | 超出规格（会话上限、不支持的认证） | 通用提示 |
| `INTERNAL` | 兜底 | 展示 detail + 建议看日志 |

---

## 8. 前端接入示例（可直接抄）

```tsx
import type { HopApi } from '../../shared/contract';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const hop = window.hop; // 见 src/preload/index.ts，类型见 global.d.ts

// 1) 打开会话并绑定终端
const term = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, monospace' });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(containerRef.current!);
fit.fit();

const session = await hop.sessions.open({
  profileId, cols: term.cols, rows: term.rows,
});

// 2) 订阅（务必在 open 之前或紧随其后订阅，main 会缓存首个快照）
const offData = hop.events.onData((e) => {
  if (e.sessionId === session.id) term.write(e.data);
});

// 3) 键盘 -> 远端
const offKey = term.onData((d) => hop.sessions.write(session.id, d));

// 4) 尺寸同步
const ro = new ResizeObserver(() => {
  fit.fit();
  hop.sessions.resize({ sessionId: session.id, cols: term.cols, rows: term.rows });
});
ro.observe(containerRef.current!);

// 5) 清理
onUnmount(() => { offData(); offKey.dispose(); ro.disconnect(); hop.sessions.close(session.id); });
```

> 若 UI 在 `onData` 订阅前打开会话，可安全丢失极端早期的字节 —— main 会为每个会话缓存**第一条**输出（banner），并在订阅后补发一次。除此之外不重放。

---

## 9. 变更流程

1. 改 `src/shared/contract.ts` → 2. 升 `CONTRACT_VERSION` → 3. 更新本文档 → 4. 通知前端。
5. 破坏性变更请新增字段并保持旧字段 deprecated 一个版本，避免前后端同时改。

---

## 10. 尚未提供（v2 候选，接口已留位）

- `profiles.exportEnvelope()` / `importEnvelope()`：加密导出（当前只有明文 JSON 导出，见 ARCHITECTURE.md §配置导入导出）。
- SFTP 文件面板、端口转发（`-L`）、多跳跳板链。
- 会话恢复（tmux 风格回放）。
