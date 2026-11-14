import { generateKeyBetween } from 'fractional-indexing';

/** Mix a 32-bit client ID into well-distributed bits for concurrent key jitter. */
function hashClientId(clientId: number, salt: number): number {
  let h = (clientId ^ 0x9e3779b9 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Generates a fractional index key strictly between `a` and `b`, applying deterministic
 * binary subdivisions seeded by `clientId` so concurrent peers do not collide on the
 * exact same interval.
 */
export function generateJitteredKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  clientId?: number,
  salt = 0,
): string {
  let lo: string | null = a ?? null;
  let hi: string | null = b ?? null;

  if (lo !== null && hi !== null && lo >= hi) {
    // Recover gracefully if bounds are inverted/tied
    hi = null;
  }

  let mid: string;
  try {
    mid = generateKeyBetween(lo, hi);
  } catch {
    lo = null;
    hi = null;
    mid = generateKeyBetween(lo, hi);
  }
  if (clientId === undefined) {
    return mid;
  }

  const bits = hashClientId(clientId, salt);
  for (let i = 0; i < 6; i += 1) {
    if (((bits >>> i) & 1) === 0) {
      hi = mid;
    } else {
      lo = mid;
    }
    mid = generateKeyBetween(lo, hi);
  }
  return mid;
}

/** Generates `count` strictly ascending fractional keys between `startAfter` and `endBefore`. */
export function generateSequentialKeys(
  startAfter: string | null | undefined,
  endBefore: string | null | undefined,
  count: number,
  clientId?: number,
): string[] {
  const keys: string[] = [];
  let prev: string | null = startAfter ?? null;
  for (let i = 0; i < count; i += 1) {
    const next = generateJitteredKeyBetween(prev, endBefore, clientId, i);
    keys.push(next);
    prev = next;
  }
  return keys;
}
