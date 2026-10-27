// @ts-check
/**
 * Shared esbuild runner.
 *
 * The esbuild *JavaScript* API starts a long-lived helper process over pipes,
 * which some sandboxed environments block. The CLI is just as capable, so all
 * scripts shell out to it and keep stdio inherited.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const esbuildBin = path.join(root, 'node_modules/esbuild/bin/esbuild');

/**
 * pnpm keeps transitive dependencies of a package inside the virtual store
 * (`node_modules/.pnpm/node_modules`) instead of the project root. Handing that
 * directory to esbuild as a node path lets it resolve things like `ssh2`'s
 * `asn1` / `bcrypt-pbkdf` dependencies without relying on symlink traversal.
 */
export const virtualStoreModules = path.join(root, 'node_modules/.pnpm/node_modules');

/**
 * @param {string} entry
 * @param {string} outfile
 * @param {{ externals?: string[]; dev?: boolean }} [opts]
 * @returns {string[]}
 */
export function bundleArgs(entry, outfile, opts = {}) {
  const args = [
    path.join(root, entry),
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=cjs',
    `--outfile=${path.join(root, outfile)}`,
    '--log-level=warning',
    // Optional native accelerators: absent (never built here) and already
    // guarded by try/catch inside ssh2 / ws, so leave them unresolved.
    '--external:cpu-features',
    '--external:bufferutil',
    '--external:utf-8-validate',
  ];
  for (const name of opts.externals ?? []) args.push(`--external:${name}`);
  if (opts.dev) {
    args.push('--sourcemap');
    args.push('--define:process.env.NODE_ENV="development"');
  } else {
    args.push('--define:process.env.NODE_ENV="production"');
  }
  return args;
}

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export function runEsbuild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [esbuildBin, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: esbuildEnv(),
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`esbuild exited ${code}`))));
  });
}

/** esbuild honours NODE_PATH, which is how the pnpm virtual store gets found. */
export function esbuildEnv() {
  const existing = process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '';
  return { ...process.env, NODE_PATH: virtualStoreModules + existing };
}

/**
 * @param {string[]} args
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnEsbuild(args) {
  return spawn(process.execPath, [esbuildBin, ...args], { cwd: root, stdio: 'inherit', env: esbuildEnv() });
}
