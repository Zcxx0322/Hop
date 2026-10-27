// @ts-check
/**
 * Smoke test for the production build.
 *
 *   node scripts/build.mjs && node scripts/smoke.mjs
 *
 * Boots `dist/main/index.cjs` inside Electron with `HOP_SMOKE=1`; the main
 * process then exercises the loopback gateway (health / hosts CRUD / known
 * hosts) and writes `.tmp/smoke-userdata/smoke-result.json` before exiting.
 *
 * Running the assertions inside Electron (instead of fetching the port from
 * this script) keeps the check working in sandboxes that deny cross-process
 * loopback connections and named-pipe based IPC.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { root } from './esbuild-run.mjs';

const PORT = Number(process.env.HOP_SMOKE_PORT || 47155);
const userData = path.join(root, '.tmp/smoke-userdata');
const resultFile = path.join(userData, 'smoke-result.json');
const logFile = path.join(userData, 'logs/hop.log');
const electronBin = path.join(root, 'node_modules/electron/dist/electron.exe');

if (!fs.existsSync(path.join(root, 'dist/main/index.cjs'))) {
  console.error('[smoke] dist/main/index.cjs missing — run `pnpm build` first');
  process.exit(1);
}
if (!fs.existsSync(electronBin)) {
  console.error('[smoke] Electron binary missing — run `node node_modules/electron/install.js`');
  process.exit(1);
}

fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const env = { ...process.env, HOP_GATEWAY_PORT: String(PORT), HOP_LOG: '1', HOP_SMOKE: '1' };
// Inherited from some CI/agent shells: makes electron.exe behave like plain
// node, which breaks `require('electron')` (app, BrowserWindow, ... undefined).
delete env.ELECTRON_RUN_AS_NODE;

// Chromium's sandbox cannot initialise inside restricted agent/CI sandboxes,
// where the GUI binary otherwise exits with code 3 before any of our code runs;
// single-process mode avoids the Mojo IPC channel that such sandboxes deny.
const args = ['.', `--user-data-dir=${userData}`, '--disable-gpu', '--no-sandbox', '--single-process'];

const child = spawn(electronBin, args, { cwd: root, stdio: 'inherit', env });

const timeout = setTimeout(() => {
  console.error('[smoke] timed out waiting for the self check');
  child.kill();
}, 90_000);

const exitCode = await new Promise((resolve) => {
  child.on('exit', (code) => resolve(code ?? 1));
  child.on('error', (err) => {
    console.error('[smoke] failed to launch Electron:', err.message);
    resolve(1);
  });
});
clearTimeout(timeout);

let result = null;
try {
  result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
} catch {
  /* no result file — reported below */
}

if (!result) {
  console.error('\n[smoke] the app never produced a self-check result.');
  try {
    console.error('--- app log ---\n' + fs.readFileSync(logFile, 'utf8').slice(-4000));
  } catch {
    console.error('(no log file)');
  }
  process.exit(1);
}

if (result.failed) {
  console.error(`\n[smoke] self check failed (Electron exit ${exitCode})`);
  process.exit(1);
}

// Electron's exit code is unreliable for GUI processes in sandboxes (it can
// surface Chromium's status codes), so the result file is authoritative.
if (exitCode !== 0) console.warn(`[smoke] note: Electron exited with ${exitCode} after a passing self check`);

console.log(`\nsmoke ok — ${result.lines.length} checks`);
process.exit(0);
