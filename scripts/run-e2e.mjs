import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { bundleArgs, root, runEsbuild } from './esbuild-run.mjs';

const outfile = '.tmp/e2e.cjs';
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });

await runEsbuild(
  bundleArgs('tests/e2e-ssh.ts', outfile, { externals: ['electron'] }),
);

const child = spawn(process.execPath, [path.join(root, outfile)], { cwd: root, stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
