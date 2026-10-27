import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { utils } from 'ssh2';
import { fail } from './errors';

export interface ParsedPrivateKey {
  /** PEM / OpenSSH text, ready for ssh2's `privateKey` option. */
  key: Buffer;
  /** Present when the key is encrypted and a passphrase was supplied. */
  passphrase?: string;
  keyType: string;
  /** "SHA256:…" of the public half, same format as `ssh-keygen -lf`. */
  fingerprint: string;
  /** True when the key material needs a passphrase to be usable. */
  encrypted: boolean;
}

export function sha256Fingerprint(keyBlob: Buffer | string): string {
  const buf = typeof keyBlob === 'string' ? Buffer.from(keyBlob, 'utf8') : keyBlob;
  return `SHA256:${createHash('sha256').update(buf).digest('base64').replace(/=+$/, '')}`;
}

const ENCRYPTED_HINTS = [
  'Encrypted private OpenSSH key detected, but no passphrase given',
  'Encrypted private key detected, but no passphrase given',
];

function isEncryptedError(message: string): boolean {
  return ENCRYPTED_HINTS.some((hint) => message.includes(hint));
}

/** Expand `~` and normalise the path so the UI can send `~/.ssh/id_ed25519`. */
export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function readPrivateKeyFile(keyPath: string): Buffer {
  const resolved = expandHome(keyPath.trim());
  try {
    return fs.readFileSync(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw fail('KEY_INVALID', `找不到私钥文件：${resolved}`);
    }
    if (code === 'EACCES') {
      throw fail('KEY_INVALID', `没有权限读取私钥文件：${resolved}`);
    }
    throw fail('KEY_INVALID', `无法读取私钥文件：${resolved}`, String(err));
  }
}

/**
 * Parse and validate private key material.
 * Never logs the key itself — only the key type and fingerprint.
 */
export function parsePrivateKey(key: Buffer | string, passphrase?: string): ParsedPrivateKey {
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  if (!keyBuf.length) {
    throw fail('KEY_INVALID', '私钥内容为空');
  }

  const attempt = (pass?: string) => (pass === undefined ? utils.parseKey(keyBuf) : utils.parseKey(keyBuf, pass));

  let parsed = attempt(passphrase);
  let encrypted = false;

  if (parsed instanceof Error) {
    if (isEncryptedError(parsed.message)) {
      encrypted = true;
      if (!passphrase) {
        throw fail('KEY_PASSPHRASE_REQUIRED', '私钥已加密，请输入 passphrase');
      }
      throw fail('KEY_PASSPHRASE_REQUIRED', 'passphrase 不正确', parsed.message);
    }
    throw fail('KEY_INVALID', '无法解析私钥（支持 OpenSSH / PEM / PKCS#8）', parsed.message);
  }

  const single = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!single) throw fail('KEY_INVALID', '私钥中没有可用的密钥');

  const publicBlob = single.getPublicSSH();
  return {
    key: keyBuf,
    passphrase,
    keyType: single.type ?? 'unknown',
    fingerprint: sha256Fingerprint(publicBlob),
    encrypted,
  };
}

/** Best-effort fingerprint for UI display; returns null instead of throwing. */
export function tryFingerprint(key: Buffer | string, passphrase?: string): string | null {
  try {
    return parsePrivateKey(key, passphrase).fingerprint;
  } catch {
    return null;
  }
}
