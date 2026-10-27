import fs from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;

let logDir: string | null = null;
let filePath: string | null = null;
let written = 0;
let stream: fs.WriteStream | null = null;
let muted = process.env.HOP_LOG === '0';

function stamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function rotate(): void {
  if (!logDir || !filePath) return;
  stream?.end();
  stream = null;
  try {
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = path.join(logDir, `hop.${i}.log`);
      const to = path.join(logDir, `hop.${i + 1}.log`);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(filePath)) fs.renameSync(filePath, path.join(logDir, 'hop.1.log'));
  } catch {
    /* rotation is best-effort */
  }
  written = 0;
}

function openStream(): void {
  if (!filePath) return;
  try {
    written = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
  } catch {
    stream = null;
  }
}

export function initLogger(dir: string): string {
  logDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* sandboxed / read-only profile: logging degrades to console */
  }
  filePath = path.join(dir, 'hop.log');
  openStream();
  return filePath;
}

export function logFilePath(): string | null {
  return filePath;
}

function write(level: Level, scope: string, message: string, meta?: unknown): void {
  const line =
    `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}` +
    (meta === undefined ? '' : ` ${safeJson(meta)}`);

  if (!muted) {
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : console.log)(line);
  }
  if (!stream || !filePath) return;

  const bytes = Buffer.byteLength(line) + 1;
  if (written + bytes > MAX_BYTES) {
    rotate();
    openStream();
  }
  stream.write(line + '\n');
  written += bytes;
}

function safeJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v as object)) return '[circular]';
        seen.add(v as object);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, meta?: unknown) => write('debug', scope, msg, meta),
    info: (msg: string, meta?: unknown) => write('info', scope, msg, meta),
    warn: (msg: string, meta?: unknown) => write('warn', scope, msg, meta),
    error: (msg: string, meta?: unknown) => write('error', scope, msg, meta),
  };
}

export function setMuted(value: boolean): void {
  muted = value;
}

export function flushLogger(): void {
  stream?.end();
  stream = null;
}
