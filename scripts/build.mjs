// @ts-check
/**
 * Production build for Hop.
 *
 *   dist/main/index.cjs      Electron main process (esbuild, CJS, ssh2 + ws inlined)
 *   dist/preload/index.cjs   Preload bridge (esbuild, CJS, sandbox-safe)
 *   dist/renderer/           Vite production bundle (relative base for file://)
 *
 * Everything except `electron` itself is bundled, so the packaged app needs no
 * node_modules at runtime and `electron-builder` can set `npmRebuild: false`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { bundleArgs, root, runEsbuild } from './esbuild-run.mjs';

const t0 = Date.now();
const dist = path.join(root, 'dist');
// A stale `dist/` is how duplicate renderer entries creep in; start clean.
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await runEsbuild(
  bundleArgs('src/main/index.ts', 'dist/main/index.cjs', { externals: ['electron'] }),
);
console.log('[build] main bundle ✓');

await runEsbuild(bundleArgs('src/preload/index.ts', 'dist/preload/index.cjs', { externals: ['electron'] }));
console.log('[build] preload bundle ✓');

const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
if (fs.existsSync(viteBin)) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [viteBin, 'build', '--outDir', 'dist/renderer', '--emptyOutDir', '--base', './'],
      { cwd: root, stdio: 'inherit', env: process.env },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`vite build exited ${code}`))));
  });
  console.log('[build] renderer bundle ✓');
} else {
  console.warn('[build] vite is not installed — skipped the renderer bundle');
}

console.log(`[build] done in ${Date.now() - t0}ms`);
