import { createHash, timingSafeEqual } from 'node:crypto';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Constant-time comparison of a presented key's hash against a stored hash
 * (PRD §Security: "compared using constant-time check"). Guard against length
 * leaks by sizing buffers to the hash length regardless of the stored value.
 */
export function verifyApiKeyHash(key: string, storedHash: string | null | undefined): boolean {
  const presented = Buffer.from(hashApiKey(key), 'hex');
  const expected = Buffer.from(storedHash ?? '', 'hex');
  // Both buffers are 32 bytes after hex decode for SHA-256; pad zeroes for a
  // missing stored hash so the comparison still runs at constant length.
  const left = Buffer.alloc(32);
  const right = Buffer.alloc(32);
  presented.copy(left, 0, 0, Math.min(presented.length, 32));
  expected.copy(right, 0, 0, Math.min(expected.length, 32));
  return timingSafeEqual(left, right);
}