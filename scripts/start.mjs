// @ts-check
/**
 * Launches the app from source with the locally installed Electron binary.
 *
 *   pnpm start            # after `pnpm build`
 *   pnpm start -- --no-sandbox   # extra Chromium flags are forwarded
 *
 * `npx electron .` works too, but this wrapper strips `ELECTRON_RUN_AS_NODE`
 * (set by some CI/agent shells, which would make Electron behave like plain
 * node) and never depends on a global `electron` command.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { root } from './esbuild-run.mjs';

const electronBin = path.join(
  root,
  process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/electron/dist/electron',
);

if (!fs.existsSync(path.join(root, 'dist/main/index.cjs'))) {
  console.error('[start] dist/main/index.cjs missing — run `pnpm build` first');
  process.exit(1);
}
if (!fs.existsSync(electronBin)) {
  console.error('[start] Electron binary missing — run `node node_modules/electron/install.js`');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, ['.', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
