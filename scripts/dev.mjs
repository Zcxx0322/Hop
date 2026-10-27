// @ts-check
/**
 * Development loop:
 *   1. start the Vite dev server (renderer, HMR)
 *   2. bundle main + preload with the esbuild CLI
 *   3. launch Electron, restart it whenever a main/preload source file changes
 *
 * Usage: pnpm dev            (Ctrl-C stops everything)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { bundleArgs, root, runEsbuild } from './esbuild-run.mjs';

const DEV_SERVER_URL = process.env.HOP_DEV_SERVER_URL || 'http://127.0.0.1:5273';
const electronBin = path.join(root, 'node_modules/electron/dist/electron.exe');

let vite = /** @type {import('node:child_process').ChildProcess | null} */ (null);
let electron = /** @type {import('node:child_process').ChildProcess | null} */ (null);
let rebuilding = false;
let pendingRebuild = false;
let shuttingDown = false;

function startVite() {
  const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [viteBin, '--port', '5273', '--strictPort'], { cwd: root, stdio: 'inherit' });
  vite.on('exit', (code) => {
    if (code && !shuttingDown) console.error(`[dev] vite exited with ${code}`);
  });
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startElectron() {
  if (!fs.existsSync(electronBin)) {
    console.error('[dev] Electron binary missing — run `node node_modules/electron/install.js`');
    process.exit(1);
  }
  const env = { ...process.env, HOP_DEV_SERVER_URL: DEV_SERVER_URL, HOP_LOG: '1' };
  // Inherited from some CI/agent shells: makes electron.exe behave like plain
  // node, which breaks `require('electron')`.
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronBin, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  electron.on('exit', (code) => {
    electron = null;
    if (!shuttingDown) shutdown(code ?? 0);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    electron?.kill();
  } catch {
    /* ignore */
  }
  try {
    vite?.kill();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function rebuild() {
  if (rebuilding) {
    pendingRebuild = true;
    return;
  }
  rebuilding = true;
  try {
    await runEsbuild(bundleArgs('src/main/index.ts', 'dist/main/index.cjs', { externals: ['electron'], dev: true }));
    await runEsbuild(bundleArgs('src/preload/index.ts', 'dist/preload/index.cjs', { externals: ['electron'], dev: true }));
    console.log('[dev] bundles rebuilt');
  } catch (err) {
    console.error('[dev] rebuild failed:', err instanceof Error ? err.message : err);
  } finally {
    rebuilding = false;
    if (pendingRebuild) {
      pendingRebuild = false;
      void rebuild();
    }
  }
}

let debounce = /** @type {NodeJS.Timeout | null} */ (null);
function scheduleRebuild() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void rebuild().then(() => {
      if (electron) {
        console.log('[dev] restarting Electron');
        electron.removeAllListeners('exit');
        electron.once('exit', () => startElectron());
        electron.kill();
      }
    });
  }, 200);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

await rebuild();
for (const dir of ['src/main', 'src/preload', 'src/shared']) {
  fs.watch(path.join(root, dir), { recursive: true }, (_event, file) => {
    if (!file || !/\.(ts|mts|cts)$/.test(String(file))) return;
    scheduleRebuild();
  });
}

startVite();
if (await waitForServer(DEV_SERVER_URL)) console.log(`[dev] renderer ready at ${DEV_SERVER_URL}`);
else console.warn(`[dev] ${DEV_SERVER_URL} did not answer yet — starting Electron anyway`);
startElectron();
