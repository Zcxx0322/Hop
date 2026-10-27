/**
 * pnpm sometimes skips electron's own postinstall (its build scripts are
 * allow-listed above, but the download can still be skipped when the store was
 * populated on another platform). This hook makes `pnpm install` self-healing:
 * if the electron binary is missing, run electron's installer once.
 *
 * It is deliberately forgiving — a failed download must not break `pnpm install`;
 * the message points at the manual command instead.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

if (process.env.SKIP_ELECTRON_POSTINSTALL === '1') {
  console.log('[postinstall] skipped (SKIP_ELECTRON_POSTINSTALL=1)');
  process.exit(0);
}

let electronDir;
try {
  electronDir = path.dirname(require.resolve('electron/package.json'));
} catch {
  console.log('[postinstall] electron is not installed — nothing to do');
  process.exit(0);
}

const binary =
  process.platform === 'win32'
    ? path.join(electronDir, 'dist', 'electron.exe')
    : process.platform === 'darwin'
      ? path.join(electronDir, 'dist', 'Electron.app')
      : path.join(electronDir, 'dist', 'electron');

if (existsSync(binary)) {
  console.log('[postinstall] electron binary present');
  process.exit(0);
}

console.log('[postinstall] electron binary missing — running electron/install.js');
const result = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (result.status !== 0 || !existsSync(binary)) {
  console.warn(
    [
      '[postinstall] 自动下载 Electron 失败。',
      '请手动执行一次：',
      '  node node_modules/electron/install.js',
      '（国内网络可先设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）',
    ].join('\n'),
  );
  process.exit(0);
}

console.log('[postinstall] electron binary ready');
