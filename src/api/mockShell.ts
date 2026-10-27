import type { Host } from '../types';

const paint = (color: number, text: string): string => `\x1b[38;5;${color}m${text}\x1b[0m`;
const bold = (text: string): string => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string): string => paint(245, text);

const GREEN = 114;
const BLUE = 111;
const YELLOW = 180;
const RED = 203;

const FILES = [
  { name: 'apps', kind: 'dir' as const, size: '4.0K', time: 'Oct 27 21:02' },
  { name: 'logs', kind: 'dir' as const, size: '12K', time: 'Oct 27 22:11' },
  { name: '.ssh', kind: 'dir' as const, size: '4.0K', time: 'Oct 12 09:31' },
  { name: 'deploy.sh', kind: 'exec' as const, size: '2.1K', time: 'Oct 26 18:47' },
  { name: 'README.md', kind: 'file' as const, size: '1.8K', time: 'Oct 20 10:15' },
  { name: 'notes.md', kind: 'file' as const, size: '860B', time: 'Oct 25 23:04' },
];

const README = [
  '# Hop 演示会话',
  '',
  '这个终端由前端 MockTransport 模拟，用来验证交互与渲染，',
  '不会真正建立 SSH 连接。接上真实后端后，同一套 UI 通过',
  'WebSocket 承载 SSH 通道（协议见 docs/API-CONTRACT.md）。',
  '',
  '试试：help / ls -l / top / ping 1.1.1.1 / exit',
];

const COMMANDS: Array<[string, string]> = [
  ['help', '显示这份帮助'],
  ['ls', '列出文件（支持 -l）'],
  ['pwd', '当前目录'],
  ['cd <dir>', '切换目录'],
  ['whoami', '当前用户'],
  ['hostname', '主机名'],
  ['uname -a', '内核信息'],
  ['uptime', '运行时长'],
  ['date', '系统时间'],
  ['df -h', '磁盘占用'],
  ['free -m', '内存占用'],
  ['top', '进程快照'],
  ['ping <host>', '网络连通性'],
  ['cat <file>', '查看文件'],
  ['echo <text>', '回显'],
  ['history', '命令历史'],
  ['clear', '清屏'],
  ['exit', '结束会话'],
];

interface HostProfile {
  hostname: string;
  os: string;
}

const DEMO_PROFILES: Record<string, HostProfile> = {
  'demo-prod-web': { hostname: 'prod-web-01', os: 'Ubuntu 24.04.2 LTS' },
  'demo-staging-app': { hostname: 'staging-app-02', os: 'Debian GNU/Linux 12' },
  'demo-analytics-db': { hostname: 'analytics-db', os: 'Rocky Linux 9.4' },
  'demo-homelab': { hostname: 'homelab', os: 'Debian GNU/Linux 12 (aarch64)' },
};

function profileFor(host: Host): HostProfile {
  const known = DEMO_PROFILES[host.id];
  if (known) return known;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host.host)) {
    return { hostname: host.host.split('.')[0] || host.host, os: 'Linux 6.8.0-generic' };
  }
  return {
    hostname: `node-${host.host.split('.').at(-1) ?? '01'}`,
    os: 'Linux 6.8.0-generic',
  };
}

function formatDate(date: Date): string {
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getMonth()
  ];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${weekday} ${month} ${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())} CST ${date.getFullYear()}`;
}

/**
 * 一个极简的交互式 shell：支持行编辑、历史、Tab 补全与若干常用命令，
 * 让 Mock 模式和真实终端看起来、用起来都一致。
 */
export class MockShell {
  private readonly write: (chunk: string) => void;
  private readonly host: Host;
  private readonly profile: HostProfile;
  private readonly onExit: () => void;

  private buffer = '';
  private cwd = '~';
  private previousCwd = '~';
  private history: string[] = [];
  private historyCursor = 0;
  private exited = false;

  constructor(write: (chunk: string) => void, host: Host, onExit: () => void) {
    this.write = write;
    this.host = host;
    this.profile = profileFor(host);
    this.onExit = onExit;
  }

  start(): void {
    this.write('\r\n');
    this.write(`  ${bold(paint(BLUE, 'Hop'))} ${dim('演示会话 · 未建立真实 SSH 连接')}\r\n`);
    this.write(
      `  ${dim('host')} ${this.profile.hostname} ${dim('(')}${this.host.host}${dim(')')}` +
        `   ${dim('user')} ${this.host.username}   ${dim('os')} ${this.profile.os}\r\n`,
    );
    this.write(
      `  输入 ${paint(GREEN, 'help')} 查看可用命令，${paint(GREEN, 'exit')} 结束会话。\r\n`,
    );
    this.write('\r\n');
    this.prompt();
  }

  private prompt(): void {
    const userHost = paint(GREEN, `${this.host.username}@${this.profile.hostname}`);
    const path = paint(BLUE, this.cwd);
    this.write(`${userHost}${dim(':')}${path}${dim('$')} `);
  }

  private line(text = ''): void {
    this.write(`${text}\r\n`);
  }

  private redraw(): void {
    // 回车回到行首、清除当前行、重新绘制提示符与输入缓冲
    this.write(`\r\x1b[2K`);
    this.prompt();
    this.write(this.buffer);
  }

  handleInput(data: string): void {
    if (this.exited) return;

    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];

      if (char === '\x1b') {
        const next = data[index + 1];
        const third = data[index + 2];
        if (next === '[' && (third === 'A' || third === 'B')) {
          this.recallHistory(third === 'A' ? -1 : 1);
          index += 2;
          continue;
        }
        if (next === '[' || next === 'O') {
          // 其它方向键 / 功能键：忽略
          index += 2;
          continue;
        }
        continue;
      }

      if (char === '\r' || char === '\n') {
        const command = this.buffer;
        this.buffer = '';
        this.line();
        this.execute(command);
        if (!this.exited) this.prompt();
        continue;
      }

      if (char === '\x7f' || char === '\b') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.write('\b \b');
        }
        continue;
      }

      if (char === '\t') {
        this.complete();
        continue;
      }

      if (char === '\x03') {
        // Ctrl+C
        this.line(`${this.buffer}${dim('^C')}`);
        this.buffer = '';
        this.prompt();
        continue;
      }

      if (char === '\x0c') {
        // Ctrl+L
        this.write('\x1b[2J\x1b[H');
        this.prompt();
        this.write(this.buffer);
        continue;
      }

      if (char === '\x15') {
        // Ctrl+U
        this.write(`\r\x1b[2K`);
        this.buffer = '';
        this.prompt();
        continue;
      }

      if (char < ' ') continue;

      this.buffer += char;
      this.write(char);
    }
  }

  private recallHistory(direction: -1 | 1): void {
    if (this.history.length === 0) return;
    this.historyCursor = Math.min(
      this.history.length,
      Math.max(0, this.historyCursor + direction),
    );
    this.buffer =
      this.historyCursor >= this.history.length
        ? ''
        : this.history[this.historyCursor] ?? '';
    this.redraw();
  }

  private complete(): void {
    const tokens = this.buffer.split(' ');
    const fragment = tokens[tokens.length - 1] ?? '';
    if (!fragment) return;

    const candidates = Array.from(
      new Set([
        ...COMMANDS.map(([name]) => name.split(' ')[0]),
        ...FILES.map((file) => (file.kind === 'dir' ? `${file.name}/` : file.name)),
      ]),
    ).filter((candidate) => candidate.startsWith(fragment));

    if (candidates.length === 0) return;

    const shared = candidates.reduce((prefix, candidate) => {
      let next = prefix;
      while (!candidate.startsWith(next)) next = next.slice(0, -1);
      return next;
    });

    const replacement = candidates.length === 1 ? candidates[0] : shared;
    if (replacement === fragment) return;

    this.buffer = `${tokens.slice(0, -1).join(' ')}${tokens.length > 1 ? ' ' : ''}${replacement}`;
    this.redraw();
  }

  private execute(raw: string): void {
    const input = raw.trim();
    if (!input) return;

    this.history.push(input);
    if (this.history.length > 200) this.history.shift();
    this.historyCursor = this.history.length;

    const [name, ...args] = input.split(/\s+/);
    const command = name.toLowerCase();

    switch (command) {
      case 'help':
        this.line(
          `${bold('可用命令')} ${dim('（演示环境，均可安全尝试）')}`,
        );
        for (const [usage, description] of COMMANDS) {
          this.line(`  ${paint(GREEN, usage.padEnd(16))} ${dim(description)}`);
        }
        return;

      case 'ls':
        this.renderList(args.includes('-l'));
        return;

      case 'pwd':
        this.line(this.cwd === '~' ? `/home/${this.host.username}` : this.cwd);
        return;

      case 'cd': {
        const target = args[0] ?? '~';
        if (target === '~' || target === '/home/' + this.host.username || target === '/') {
          this.previousCwd = this.cwd;
          this.cwd = '~';
          return;
        }
        if (target === '..') {
          const [parent] = this.previousCwd.split('/');
          this.cwd = parent ? parent : '~';
          return;
        }
        const exists = FILES.some((file) => file.kind === 'dir' && file.name === target);
        if (exists) {
          this.cwd = target;
          return;
        }
        this.line(`cd: ${target}: No such file or directory`);
        return;
      }

      case 'whoami':
      case 'id':
        this.line(
          command === 'whoami'
            ? this.host.username
            : `uid=1000(${this.host.username}) gid=1000(${this.host.username}) groups=1000(${this.host.username}),27(sudo)`,
        );
        return;

      case 'hostname':
        this.line(this.profile.hostname);
        return;

      case 'uname':
        this.line(
          args.includes('-a')
            ? `Linux ${this.profile.hostname} 6.8.0-45-generic #45~22.04 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`
            : 'Linux',
        );
        return;

      case 'date':
        this.line(formatDate(new Date()));
        return;

      case 'uptime':
        this.line(
          ` ${formatDate(new Date()).slice(4, 16)} up 42 days, 6:17, 4 users,  load average: 0.12, 0.18, 0.21`,
        );
        return;

      case 'df':
        this.line('Filesystem      Size  Used Avail Use% Mounted on');
        this.line('/dev/sda2        98G   61G   32G  66% /');
        this.line('/dev/sda1       512M  6.2M  506M   2% /boot/efi');
        this.line('tmpfs           3.9G     0  3.9G   0% /dev/shm');
        return;

      case 'free':
        this.line('              total        used        free      shared  buff/cache   available');
        this.line('Mem:           7.8Gi       2.6Gi       1.9Gi       112Mi       3.3Gi       4.8Gi');
        this.line('Swap:          2.0Gi          0B       2.0Gi');
        return;

      case 'top':
        this.line(`top - ${formatDate(new Date()).slice(4, 16)} up 42 days,  4 users,  load average: 0.12, 0.18, 0.21`);
        this.line('Tasks: 128 total,   1 running, 127 sleeping,   0 stopped,   0 zombie');
        this.line('%Cpu(s):  2.3 us,  0.7 sy,  0.0 ni, 96.8 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st');
        this.line('MiB Mem :   7982.4 total,   1951.2 free,   2688.9 used,   3342.3 buff/cache');
        this.line('');
        this.line('    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND');
        this.line(`   1241 ${this.host.username.padEnd(8)}  20   0  812492  68320   1.3   0.8  12:04.31 node`);
        this.line(`    812 root      20   0  102444  11820   0.7   0.1   4:22.08 sshd`);
        this.line(`   1902 nginx     20   0   56812   8264   0.3   0.1   0:48.77 nginx`);
        this.line(`   2033 ${this.host.username.padEnd(8)}  20   0   14224   5216   0.1   0.1   0:02.11 bash`);
        return;

      case 'ping': {
        const target = args[0] ?? '127.0.0.1';
        this.line(`PING ${target} (${target}) 56(84) bytes of data.`);
        [1, 2, 3].forEach((round) => {
          const time = (11.4 + round * 0.37).toFixed(1);
          this.line(`64 bytes from ${target}: icmp_seq=${round} ttl=57 time=${time} ms`);
        });
        this.line('');
        this.line(`--- ${target} ping statistics ---`);
        this.line('3 packets transmitted, 3 received, 0% packet loss, time 2003ms');
        this.line('rtt min/avg/max/mdev = 11.401/11.771/12.140/0.302 ms');
        return;
      }

      case 'cat': {
        const target = (args[0] ?? '').replace(/^~\/?/, '');
        if (target === 'README.md' || target === 'README' || target === 'readme.md') {
          this.line(paint(YELLOW, README[0]));
          README.slice(1).forEach((row) => this.line(row ? `  ${row}` : ''));
          return;
        }
        if (target === 'notes.md') {
          this.line(paint(YELLOW, '# 迁移笔记'));
          this.line('  - 10 月 30 日之后，nginx 配置迁到 apps/gateway');
          this.line('  - 旧跳板机 jp-01 下线，改用 tailscale');
          this.line(`  - 负责人：${this.host.username}`);
          return;
        }
        if (target === 'deploy.sh') {
          this.line(paint(YELLOW, '#!/usr/bin/env bash'));
          this.line('set -euo pipefail');
          this.line('git pull --ff-only');
          this.line('pnpm install --frozen-lockfile');
          this.line('pnpm build && systemctl reload hop-gateway');
          return;
        }
        this.line(`cat: ${target || '(空)'}: No such file or directory`);
        return;
      }

      case 'echo':
        this.line(args.join(' '));
        return;

      case 'history':
        this.history.forEach((entry, index) => {
          this.line(`  ${String(index + 1).padStart(3)}  ${entry}`);
        });
        return;

      case 'clear':
        this.write('\x1b[2J\x1b[H');
        return;

      case 'hop':
        this.line(`Hop v0.1.0 · 会话 ${this.host.username}@${this.profile.hostname}`);
        this.line(`  ${dim('运行模式')} 演示（MockTransport）`);
        this.line(`  ${dim('后端协议')} docs/API-CONTRACT.md`);
        return;

      case 'ssh':
        this.line(dim('嵌套 SSH 在演示模式下不可用；接上真实后端后可直接透传。'));
        return;

      case 'exit':
      case 'logout':
        this.line(dim('与主机的连接已关闭。'));
        this.exited = true;
        this.onExit();
        return;

      default:
        this.line(`bash: ${name}: command not found`);
    }
  }

  private renderList(long: boolean): void {
    if (!long) {
      this.line(
        FILES.map((file) =>
          file.kind === 'dir' ? paint(BLUE, file.name) : file.kind === 'exec' ? paint(GREEN, file.name) : file.name,
        ).join('  '),
      );
      return;
    }
    this.line('total 32');
    for (const file of FILES) {
      const type = file.kind === 'dir' ? 'd' : file.kind === 'exec' ? '-' : '-';
      const mode = file.kind === 'dir' ? 'rwxr-xr-x' : file.kind === 'exec' ? 'rwxr-xr-x' : 'rw-r--r--';
      const name =
        file.kind === 'dir' ? paint(BLUE, file.name) : file.kind === 'exec' ? paint(GREEN, file.name) : file.name;
      this.line(`${type}${mode} 2 ${this.host.username} ${this.host.username} ${file.size.padStart(5)} ${file.time} ${name}`);
    }
  }
}
