// Constant-time check of a request's key against the configured secret. No secret configured means no access.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (v) => createHash('sha256').update(String(v ?? '')).digest();

export function keyOk(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
