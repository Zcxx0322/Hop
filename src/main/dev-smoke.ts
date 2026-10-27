import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayHandle } from './server/gateway';

/**
 * End-to-end self check for the packaged main process.
 *
 * Run with `HOP_SMOKE=1` (see `scripts/smoke.mjs`). Everything happens inside
 * the Electron main process, so the checks do not depend on the host being able
 * to reach the app's loopback port from another process — useful in locked-down
 * CI sandboxes.
 */
export async function runSelfCheck(opts: { gateway: GatewayHandle | null; userData: string }): Promise<void> {
  const lines: string[] = [];
  let failed = false;

  const check = (label: string, ok: boolean, extra?: string): void => {
    lines.push(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failed = true;
  };

  const base = opts.gateway?.origin;
  try {
    if (!opts.gateway) throw new Error('gateway disabled');
    check('gateway bound a loopback port', true, opts.gateway.origin);

    const health = await getJson<Record<string, unknown>>(`${base}/health`);
    check('/health answers', true);
    check('name is Hop', health.name === 'Hop', String(health.name));
    check('contract version is 1', health.contract === 1, String(health.contract));
    check('secureStorage is a boolean', typeof health.secureStorage === 'boolean', String(health.secureStorage));

    const hosts = await getJson<unknown[]>(`${base}/hosts`);
    check('/hosts returns an array', Array.isArray(hosts), `${Array.isArray(hosts) ? hosts.length : 0} host(s)`);

    const created = await fetch(`${base}/hosts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'smoke', host: '127.0.0.1', port: 22, username: 'smoke', authMethod: 'password' }),
    });
    const host = (await created.json()) as { id?: string };
    check('POST /hosts creates a host', created.status === 201 && typeof host.id === 'string', host.id);

    if (host.id) {
      const profilesFile = path.join(opts.userData, 'profiles.json');
      const persisted = JSON.parse(fs.readFileSync(profilesFile, 'utf8')) as { data?: unknown[] };
      check('profiles.json persisted under userData', (persisted.data?.length ?? 0) === 1, `${persisted.data?.length ?? 0} profile(s)`);
      check('secrets.dat present', fs.existsSync(path.join(opts.userData, 'secrets.dat')));

      const updated = await fetch(`${base}/hosts/${host.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'smoke-renamed', host: '127.0.0.1', port: 2222, username: 'smoke', authMethod: 'password' }),
      });
      const updatedHost = (await updated.json()) as { name?: string; port?: number };
      check('PUT /hosts/:id updates the host', updatedHost.name === 'smoke-renamed' && updatedHost.port === 2222);

      const removed = await fetch(`${base}/hosts/${host.id}`, { method: 'DELETE' });
      check('DELETE /hosts/:id', removed.status === 204, String(removed.status));
    }

    const known = await getJson<unknown[]>(`${base}/known-hosts`);
    check('/known-hosts returns an array', Array.isArray(known), `${Array.isArray(known) ? known.length : 0} pin(s)`);

    check('renderer bundle present', fs.existsSync(path.join(app.getAppPath(), 'dist/renderer/index.html')));
  } catch (err) {
    check('self check completed without throwing', false, err instanceof Error ? err.message : String(err));
  }

  fs.mkdirSync(opts.userData, { recursive: true });
  fs.writeFileSync(path.join(opts.userData, 'smoke-result.json'), JSON.stringify({ failed, lines }, null, 2));

  console.log(lines.join('\n'));
  app.exit(failed ? 1 : 0);
  // `app.exit` is asynchronous under --single-process; make sure the process
  // really goes away so `scripts/smoke.mjs` does not wait on a live window.
  setTimeout(() => process.exit(failed ? 1 : 0), 500).unref?.();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
