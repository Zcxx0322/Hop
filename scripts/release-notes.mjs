/**
 * 从 CHANGELOG.md 里取当前 tag 对应版本的章节，写成 release-notes.md，
 * 交给 softprops/action-gh-release 作为 Release 正文（中文）。
 *
 * 用法： node scripts/release-notes.mjs [v0.0.2]
 *   不传参数时读 GITHUB_REF_NAME（Actions 里就是 tag 名）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ref = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const version = ref.replace(/^v/, '');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split(/\r?\n/);

const start = lines.findIndex((line) => new RegExp(`^##\\s*v?${version.replace(/\./g, '\\.')}\\s*$`).test(line.trim()));
if (start < 0) {
  console.error(`[release-notes] CHANGELOG.md 中没有找到 v${version} 章节`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (lines[i].startsWith('## ')) {
    end = i;
    break;
  }
}

const section = lines.slice(start + 1, end).join('\n').trim();
const body = [
  `## Hop ${ref}`,
  '',
  section,
  '',
  '---',
  '',
  '### 下载',
  '',
  `- **Windows 安装包**：\`Hop-${version}-x64.exe\`（下面 Assets 里，双击安装，自动建开始菜单与桌面快捷方式）`,
  '- **免安装版**：解压后直接双击 `Hop.exe`，配置与密码都存在程序目录的 `data/` 里',
  '',
  '> 安装包未签名，SmartScreen 拦截时点「更多信息 → 仍要运行」。',
  '> 应用只监听本机 `127.0.0.1:47100`，SSH 连接与凭据都在本地。',
  '',
].join('\n');

writeFileSync('release-notes.md', body, 'utf8');
console.log(`[release-notes] wrote release-notes.md for ${ref} (${body.length} chars)`);
