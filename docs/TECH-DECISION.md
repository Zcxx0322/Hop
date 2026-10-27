# Hop 技术选型与理由

> 目标：Windows 上可构建、可运行的 SSH 桌面客户端；界面简洁美观；后端支撑 SSH 连接、会话管理与凭据安全存储。
> 本文记录「选了什么、为什么、以及为什么没选看起来更省事的另一条路」。

## 1. 结论速览

| 层 | 选型 | 版本 | 一句话理由 |
| --- | --- | --- | --- |
| 桌面外壳 | **Electron** | 45（Chromium 136 / Node 22） | 唯一能在「无系统工具链」前提下产出真正的 Windows 桌面程序，且 UI 表现力最强 |
| 语言 | **TypeScript** | 5.9 | 主进程与界面共享一套类型定义（`src/shared/contract.ts`），契约即代码 |
| SSH 协议 | **ssh2** | 1.17（纯 JS） | 无原生编译依赖，CI/新机器装上依赖即可跑 |
| 凭据存储 | **Electron `safeStorage`** | 内置 | Windows 上底层就是 DPAPI，用户态下无密钥可被文件拷走 |
| 主进程/预加载打包 | **esbuild（CLI）** | 0.25 | 单条命令、几十毫秒完成；只需 CJS 产物，不需要 dev server |
| 渲染层 | **Vite 8 + React 19 + xterm.js 6** | — | 前端团队既有选择，HMR 快，产物可直接被 `file://` 加载 |
| 安装包 | **electron-builder** | 26 | NSIS 自定义安装目录 + 与 `build/icon.ico` 直接对接 |
| 图标 | **Pillow 生成 PNG/ICO + 手写 SVG** | Pillow 12 | 矢量与位图同源，尺寸/圆角可参数化复现 |

数据流上还有两个刻意的决定：**主进程同时提供 Electron IPC 与本机 HTTP/WS 网关**，以及**主机密钥 TOFU + 变更硬失败**。见第 5、6 节。

## 2. 桌面外壳：Electron，而不是 Tauri / .NET / Qt

候选与判定依据（全部以「本机今天就能 `install → build → run`」为硬门槛）：

| 方案 | 优点 | 淘汰/选中原因 |
| --- | --- | --- |
| **Electron 45** ✅ | 自带 Chromium + Node；`safeStorage`/DPAPI 现成；xterm.js 在 Chromium 里是原生能力（WebGL/字体/缩放）；npm 生态即可完成 SSH | **选中**：不需要 Rust/.NET SDK，纯 JS 依赖树，一条命令出包 |
| Tauri 2 | 包体小、内存低 | 需要 Rust 工具链 + MSVC 链接器，本机没有；WebView2 下 xterm 的字体与滚动表现不如 Chromium 可控 |
| .NET 8 + WPF/WinUI | 原生 Windows 体验、包体小 | 需要 .NET SDK；终端渲染要自己实现 VT 解析，等于重造 xterm |
| Qt 6 + QML | 终端组件成熟（如 QTermWidget） | 需要 Qt SDK/C++ 编译器与授权决策，构建链最重 |
| 纯 Web（PWA） | 零安装 | 拿不到 DPAPI，也起不了本地 SSH 连接——不满足「桌面客户端」定义 |

**代价与应对**：Electron 的安装包 ~90 MB、冷启动 ~0.6 s。对一款常驻工作台来说可接受；我们用 `asar` + 只打包 `dist/**` 控制体积，并在窗口创建前就并行启动网关，避免「白屏等后端」。

## 3. SSH 协议栈：ssh2（纯 JS）

- **纯 JS 是硬要求**：`ssh2` 的可选加速器 `cpu-features` 需要 node-gyp + MSVC；Electron 还需要 `electron-rebuild` 对齐 ABI。我们把它标为 `external` 并允许加载失败（库内部 `try/catch`），因此**没有原生模块也能完整工作**。
- **不自造协议**：OpenSSH 的密钥交换、`known_hosts` 格式、PTY 语义、`forwardOut` 跳板转发都是坑；ssh2 覆盖 KEX、加密算法协商、agent 转发、`hostVerifier` 异步校验，正好匹配「连接前弹指纹确认」的交互。
- **不调系统 `ssh.exe`**：外部进程方案无法拿到结构化的错误/横幅，也难以在 GUI 里做主机密钥确认与多路复用；还要处理 Windows 自带 OpenSSH 版本差异。
- 版本锁定 `^1.17.0`；`@types/ssh2` 1.15 提供 `Client`/`ClientChannel`/`PseudoTtyOptions` 类型。

**关键接口约定**（`node_modules/ssh2/lib/client.js:281-287`）：`hostVerifier(key, verify)` 支持异步回调 —— 我们把 `verify` 存起来，等用户在 UI 里点「信任」再调用，从而实现「连接挂起 → 指纹确认 → 继续握手」的时序。

## 4. 凭据存储：Electron `safeStorage`（DPAPI）

| 方案 | 问题 |
| --- | --- |
| 明文 JSON | 直接淘汰 |
| 自研 AES + 固定密钥 | 密钥只能藏在代码里，等于混淆 |
| keytar（系统凭据库） | 原生模块，需要编译/预编译二进制，Windows 上还要处理 Credential Manager 长度限制 |
| **`safeStorage`** ✅ | 随 Electron 分发；Windows 下调用 DPAPI（用户态 + 机器绑定）；API 极小 |

实现要点（`src/main/core/secret-store.ts`）：

- 优先 `safeStorage.isAsyncEncryptionAvailable()`，回退同步接口（Electron 45 已弃用同步版）。
- 密文以 `enc:<base64>` 落 `secrets.dat`；**拿不到密钥环时只驻留内存，绝不写盘**（早期版本会写 `mem:<plain>`，已修）。
- 接口以 `id` 为键，形如 `profiles/<id>/password`、`profiles/<id>/passphrase`、`profiles/<id>/key`、`profiles/<id>/jump/password`。删除主机时按前缀批量清理。
- 密码/口令**只上行**：任何读接口只返回 `hasPassword: boolean` 与 `keyFingerprint: string`。

## 5. 进程与传输：为什么是「IPC + 本机网关」双通道

前端选了 REST + WebSocket（便于在浏览器里独立开发、也方便将来做 Web 版），而后端核心能力必须留在主进程（只有主进程能碰 `safeStorage`、`dialog`、`ssh2`）。两个方案：

1. 让渲染层走 IPC，要求前端改成 `window.hop.*` 调用；
2. 主进程监听 `127.0.0.1`，把同一套 core 暴露成 HTTP/WS。

选择 **2 为主、1 并存**：

- 渲染层用 `fetch('/hosts')` + `WebSocket('/terminal')`，与浏览器开发模式**完全同构**，只用环境变量切换地址；
- 传输层可替换（前端 `HostRepository` / `TerminalTransport` 两个接口），后端换实现不影响视图；
- IPC 通道（`docs/IPC-CONTRACT.md`）保留给未来的原生能力（文件选择、通知、托盘），复用同一批 store。

安全边界：网关只绑定环回地址、校验 `Origin`（仅 `127.0.0.1`/`localhost`/`file://`/`null`）、不提供任何「读取凭据」的端点，`/health` 只暴露版本与非敏感状态。局域网内其他机器无法访问。

## 6. 主机密钥策略：交互确认 vs TOFU

| 场景 | 策略 | 理由 |
| --- | --- | --- |
| IPC（桌面 UI） | 弹窗确认，用户可选择持久化到 `known_hosts.json` | 有可信 UI，能问就问 |
| HTTP/WS 网关 | **TOFU**：首次自动信任并持久化；**指纹变更一律拒绝** | 网关没有弹窗，静默信任未知主机是唯一可用的自动化路径；但「变了」意味着中间人风险，宁可连接失败 |
| 用户想重新信任 | `GET /known-hosts` 查看、`DELETE /known-hosts?id=` 清除 pin | 显式操作，避免「忽略」按钮被养成习惯 |

## 7. 构建链路

```
pnpm install
  ├─ pnpm-workspace.yaml: nodeLinker=hoisted   # 见下方「踩过的坑」
  └─ postinstall → scripts/postinstall.mjs     # 缺 Electron 二进制就自动补下载
pnpm build
  ├─ esbuild  src/main/index.ts   → dist/main/index.cjs     (external: electron)
  ├─ esbuild  src/preload/index.ts→ dist/preload/index.cjs  (external: electron)
  └─ vite     index.html          → dist/renderer/**
pnpm dist:win
  └─ electron-builder → release/Hop-0.1.0-x64.exe (NSIS)
```

- **esbuild 用 CLI 而不是 JS API**：本机受限沙箱下 `child_process` 的 pipe 句柄受限，esbuild 的 JS API 会 `EPERM`；CLI + `stdio: 'inherit'` 稳定。主进程构建因此还顺手拿到了跨平台一致的行为。
- **ssh2/ws 打进 bundle**：pnpm 的 symlink/junction 布局在部分 Windows 环境下不被 Node 解析，把依赖内联后 `dist/main/index.cjs`（约 900 KB）只依赖 `electron` 一个外部模块；`electron-builder` 因此可以 `npmRebuild: false` 且 `files` 里用 `!node_modules/**` 排除整个依赖树，`app.asar` 从 12.9 MB 降到 1.7 MB。
- **`pnpm-workspace.yaml` 固化 `nodeLinker: hoisted`**：pnpm 11 起，项目级配置（`node-linker` 等）只从 `pnpm-workspace.yaml` 读取，`.npmrc` 里的同名项会被忽略——这一点是实测 `pnpm config list` 才发现的。hoisted 布局让 `node_modules` 里是真实目录，electron-builder 的打包遍历、esbuild 的可执行文件落地、ssh2 的可选原生依赖探测都更可预测（早期 isolated 布局在本机沙箱里曾报 `Cannot find module 'asn1'`）。
- **`onlyBuiltDependencies` + postinstall 自愈**：`electron` 的构建脚本被允许执行，但 pnpm 从别的平台同步过来的 store 仍可能跳过二进制下载；`scripts/postinstall.mjs` 在安装末尾检查 `node_modules/electron/dist/`，缺失就调用 electron 官方安装脚本，失败时只提示手动命令而不让 `pnpm install` 变成红色。

### 打包结果（已实测）

| 产物 | 状态 |
| --- | --- |
| `release/win-unpacked/Hop.exe`（目录版，359 MB，Electron 45 + app.asar 1.7 MB） | ✅ 生成并运行自检通过（13 项：网关绑定、`/health`、CRUD、`profiles.json`、`secrets.dat`、`file://` 渲染层加载） |
| `release/Hop-0.1.0-x64.exe`（NSIS 安装包，约 122 MB） | ✅ 已产出：`electron-builder` 首次运行会 `exec` 外部 `7za`/NSIS 工具链并下载工具包，在受限沙箱里会 `spawn EPERM`，普通终端或放开外部进程的环境正常 |

> Windows 上还需要注意：Electron 的 `@electron/get` 会把 Electron 压缩包缓存到 `%LOCALAPPDATA%\electron`，受限环境可用 `LOCALAPPDATA`（或 `electron_config_cache`）指向可写目录，`electron-builder` 自身缓存用 `ELECTRON_BUILDER_CACHE`。

## 8. 踩过的坑（供后来者少走）

1. `ELECTRON_RUN_AS_NODE=1` 若残留在环境里，`electron.exe` 会退化成 node，报 `Cannot read properties of undefined (reading 'isPackaged')`。`scripts/{start,dev,smoke}.mjs` 一律 `delete env.ELECTRON_RUN_AS_NODE`。
2. Windows 受限沙箱中 Chromium 无法建命名管道（`platform_channel.cc:112 Check failed`）；无头验证时用 `--no-sandbox --single-process`，正常桌面环境不需要。
3. `spawn` 子进程必须 `stdio: 'inherit'`——`pipe` 在受限环境下 `EPERM`。
4. Electron 的 `safeStorage.isEncryptionAvailable()` 在 45 已 deprecated，改用 `isAsyncEncryptionAvailable()`。
5. `app.exit(code)` 在 `--single-process` 下不立即生效，`dev-smoke` 末尾补 `process.exit`。
6. `@electron/get` 默认缓存写在 `%LOCALAPPDATA%`；受限环境下用 `electron_config_cache=<repo>/.cache/electron` 覆盖即可。

## 9. 未来若要演进

- **多路复用**：ssh2 的 `Client` 已支持多 channel，可为「同一主机的多个标签复用一条连接」加一层连接池（当前每会话一条连接，简单且隔离明确）。
- **端口转发 / SFTP**：`forwardOut` 与 `sftp` 已在库内，后端只需新增 IPC/HTTP 端点，不改动既有契约。
- **Web 版**：网关已是 HTTP/WS，前端可脱离 Electron 部署；届时把网关从环回改为鉴权暴露即可（需要重新审视 TOFU 与凭据策略）。
