import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. `N=16384` is the Node default; keep it explicit. */
const PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const ALGORITHM = 'scrypt';

/** DI token for {@link ConsolePasswordHasher}. */
export const CONSOLE_PASSWORD_HASHER = 'CONSOLE_PASSWORD_HASHER';

/**
 * Password hashing for the admin console (T028 gap G1).
 *
 * Node's built-in `scrypt` is used on purpose: no new dependency, memory-hard,
 * per-credential random salt. Verification is constant time, and a failure
 * behaves like a wrong password — never like a different error that would tell
 * an attacker which step failed.
 */
export interface ConsolePasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

/** `scrypt$N$r$p$salt$key`, all base64url. */
export class ScryptPasswordHasher implements ConsolePasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
    return [
      ALGORITHM,
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (!parsed) {
      return false;
    }
    const { salt, key, params } = parsed;
    const candidate = await scryptAsync(password.normalize('NFKC'), salt, key.length, params);
    return timingSafeEqual(candidate, key);
  }
}

function parse(encoded: string): {
  salt: Buffer;
  key: Buffer;
  params: { N: number; r: number; p: number; maxmem: number };
} | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return null;
  }
  const [, n, r, p, saltPart, keyPart] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const cost = Number(r);
  const parallel = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(cost) || !Number.isInteger(parallel)) {
    return null;
  }
  const salt = Buffer.from(saltPart, 'base64url');
  const key = Buffer.from(keyPart, 'base64url');
  if (salt.length === 0 || key.length === 0) {
    return null;
  }
  return { salt, key, params: { N, r: cost, p: parallel, maxmem: PARAMS.maxmem } };
}
