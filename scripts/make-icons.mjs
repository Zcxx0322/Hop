// @ts-check
/**
 * Regenerates `build/icon.svg`, `build/icon.png`, `build/icon.ico` and the
 * per-size PNGs in `build/icons/` by shelling out to `scripts/make-icons.py`
 * (Pillow + numpy). The generated assets are committed, so this is only needed
 * when the artwork changes.
 *
 * Interpreter resolution order:
 *   1. `HOP_PYTHON` environment variable
 *   2. `python` / `python3` / `py` on PATH (each probed with `-c "import PIL"`)
 *
 *   pnpm icons
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { root } from './esbuild-run.mjs';

const script = path.join(root, 'scripts/make-icons.py');
const candidates = [process.env.HOP_PYTHON, 'python', 'python3', 'py'].filter(Boolean);

function probe(bin) {
  // `stdio: 'ignore'` (not 'pipe') — piping child stdio is refused in some
  // hardened/CI shells, and we only care about the exit status here.
  const res = spawnSync(bin, ['-c', 'import PIL, numpy'], { stdio: 'ignore' });
  return res.status === 0;
}

const python = candidates.find((bin) => probe(/** @type {string} */ (bin)));
if (!python) {
  console.error(
    [
      '[icons] No Python with Pillow + numpy found.',
      '        Install Python 3 and run: pip install pillow numpy',
      '        or point HOP_PYTHON at an interpreter, then retry `pnpm icons`.',
      '        The generated icons are already committed under build/ — nothing else needed to build the app.',
    ].join('\n'),
  );
  process.exit(1);
}

const res = spawnSync(/** @type {string} */ (python), [script], { cwd: root, stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status ?? 1);

for (const file of ['build/icon.svg', 'build/icon.png', 'build/icon.ico']) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`[icons] expected ${file} to exist after generation`);
    process.exit(1);
  }
}
console.log('[icons] wrote build/icon.{svg,png,ico} + build/icons/*.png');
