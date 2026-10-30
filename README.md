# Hop

> 一个安静、克制的 SSH 工作台。主机管理、标签式多会话终端、文件传输、主机状态与偏好设置，都围绕「少一点打扰」设计。

<p align="left">
  <img alt="版本" src="https://img.shields.io/badge/version-0.0.6-2ee66b?style=flat-square" />
  <img alt="平台" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-2ee66b?style=flat-square" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-2ee66b?style=flat-square" />
  <a href="CHANGELOG.md"><img alt="更新日志" src="https://img.shields.io/badge/changelog-中文-2ee66b?style=flat-square" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/welcome.png" alt="Hop 欢迎页：终端预览与最近使用" width="880" />
</p>

| 终端会话 · 左侧文件传输 + 右侧主机状态 | 多会话标签（同一主机可开多个） |
| --- | --- |
| ![终端](docs/screenshots/terminal.png) | ![多会话标签](docs/screenshots/tabs.png) |
| **资产页：列表 + 在线状态 + 发行版图标** | **笔记页：Markdown + 即时渲染** |
| ![资产页](docs/screenshots/assets.png) | ![笔记](docs/screenshots/notes.png) |
| **速记浮层：不离开会话随手记** | **新建连接** |
| ![速记](docs/screenshots/quicknote.png) | ![新建连接](docs/screenshots/host-form.png) |
| **命令面板** | **文件右键菜单** |
| ![命令面板](docs/screenshots/command-palette.png) | ![右键菜单](docs/screenshots/dock-menu.png) |
| **主机状态：逐行纵向排版** | **偏好设置：11 套界面主题 + 9 套终端主题** |
| ![主机状态](docs/screenshots/monitor-detail.png) | ![偏好设置](docs/screenshots/settings.png) |
| **整窗换肤示例：Dracula** | **连接动效：握手进行中** |
| ![Dracula 主题](docs/screenshots/theme-dracula.png) | ![连接中](docs/screenshots/connect.png) |
| **连接动效：握手完成** | **浅色主题：欢迎页（纯白 + 墨绿）** |
| ![已连接](docs/screenshots/connect-done.png) | ![浅色欢迎页](docs/screenshots/welcome-light.png) |
| **浅色主题：终端** | **浅色主题：资产页** |
| ![浅色终端](docs/screenshots/terminal-light.png) | ![浅色资产页](docs/screenshots/assets-light.png) |
| **浅色主题：笔记页** | **欢迎页（深色）** |
| ![浅色笔记页](docs/screenshots/notes-light.png) | ![欢迎页](docs/screenshots/welcome.png) |

| 能力 | 说明 |
| --- | --- |
| 资产页 | 后台管理式列表（标题栏「终端 / 资产 / 笔记」切换，`Esc` 回终端）：主机 / 标签 / 认证 / 上次连接 / 操作六列，每行 **连接 · 编辑 · 删除**，搜索名称·地址·标签，收藏置顶；状态列用 **TCP 探测**（不握手、不碰凭据）区分 在线 / 离线，已建会话显示 已连接，每 20 秒自动刷新 |
| 发行版图标 | 连上主机后自动读取 `/etc/os-release`（回退 `uname`），把发行版记在资产上；Ubuntu / Debian / Arch / Rocky / Fedora / Alpine / openSUSE / Kali 等直接显示品牌标志，未识别时退回主机名首字 |
| 多会话标签 | 同一主机可开多个会话（标签带序号）、连接状态点、快捷键切换、中键/⌘W 关闭 |
| 真终端 | xterm.js + WebGL 渲染 + 自适应尺寸 + 主题跟随 + 断线重连；SSH socket 关闭 Nagle，逐键回显不做多余攒包 |
| 命令面板 | 一个输入框覆盖「连接 / 新建 / 切换 / 设置」，支持 `host:`、`edit:` 前缀 |
| 界面主题 | 11 套：纯黑 + 绿、纯白 + 绿、跟随系统，另移植 One Dark / Dracula / Nord / Tokyo Night / Gruvbox / Catppuccin / Solarized 深浅；偏好设置里卡片预览切换，写入 `data-palette` 覆盖设计令牌 |
| 终端主题 | 9 套，与界面主题**完全独立**：可「跟随界面」，也可固定成 One Dark / Dracula / Nord / Tokyo Night / Gruvbox / Catppuccin / Solarized 深浅，16 色 ANSI、光标与选区整套替换 |
| 无边框窗口 | 自绘标题栏（品牌 / 标签 / 会话操作 / 最小化·最大化·关闭）；文件传输、主机状态、重新连接都在右上角，终端从标题栏下一行直通到底，没有多余横条 |
| 连接动效 | 连接/重连时覆盖终端：呼吸光环 + 分段文案（建通道 → 协商密钥 → 验证身份 → 启动终端），成功后闪光淡出 |
| 文件传输 | 连接后常驻**左侧**：30 px 图标工具条（上一级 / 刷新 / 新建文件夹 / 跟随终端目录 / 上传）+ 带描边与路径图标的可输入路径框（`~`、`/`、绝对/相对路径都能跳，`Esc` 还原），工具条上的「跟随终端目录」按钮点亮后随终端 `cd` 自动切换目录；右键打开/下载/重命名/复制路径/删除，目录按名称排序，可拖拽调宽（260–620 px），从主目录能一路退回 `/` |
| 主机状态 | 连接后常驻**右侧**，一条远端命令采样后**逐行纵向排列**（系统 → CPU → 内存 → 磁盘 → 网络 → 进程）：纯数值一行一项（名称在左、数值在右），带占用率的指标独立成块——名称与数值一行、4 px 细进度条单独一行，文字和条形不再互相挤；两侧可各自关闭、独立拖拽调宽、3 秒刷新 |
| 浏览提速 | SSH 连接统一关闭 Nagle，SFTP 子系统通道按连接复用：目录 437 ms → 104 ms，二次进入 76 ms |
| 复制粘贴 | 选中即复制（可关，只写纯文本）、复制快捷键可配（`Ctrl+C` 或 `Ctrl+Shift+C`）、复制成功轻提示可关，粘贴二选一（`Ctrl+V` / 右键） |
| 传输进度 | 汇总在**整页最下方的一条 39 px 窄栏**：每条传输一行（图标 / 文件名 / 百分比 · 速率 · 剩余），进度线压成 2 px 贴在行底，完成态自动隐藏；失败原因直接写在行内，点 ✕ 收起，新传输开始时自动重新出现 |
| 笔记 | 两种入口：标题栏「笔记」进入完整笔记页；终端页右侧铅笔按钮（或 `Ctrl+Shift+N`）唤出**速记浮层**，不离开会话就能随手记，`Esc` 收起；都兼容常用 Markdown（标题、列表、引用、代码块、表格、链接），笔记页的「即时渲染」开关默认关闭，打开后左右分栏实时预览，内容自动存在本机 |
| 演示模式 | 无后端也可完整运行：内置示例主机 + 模拟 shell |
| 偏好设置 | 标题栏右上角齿轮随时打开；**居中双栏窗口**（左主题、右终端与连接），即时生效并保存在本机，底部保留版本号与「恢复默认」 |

> 复制出来的内容永远是纯文本：ANSI 颜色、行尾多余空白和首尾空行都会在写入剪贴板前剥掉。

## 快速开始

> 下载：到 [Releases](https://github.com/Zcxx0322/Hop/releases) 取对应平台的包——Windows 用 `Hop-0.0.6-x64.exe`（安装版）或 `Hop-0.0.6-portable.zip`（免安装）；
> Linux 用 `Hop-0.0.6-x64.AppImage`（通用，含 Arch）、`Hop-0.0.6-x64.deb`（Ubuntu/Debian）或 `Hop-0.0.6-x64.pkg.tar.zst`（Arch，`pacman -U` 安装）。每个版本的改动都在 [CHANGELOG.md](CHANGELOG.md)。

```bash
pnpm install

# 方式一：Electron 端到端（自动启动本机网关 + Vite）
pnpm dev

# 方式二：纯浏览器前端（默认演示模式；若网关已启动会自动探测到）
pnpm exec vite
```

- 构建：`pnpm build`（Vite 产物 + main/preload 打包）
- 类型检查：`pnpm typecheck`
- 端到端测试（真 SSH 握手 + 网关 REST/WS）：`pnpm test:e2e`（20 项）
- 启动自检（真 Electron 进程内跑一遍后端）：`pnpm smoke`（13 项）
- 打包：`pnpm dist:win` / `pnpm dist:linux`（macOS 需在 macOS 上自行构建），详见下方「打包与分发」
- 重新生成图标（需要 Python + Pillow）：`pnpm icons`

验证覆盖三层：`tsc` 双配置类型检查、`pnpm test:e2e`（自带假 SSH 服务器，覆盖握手/主机密钥/PTY/断线）、
`pnpm smoke`（在真实 Electron 主进程里跑网关与存储）；另外用真实浏览器驱动过完整链路
「前端 → WebSocket → 网关 → ssh2 → xterm」，即上面截图里的会话。

> `pnpm install` 结束时会跑 `scripts/postinstall.mjs`：若 `node_modules/electron/dist/` 里还没有
> Electron 二进制，它会自动调用 electron 官方安装脚本补齐。万一下载失败（网络受限），手动执行一次
> `node node_modules/electron/install.js`；国内网络可先 `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

后端网关默认从 `127.0.0.1:47100` 起自动选端口；前端启动时探测 `47100–47119` 的 `/health`，失败则进入演示模式。
需要固定地址时复制 `.env.example` 为 `.env.local` 并填写 `VITE_HOP_API_BASE` / `VITE_HOP_WS_BASE`。

### 只想跑后端

```bash
pnpm build && pnpm start     # 启动打包后的应用（含网关）
HOP_GATEWAY_PORT=48000 pnpm start   # 固定端口
HOP_GATEWAY=0 pnpm start           # 关闭网关，仅用 IPC
pnpm test:e2e                      # 自带假 SSH 服务器，无需真实主机
```

运行期数据在 `%APPDATA%\Hop\`：`profiles.json`（连接配置）、`secrets.dat`（DPAPI 加密的密码/口令）、`known_hosts.json`（指纹 pin）、`logs\hop.log`（滚动日志，2 MB × 5）。

### 打包与分发

```bash
pnpm dist:win     # Windows：NSIS 安装包 + 免安装 zip
pnpm dist:mac     # macOS：dmg + zip（x64 / arm64，需在 macOS 上运行）
pnpm dist:linux   # Linux：AppImage + deb（x64）
```

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| Windows | `Hop-0.0.6-x64.exe` | NSIS 安装包：开始菜单 / 桌面快捷方式、卸载项 |
| Windows | `Hop-0.0.6-portable.zip` | 免安装：解压到任意目录直接双击 `Hop.exe`，**不经过安装器** |
| Arch Linux | `Hop-0.0.6-x64.pkg.tar.zst` | `sudo pacman -U Hop-0.0.6-x64.pkg.tar.zst` |
| Linux | `Hop-0.0.6-x64.AppImage` | `chmod +x` 后直接运行，不依赖系统库 |
| Linux | `Hop-0.0.6-x64.deb` | Debian / Ubuntu：`sudo dpkg -i` 安装 |

打 tag（`v0.0.5`）后 GitHub Actions 会在 Windows 与 Linux runner 上并行构建，
由最后的发布 job 统一下载、生成中文发布说明并挂到 Releases；网络不好时也可以自己本地构建。

`dist:*` 脚本与 CI 共用同一份 `electron-builder.yml`；目录版可用
`node node_modules/electron-builder/cli.js --win --dir --config electron-builder.yml` 单独产出
`release/win-unpacked/Hop.exe`（免安装，可直接双击）。

目录版已验证：`release/win-unpacked/Hop.exe` 从 `app.asar` 加载主进程与渲染层、启动网关、写入 `profiles.json` / `secrets.dat` 全部正常（13 项进程内自检通过）。主进程与 preload 是自包含单文件，安装包内不含 `node_modules`。

> **安装器写入失败怎么办**：安装包未做代码签名，部分安全软件会拦截 NSIS 往自定义目录
> （例如 `D:\xxx\Hop`）写入 `uninstallerIcon.ico`，弹出「不能打开要写入的文件」。
> 这属于安全软件/系统策略行为，不是安装包损坏。按顺序尝试：
> ① 用免安装 zip 解压即用（最省事，功能完全一致）；
> ② 把安装包加入安全软件信任区或临时关闭其「文件保护 / 主动防御」后重装；
> ③ 安装目录改回向导默认位置（`%LOCALAPPDATA%\Programs\Hop`）；
> ④ 为安装包做代码签名（`win.signtoolOptions` / `CSC_LINK`），从根上消除拦截。

> **受限环境提示**：在没有交互桌面的 CI/沙箱里，Chromium 的沙箱与命名管道可能不可用，需要
> `--no-sandbox --disable-gpu --single-process --user-data-dir=<可写目录>`；正常桌面环境直接双击不需要任何参数。

## 目录结构

```
src/
├── api/                  # 数据与传输层（唯一与后端耦合的地方）
│   ├── config.ts         # 端口探测 / 环境变量 / 演示模式判定
│   ├── hostRepository.ts # HostRepository 接口 + 实现选择
│   ├── httpHostRepository.ts
│   ├── mockHostRepository.ts
│   ├── transport.ts      # TerminalTransport 接口
│   ├── wsTransport.ts
│   ├── http.ts           # 网关 REST 封装（ApiError）
│   ├── workspace.ts      # 文件传输 + 主机监控的 REST 客户端
│   └── mockTransport.ts + mockShell.ts
├── components/
│   ├── TitleBar · TabBar · TerminalPane · Welcome · AssetsPage
│   ├── SideDock · FilesBrowser · MonitorView · TransfersBar
│   ├── NotesPage · CommandPalette · HostFormDialog
│   ├── SettingsPanel · ConfirmDialog
│   └── ui/               # Button · Field · Modal · Kbd · Icon · Logo · Spinner · Toasts
├── hooks/useSystemTheme.ts
├── lib/                  # utils · visual · host（Host↔Draft）· markdown（React 渲染器）
├── store/
│   ├── AppStore.tsx      # 单一 reducer + Context，所有业务动作在此收口
│   ├── settings.ts       # 默认值、钳制与持久化
│   ├── transfers.ts      # 传输记录轮询与订阅
│   ├── cwd.ts            # 终端当前目录（OSC 7 + cd 推断）
│   └── notes.ts          # 笔记存取（本机 localStorage）
├── styles/
│   ├── tokens.css        # 设计令牌：色彩/字号/间距/圆角/动效/终端色
│   ├── base.css          # reset、滚动条、动效关键帧、无障碍工具类
│   └── shell.css         # 应用骨架（标题栏 / 主视图 / 底部传输条）
├── types.ts              # 领域模型（Host / Session / Settings / Toast）
├── App.tsx               # 布局装配、全局快捷键
└── main.tsx              # 探测后端 → 渲染

src/main/                 # Electron 主进程（后端）
├── index.ts              # 装配：日志 → 密钥库 → store → 会话 → IPC → 网关 → 窗口
├── window.ts             # BrowserWindow / CSP / 权限收紧 / 图标
├── core/
│   ├── ssh-session.ts    # 单条 SSH 连接：跳板、主机密钥质询、PTY、批量输出
│   ├── session-manager.ts# 会话表（≤24）、几何钳制、事件钩子
│   ├── remote.ts         # 供子系统复用的临时连接（withRemote / execOnce）
│   ├── sftp-service.ts   # 文件浏览与上传下载、传输记录、~ 解析
│   ├── monitor-service.ts# /proc 采样、CPU/网速差分、连接池
│   ├── profile-store.ts  # 连接配置读写与校验（剥离机密）
│   ├── secret-store.ts   # safeStorage / DPAPI 加密的密码与口令
│   ├── known-hosts.ts    # 主机指纹 pin
│   ├── json-store.ts     # 原子写 + 损坏备份
│   ├── errors.ts · keys.ts · logger.ts
├── ipc/register.ts       # ipcMain.handle → IpcResult 信封
└── server/gateway.ts     # 127.0.0.1 HTTP + WebSocket（前端的 REST/WS 后端）
src/preload/index.ts      # contextBridge：window.hop（IPC 通道 + 事件缓冲）
src/shared/               # 契约类型与通道常量（主进程/preload 共享）
tests/e2e-ssh.ts          # 自带假 SSH 服务器 + 网关协议测试
scripts/                  # build / dev / start / smoke / run-e2e / make-icons
build/                    # 图标：icon.svg · icon.png · icon.ico · icons/
```

组件只通过 `useApp()` 取状态与动作；数据访问全部收敛在 `src/api/*`，替换后端无需触碰视图层。

## 后端（Electron 主进程）

渲染层只负责像素：SSH 连接、凭据、文件与主机指纹全部留在主进程，通过两条传输暴露给界面。

| 传输 | 端点 | 使用者 |
| --- | --- | --- |
| HTTP/WS 网关（默认开启） | `127.0.0.1:47100`（占用时 +1 重试，最多 20 次） | 前端 `src/api/*`（REST + WebSocket） |
| Electron IPC | `window.hop.*` | 未来的原生能力（文件选择、通知、托盘） |

- **连接配置**：name / host / port / username / auth（密码 · 私钥 · agent）/ 跳板 / tags / color / note / favorite / 终端尺寸与保活。
- **会话**：`open` 立即返回快照，后台连接；状态 `connecting → authenticating → connected → disconnected | error`；单进程最多 24 个会话。
- **终端数据流**：PTY 输出经增量 UTF-8 解码后按 **6 ms / 32 KB** 合并成帧；`resize` 50 ms 尾随节流；WS 端 30 s 心跳，`bufferedAmount > 8 MB` 视为消费端失控并断开。
- **凭据**：`safeStorage`（Windows 即 DPAPI）加密存 `secrets.dat`；无密钥环时只驻留内存、不落盘；任何读接口只回 `hasPassword`。
- **主机密钥**：IPC 面弹窗确认可持久化；HTTP 面 TOFU 首次信任、**指纹变更一律拒绝**，需要重信任时清 `known-hosts`。

## 架构与设计文档

| 文档 | 内容 |
| --- | --- |
| [`CHANGELOG.md`](CHANGELOG.md) | 每个版本的中文改动清单（发布页正文也由它生成） |
| [`docs/TECH-DECISION.md`](docs/TECH-DECISION.md) | 选型与理由（Electron / ssh2 / safeStorage / esbuild / electron-builder 的取舍，含踩坑记录） |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 进程模型、模块职责、数据布局、状态机、数据流与性能条款、安全模型、验证策略 |
| [`docs/ICONS.md`](docs/ICONS.md) | 图标概念、几何参数、小尺寸变体、产出清单与再生成方式 |
| [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) | 前端 ↔ 本机网关（REST + WebSocket） |
| [`docs/IPC-CONTRACT.md`](docs/IPC-CONTRACT.md) | Electron main ↔ preload（IPC） |

## 快捷键

| 组合 | 行为 |
| --- | --- |
| `⌘/Ctrl + K` | 命令面板 |
| `⌘/Ctrl + N` | 新建连接 |
| `⌘/Ctrl + ,` | 偏好设置 |
| `⌘/Ctrl + 1…9` | 切换到第 n 个会话 |
| `⌘/Ctrl + Shift + F` | 打开 / 关闭文件传输栏 |
| `⌘/Ctrl + Shift + M` | 打开 / 关闭主机状态（右侧栏） |
| `⌘/Ctrl + Shift + N` | 打开 / 关闭速记浮层（在笔记页时回终端） |
| `⌘/Ctrl + Shift + C` | 复制选中内容 |
| `⌘/Ctrl + Shift + V` | 粘贴（与右键菜单同一入口） |
| `⌘/Ctrl + W` | 关闭当前标签（可在设置中开启二次确认） |
| `Esc` | 关闭浮层；在资产页返回终端 |

终端内保留 shell 自身的按键语义（`Ctrl+C`、`Ctrl+L` 等），只有 `⌘/Ctrl + K` 会在输入框之外被应用层接管。

## 设计说明

- **设计令牌驱动**：`src/styles/tokens.css` 定义全部颜色、字号、间距、圆角与缓动；换肤只改 `data-theme` / `data-accent`。
- **发行版识别**：会话 ready 后主进程用同一条复用连接执行只读探测（`cat /etc/os-release`，回退 `uname -s`），结果写进 profile 的 `distro` 字段，离线也保留；图标取 Simple Icons（CC0）本地内联，不联网。
- **两套配色**：`--ink` 纯黑 + 荧光绿（#3ddc84）与纯白 + 墨绿（#12a150），只有一组强调色，界面与终端同步切换。
- **无边框窗口**：`frame: false` + 自绘 40px 标题栏，`-webkit-app-region: drag` 拖动、双击最大化，窗口控制走 IPC（`hop:window:*`）。
- **终端尺寸自适应**：FitAddon 量的是单元格容器的内容盒，外层 padding 单独承载留白，避免「最后一行压到底栏」。
- **右侧常驻栏**：`grid-template-columns: minmax(0, 1fr) auto`，宽度写入设置（280–620 px，双击分隔条复位 372），窄窗口（<1180 px）自动变成悬浮抽屉。
- **欢迎页的活终端**：空态中间不是静态截图，而是一台已经连上的终端：**首次打开时**依次敲 `uptime` / `df -h /` / `docker ps`，旧输出向上滚出卡片，播完一遍就停在完整记录上，之后不再动（系统设置「减少动态效果」同样直接静态）。
- **有节制的动效**：180 ms 主节奏、`cubic-bezier(0.16, 1, 0.3, 1)`；尊重 `prefers-reduced-motion`。
- **响应式**：资产表格在 1120 px 以下隐藏认证/上次连接列，860 px 以下只留主机与操作、按钮收成纯图标；终端两侧栏 <1180 px 时改为悬浮抽屉；<640 px 收紧标签高度。
- **可访问性**：语义化标签 + `role="tablist"` 键盘左右切换、对话框焦点陷阱与 `aria-modal`、可见焦点环、`aria-live` 通知、图标按钮均带 `aria-label`。

## 接口约定

- 前端 ↔ 本机网关（REST + WebSocket）：[`docs/API-CONTRACT.md`](docs/API-CONTRACT.md)
- Electron main ↔ preload（IPC，UI 暂未使用）：[`docs/IPC-CONTRACT.md`](docs/IPC-CONTRACT.md)

核心不变量：**密码/口令只上行、不回显**；GET 主机只返回 `hasPassword` 布尔值。演示模式同样遵守该约束。

## 技术栈

React 19 · TypeScript · Vite 8 · xterm.js 6 · 原生 CSS（零 UI 框架）· Electron 45 + ssh2 + ws（后端）

后端只用两个运行时依赖：`ssh2`（纯 JS，无原生编译）与 `ws`（网关的 WebSocket 服务端）；构建期用 esbuild 把主进程与 preload 各自打成单文件 CJS，安装包由 electron-builder 生成。
