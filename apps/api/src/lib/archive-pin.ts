import { sha256Hex } from './crypto';

const ARCHIVE_PIN_PEPPER = 'AetherVault::archive::pin::v1';
/** Default PIN 4316 until the user changes it. */
export const DEFAULT_ARCHIVE_PIN_HASH =
  '5497a55ad274057568919573a3b1d0fc6cdc3c843f955942fe09e9abdd3dc590';

export async function hashArchivePin(pin: string): Promise<string> {
  return sha256Hex(`${ARCHIVE_PIN_PEPPER}:${pin}`);
}

/** Constant-time comparison of a candidate PIN against a stored (or default) hash. */
export async function verifyArchivePin(pin: string, storedHash?: string | null): Promise<boolean> {
  const expected = storedHash || DEFAULT_ARCHIVE_PIN_HASH;
  const actual = await hashArchivePin(pin);
  let diff = 0;
  const a = actual.padEnd(expected.length, '0');
  const b = expected.padEnd(actual.length, '0');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0 && actual.length === expected.length;
}
