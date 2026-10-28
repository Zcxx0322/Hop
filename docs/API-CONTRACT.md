# Hop 接口契约 · REST + WebSocket（v1）

Hop 的前端（renderer）只通过本机回环网关与后端通信：**REST 管主机与状态，WebSocket 管终端字节流**。
网关由 Electron main 进程启动（`src/main/server/gateway.ts`），不经过 `window.hop` IPC。
IPC 通道（`docs/IPC-CONTRACT.md`）与本文档是两套独立契约，UI 当前不依赖 IPC。

```
┌─────────────────────────┐   HTTP 127.0.0.1:47100+   ┌──────────────────────┐
│ React renderer (Vite)   │ ────────────────────────▶ │ Electron main gateway │
│ src/api/* · src/store/* │ ◀──────────────────────── │ REST + WS + ssh2      │
└─────────────────────────┘   WebSocket /terminal      └──────────────────────┘
```

## 1. 端口发现与配置优先级

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `VITE_HOP_API_BASE` / `VITE_HOP_WS_BASE` | 构建期注入，显式覆盖；`http(s)` 与 `ws(s)` 可互相推导 |
| 2 | 自动探测 `127.0.0.1:47100…47119` | 逐个请求 `GET /health`，要求 `name === "Hop"`；单请求 900 ms、总预算 2.5 s |
| 3 | 演示模式 | 探测失败：`localStorage` 仓储 + 模拟 shell，无需后端 |

探测发生在首帧渲染之前（`src/main.tsx` 顶层 `await ensureTransportConfig()`），因此仓储与传输层不会「先选错再切换」。

`GET /health` 响应：

```json
{
  "ok": true,
  "name": "Hop",
  "version": "0.1.0",
  "contract": 1,
  "secureStorage": true,
  "sessions": 0,
  "hosts": 4
}
```

## 2. 主机接口（REST）

所有请求/响应均为 `application/json; charset=utf-8`，时间戳为 Unix 毫秒。

### 2.1 `HostDto`

```json
{
  "id": "demo-prod-web",
  "name": "生产 Web 网关",
  "host": "10.0.4.21",
  "port": 22,
  "username": "zcx",
  "authMethod": "key",
  "privateKeyPath": "~/.ssh/id_ed25519",
  "tags": ["生产", "nginx"],
  "color": "#7c8cf8",
  "note": "入口网关，改动需走发布流程。",
  "favorite": true,
  "createdAt": 1772000000000,
  "updatedAt": 1772000000000,
  "lastConnectedAt": 1772003600000,
  "hasPassword": false,
  "keyFingerprint": "SHA256:…"
}
```

- `authMethod`：`"key" | "password" | "agent"`。
- `hasPassword`：是否已保存登录密码，**仅布尔值，明文永不回传**。
- `keyFingerprint`：私钥公钥指纹（无则空串）。
- `privateKeyPath`、`color`、`note` 缺省为空串，`tags` 缺省为 `[]`，`lastConnectedAt` 可为 `null`。

### 2.2 写入字段（POST/PUT 请求体）

除 `id`、`createdAt`、`updatedAt`、`lastConnectedAt`、`hasPassword`、`keyFingerprint` 外均可写，另有两个**只上行**的敏感字段：

| 字段 | 语义 |
| --- | --- |
| `password` | 登录密码。仅 `authMethod === "password"` 时生效。 |
| `passphrase` | 私钥口令。仅 `authMethod === "key"` 时生效。 |

- **字段缺省** = 保留后端已存值（编辑时密码留空即「不修改」）。
- **空字符串 `""`** = 清除已保存的密码/口令。
- 后端用 DPAPI（Windows）/ Keychain（macOS）加密落盘；`PUT /hosts/:id/credentials` 可用于单独的密码更新流程。

### 2.3 端点

| 方法 | 路径 | 请求体 | 成功响应 |
| --- | --- | --- | --- |
| `GET` | `/hosts` | — | `200 HostDto[]`（按 `updatedAt` 由存储层排序） |
| `POST` | `/hosts` | `HostDraft` | `201 HostDto` |
| `GET` | `/hosts/:id` | — | `200 HostDto` |
| `PUT` | `/hosts/:id` | `HostDraft` | `200 HostDto`（全量覆盖语义） |
| `DELETE` | `/hosts/:id` | — | `204`（不存在也返回 204，幂等） |
| `PUT` | `/hosts/:id/credentials` | `{ "password"?: string, "passphrase"?: string }` | `204`；两者都缺省 → `400` |
| `GET` | `/known-hosts` | — | `200 KnownHost[]` |
| `DELETE` | `/known-hosts?id=:id` | — | `204`（幂等） |

`KnownHost` 形如 `{ "id": "10.0.4.21:22", "host": "10.0.4.21", "port": 22, "algorithm": "ssh-ed25519", "fingerprint": "SHA256:…", "firstSeenAt": … }`。

### 2.4 错误格式

非 2xx 响应统一为：

```json
{ "message": "该连接已不存在", "code": "PROFILE_NOT_FOUND" }
```

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `CONFIG_INVALID` | 字段校验失败（缺 host、端口越界、未知 authMethod…） |
| 400 | `CONFIG_INVALID` / 自定义 | 请求体不是合法 JSON |
| 404 | `PROFILE_NOT_FOUND` | 主机 id 不存在 |
| 404 | `UNSUPPORTED` | 未知方法 + 路径 |
| 500 | `INTERNAL` | 未捕获异常（消息已脱敏） |

前端 `ApiError` 优先展示 `{code} · {message}`，并把 `status` 一并保留用于日志。

## 3. 文件传输与主机监控（REST）

两者都用「每次请求现开一条 SSH 连接」的方式工作，不占用终端会话连接。

### 3.1 目录与文件操作

| 方法 | 路径 | 请求体 / 查询 | 响应 |
| --- | --- | --- | --- |
| `GET` | `/hosts/:id/files?path=~` | `path` 缺省 `~` | `DirectoryListing` |
| `DELETE` | `/hosts/:id/files?path=~/x` | — | 删除后的 `DirectoryListing` |
| `POST` | `/hosts/:id/files/mkdir` | `{ "dir": "~", "name": "新建文件夹" }` | `DirectoryListing` |
| `POST` | `/hosts/:id/files/rename` | `{ "from": "~/a", "name": "b" }` | `DirectoryListing` |
| `POST` | `/hosts/:id/files/upload` | `{ "dir": "~" }` | `{ "transfer": Transfer \| null }`（系统文件选择框取消时为 `null`） |
| `POST` | `/hosts/:id/files/download` | `{ "path": "~/a.log" }` | `{ "transfer": Transfer \| null }`（系统保存框取消时为 `null`） |

`~` 由后端用 `$HOME` 解析成绝对路径（SFTP 自身不认 `~`）。返回的 `path` 字段保持用户视角的写法（`~`、`~/docs`）。

```json
{
  "path": "~",
  "parent": null,
  "entries": [
    { "name": "README.md", "path": "~/README.md", "type": "file", "size": 1280, "mtime": 1793200000000, "mode": 33188 }
  ]
}
```

`type` 为 `dir | file | link`；`mtime` 统一为**毫秒**时间戳。

### 3.2 传输记录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/transfers?hostId=<id>` | 最近 40 条，按开始时间倒序；进行中的在前 |
| `DELETE` | `/transfers` | 清空已结束的记录 |

`Transfer` 形如：

```json
{
  "id": "uuid",
  "hostId": "prf_…",
  "direction": "upload",
  "name": "app.log",
  "localPath": "D:\\logs\\app.log",
  "remotePath": "~/app.log",
  "transferred": 40960,
  "total": 131072,
  "status": "active",
  "error": null,
  "startedAt": 1793200000000,
  "finishedAt": null
}
```

上传/下载在选完文件后立即返回，后台继续传输；前端每 1.2 s 轮询 `/transfers` 更新进度，面板关闭即停止轮询。

### 3.3 主机状态

`GET /hosts/:id/monitor` 返回一次采样：

```json
{
  "sampledAt": 1793200000000,
  "os": "Ubuntu 24.04.4 LTS",
  "cores": 4,
  "cpu": 4.17,
  "load": [0.11, 0.09, 0.09],
  "uptimeSec": 10150034.57,
  "memTotal": 3904065536,
  "memUsed": 1678237696,
  "swapTotal": 2084564992,
  "swapUsed": 407060480,
  "diskTotal": 42156257280,
  "diskUsed": 17630646272,
  "rxBytes": 36778738457,
  "txBytes": 13869902457,
  "rxRate": 1549.7,
  "txRate": 9674.0,
  "unsupported": false
}
```

- 采样只用**一条**远端命令：`/proc/stat`、`/proc/meminfo`、`/proc/loadavg`、`/proc/uptime`、`/proc/net/dev`、`df -kP /`、`nproc`、`/etc/os-release`，缺哪个文件就跳过错哪个字段。
- 命令内部取两次快照（间隔 0.35 s），因此**首次请求就能**给出 CPU 占用与网络速率，而不是先返回 `null`。
- 监控连接按 host 池化，空闲 25 s 自动断开；面板每 3 s 刷新一次。
- 远端没有 `/proc`（BSD/macOS/Windows）时 `unsupported: true`，前端只显示连接状态与提示。

## 4. 终端接口（WebSocket）

```
ws://127.0.0.1:47100/terminal?hostId=<id>&cols=120&rows=32&sessionId=<前端会话 id>
```

- 查询参数：`hostId`（必填）、`cols`/`rows`（缺省 120×32，会被 `hello` 覆盖）、`sessionId`（前端生成，用于日志关联，后端不持久化）。
- 帧格式：**文本帧为 JSON 控制帧，二进制帧为原始终端字节**（UTF-8）。前端当前只发 JSON 文本，后端两者都接受；下行 `data` 走 JSON 文本，前端也兼容二进制原文。
- 心跳：服务端每 30 s `ping`，一个周期内无 `pong` 则断开。

### 4.1 客户端 → 服务端

| 帧 | 载荷 | 说明 |
| --- | --- | --- |
| `hello` | `{ "type": "hello", "sessionId"?, "hostId"?, "cols"?, "rows"?, "password"?, "passphrase"? }` | 连接后首帧；可用于补发临时密码（不落盘） |
| `input` | `{ "type": "input", "data": "ls -la\r" }` | 键盘输入 |
| `resize` | `{ "type": "resize", "cols": 140, "rows": 40 }` | 终端尺寸变化 |
| `close` | `{ "type": "close" }` | 主动断开 |

### 4.2 服务端 → 客户端

| 帧 | 载荷 | 说明 |
| --- | --- | --- |
| `state` | `{ "type": "state", "state": "connecting" \| "connected" \| "closed" \| "error", "detail"?: "…" }` | 生命周期；`detail` 为人类可读原因 |
| `data` | `{ "type": "data", "data": "…" }` | 终端输出（含 ANSI） |
| `error` | `{ "type": "error", "message": "…" }` | 握手/认证/网络错误，随后关闭 |

关闭码：`1000` 正常结束；`1011` 后端失败；连接被拒/网络不可达会先收到 `error` 帧。
前端把 `error` 映射为标签页红色状态 + 终端内提示；`reconnecting` 由前端在用户点「重连」时本地置位。

### 4.3 主机指纹（TOFU）

- 首次连接自动记录 `host:port` 的算法与指纹。
- 后续指纹不匹配 → **硬失败**，不自动覆盖；用户需在「已知主机」中删除记录后重连。
- 指纹数据同样通过 `GET /known-hosts` 暴露给设置面板（当前 UI 仅展示入口，删除接口已就绪）。

### 4.4 安全边界

- 网关只监听 `127.0.0.1`（随机/递增端口），CORS 仅允许 `http://127.0.0.1:*`、`http://localhost:*` 与 Electron 的 `file://`（`Origin: null`）。
- WS 升级与普通请求都会校验 `Origin`（仅 127.0.0.1 / localhost / file://）和 `Host` 请求头（防 DNS rebinding），非回环来源直接 403；`Upgrade` 请求体上限 1 MB。
- 密码/口令只在内存与加密存储中出现，任何 GET 都不回传明文。

## 5. 演示模式（无后端）

未探测到网关时，前端切换到等价的内存/localStorage 实现，**接口语义保持一致**：

- `src/api/mockHostRepository.ts`：`hop.hosts.v1`，内置 4 台示例主机；密码只落 `hasPassword` 布尔值。
- `src/api/mockTransport.ts` + `mockShell.ts`：模拟 SSH 握手（520–760 ms）与一组常用命令（`ls`/`cd`/`cat`/`ps`/`df`/`ping`/`neofetch` 式 `hop` 等），支持 Tab 补全与历史。
- 切换回真实后端无需改代码：重启（或刷新）后自动重新探测。

## 6. 版本与兼容

`/health.contract` 当前为 `1`。破坏性变更（字段删除、语义反转、帧类型改名）需递增版本；
新增可选字段（如未来的 `osHint`）不升版本，前端以「缺省即忽略」处理。
