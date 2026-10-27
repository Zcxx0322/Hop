/**
 * End-to-end checks for the Hop backend, without Electron:
 *
 *   1. SshSession against a real SSH server (sshd emulated by ssh2.Server)
 *   2. Host-key trust-on-first-use + auto-accept on the second connect
 *   3. The loopback HTTP/WS gateway the renderer talks to
 *
 * Run with `pnpm test:e2e` (esbuild bundles this file, then node executes it).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server, utils } from 'ssh2';
import WebSocket from 'ws';
import { KnownHostsStore } from '../src/main/core/known-hosts';
import { SshSession } from '../src/main/core/ssh-session';
import { startGateway, type GatewayHandle } from '../src/main/server/gateway';

const USER = 'tester';
const PASSWORD = 'secret';
const BANNER = 'HELLO-FROM-FAKE-SSH';

const workDir = mkdtempSync(path.join(tmpdir(), 'hop-e2e-'));

let step = 0;
function pass(name: string): void {
  step += 1;
  console.log(`  ✓ ${name}`);
}

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const value = fn();
      if (value) {
        resolve(value as T);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timeout waiting for ${label}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function startSshServer(): Promise<{
  port: number;
  resizes: { cols: number; rows: number }[];
  close: () => Promise<void>;
}> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const resizes: { cols: number; rows: number }[] = [];

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASSWORD) {
        ctx.accept();
        return;
      }
      if (ctx.method === 'password') {
        ctx.reject();
        return;
      }
      ctx.reject(['password']);
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('window-change', (acceptChange, _reject, info) => {
          resizes.push({ cols: info.cols, rows: info.rows });
          acceptChange?.();
        });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.write(`${BANNER}\r\n`);
          stream.write('$ ');
          stream.on('data', (chunk: Buffer) => stream.write(chunk));
        });
      });
    });

    client.on('error', () => {
      /* connection reset during teardown is expected */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    resizes,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeConf(port: number, opts: { password?: string; keepAliveMs?: number } = {}) {
  const now = new Date().toISOString();
  return {
    profile: {
      id: 'prf_test',
      name: 'Fake SSH',
      host: '127.0.0.1',
      port,
      username: USER,
      auth: { type: 'password' as const, hasSecret: true },
      jump: null,
      cols: 100,
      rows: 30,
      term: 'xterm-256color',
      keepAliveMs: opts.keepAliveMs ?? 0,
      color: '#7c8cf8',
      tags: ['e2e'],
      note: '',
      favorite: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: null,
    },
    target: {
      host: '127.0.0.1',
      port,
      username: USER,
      auth: { type: 'password' as const, password: opts.password ?? PASSWORD },
    },
    jump: null,
    cols: 100,
    rows: 30,
    term: 'xterm-256color',
    keepAliveMs: opts.keepAliveMs ?? 0,
  };
}

async function testSshSession(port: number, knownHosts: KnownHostsStore): Promise<void> {
  console.log('SshSession');
  const challenges: { requestId: string; known: boolean; fingerprint: string }[] = [];
  const statuses: string[] = [];
  let output = '';
  let closed = false;

  const session = new SshSession(
    makeConf(port) as never,
    100,
    30,
    {
      onData: (_id, data) => {
        output += data;
      },
      onStatus: (snapshot) => statuses.push(snapshot.status),
      onClosed: () => {
        closed = true;
      },
      onHostKey: (challenge) => {
        challenges.push(challenge);
      },
    } as never,
    knownHosts,
  );

  const connecting = session.connect();
  const challenge = await waitFor(() => challenges[0], 5000, 'host key challenge');
  assert.equal(challenge.known, false, 'fresh pin file must report an unknown host');
  assert.match(challenge.fingerprint, /^SHA256:/, 'fingerprint is OpenSSH-style');
  pass('host key challenge raised for an unknown host');

  session.answerHostKey(challenge.requestId, true, true);
  await connecting;
  pass('session connects after the challenge is accepted');

  await waitFor(() => output.includes(BANNER), 5000, 'banner output');
  pass('PTY output reaches onData');

  session.write('echo hi\r');
  await waitFor(() => output.includes('echo hi'), 5000, 'echoed input');
  pass('keystrokes reach the pty');

  session.resize(120, 40);
  await waitFor(() => session.snapshot().cols === 120, 5000, 'local resize');
  pass('resize updates the session snapshot');

  session.close();
  await waitFor(() => closed, 5000, 'closed event');
  assert.equal(session.snapshot().status, 'disconnected');
  pass('close tears the session down');

  const pin = knownHosts.check('127.0.0.1', port, 'ssh-ed25519', challenge.fingerprint);
  assert.equal(pin.known, true, 'accepted host key is persisted');
  pass('accepted host key persisted to known_hosts');

  // Second connection: the pin exists, so no new challenge should appear.
  const before = challenges.length;
  let output2 = '';
  const session2 = new SshSession(
    makeConf(port) as never,
    80,
    24,
    {
      onData: (_id, data) => {
        output2 += data;
      },
      onStatus: () => {},
      onClosed: () => {},
      onHostKey: (c) => challenges.push(c),
    } as never,
    knownHosts,
  );
  await session2.connect();
  await waitFor(() => output2.includes(BANNER), 5000, 'second banner');
  assert.equal(challenges.length, before, 'known host is not challenged again');
  pass('second connection reuses the stored pin');
  session2.close();
}

async function testGateway(port: number, knownHosts: KnownHostsStore): Promise<void> {
  console.log('Loopback HTTP/WS gateway');
  const now = new Date().toISOString();
  const host = {
    id: 'prf_test',
    name: 'Fake SSH',
    host: '127.0.0.1',
    port,
    username: USER,
    auth: { type: 'password' as const, hasSecret: true },
    jump: null,
    cols: 100,
    rows: 30,
    term: 'xterm-256color',
    keepAliveMs: 0,
    color: '#7c8cf8',
    tags: ['e2e'],
    note: 'from e2e',
    favorite: true,
    order: 0,
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: null,
  };

  const hosts = new Map<string, any>([[host.id, host]]);
  const profiles = {
    list: () => [...hosts.values()],
    get: (id: string) => hosts.get(id) ?? null,
    save: (input: any) => {
      const id = input.id ?? `prf_${hosts.size + 1}`;
      const saved = { ...host, ...input, id, updatedAt: new Date().toISOString() };
      hosts.set(id, saved);
      return saved;
    },
    remove: (id: string) => {
      hosts.delete(id);
    },
    reorder: () => [...hosts.values()],
    markUsed: () => {},
    resolve: (id: string) => {
      if (!hosts.has(id)) throw new Error('missing profile');
      return makeConf(port) as never;
    },
  };

  const gateway: GatewayHandle = (await startGateway({
    profiles: profiles as never,
    knownHosts,
    secureStorage: true,
    appVersion: '0.0.0-e2e',
    preferredPort: 47_100 + Math.floor(Math.random() * 400),
  }))!;
  assert.ok(gateway, 'gateway started');

  const base = gateway.origin;
  const health = await fetch(`${base}/health`).then((r) => r.json() as Promise<any>);
  assert.equal(health.ok, true);
  pass(`GET /health → ok (port ${gateway.port})`);

  const list = await fetch(`${base}/hosts`).then((r) => r.json() as Promise<any[]>);
  assert.equal(list.length, 1);
  assert.equal(list[0].authMethod, 'password');
  assert.equal(list[0].note, 'from e2e');
  assert.equal(list[0].favorite, true);
  pass('GET /hosts returns renderer-shaped hosts');

  const bad = await fetch(`${base}/hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: '127.0.0.1', username: 'x' }),
  });
  assert.equal(bad.status, 400);
  const badBody = (await bad.json()) as { message?: string };
  assert.ok(badBody.message, 'validation errors carry a message');
  pass('POST /hosts rejects an incomplete draft');

  const created = await fetch(`${base}/hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Created by e2e',
      host: '127.0.0.1',
      port,
      username: USER,
      authMethod: 'password',
      tags: ['new'],
      note: '',
      favorite: false,
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as any;
  assert.ok(createdBody.id);
  pass('POST /hosts creates a host');

  const removed = await fetch(`${base}/hosts/${createdBody.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);
  pass('DELETE /hosts/:id removes a host');

  const pins = await fetch(`${base}/known-hosts`).then((r) => r.json() as Promise<any[]>);
  assert.ok(Array.isArray(pins) && pins.length >= 1, 'known hosts are exposed');
  pass('GET /known-hosts lists pins');

  // ---- WebSocket terminal ----
  const frames: any[] = [];
  let data = '';
  const states: string[] = [];
  const ws = new WebSocket(`${gateway.wsOrigin}/terminal?hostId=prf_test&cols=100&rows=30`);
  ws.on('message', (raw: Buffer) => {
    const frame = JSON.parse(raw.toString('utf8'));
    frames.push(frame);
    if (frame.type === 'data') data += frame.data;
    if (frame.type === 'state') states.push(frame.state);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', sessionId: 'ui-1', hostId: 'prf_test', cols: 100, rows: 30 }));

  await waitFor(() => states.includes('connected'), 8000, 'ws connected state');
  pass('WS /terminal reports "connected"');

  await waitFor(() => data.includes(BANNER), 8000, 'ws banner');
  pass('WS /terminal streams pty output');

  ws.send(JSON.stringify({ type: 'input', data: 'gateway-ping\r' }));
  await waitFor(() => data.includes('gateway-ping'), 5000, 'ws echo');
  pass('WS input reaches the pty');

  ws.send(JSON.stringify({ type: 'resize', cols: 111, rows: 33 }));
  await new Promise((r) => setTimeout(r, 250));

  const closedFrame = new Promise<void>((resolve) => {
    ws.once('close', () => resolve());
  });
  ws.send(JSON.stringify({ type: 'close' }));
  await closedFrame;
  pass('WS close ends the session');

  const badWs = new WebSocket(`${gateway.wsOrigin}/terminal?hostId=does-not-exist&cols=80&rows=24`);
  const badFrames: any[] = [];
  badWs.on('message', (raw: Buffer) => badFrames.push(JSON.parse(raw.toString('utf8'))));
  await new Promise<void>((resolve) => {
    badWs.once('close', () => resolve());
    badWs.once('error', () => resolve());
  });
  assert.ok(badFrames.some((f) => f.type === 'error'), 'unknown host yields an error frame');
  pass('WS rejects an unknown host with an error frame');

  await gateway.close();
  pass('gateway shuts down');
}

async function main(): Promise<void> {
  const ssh = await startSshServer();
  const knownHosts = new KnownHostsStore(path.join(workDir, 'known_hosts.json'));
  console.log(`e2e: fake SSH server on 127.0.0.1:${ssh.port}`);

  try {
    await testSshSession(ssh.port, knownHosts);
    await testGateway(ssh.port, knownHosts);
    console.log(`\nall ${step} checks passed`);
  } finally {
    await ssh.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('\nE2E FAILED:', err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
