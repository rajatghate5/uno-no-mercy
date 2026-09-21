/**
 * Deterministic PRNG (mulberry32).
 *
 * The engine NEVER calls Math.random(). The RNG state is a plain number stored
 * in GameState and threaded through every function that needs randomness, so:
 *
 *   - the same seed always produces the same game,
 *   - a replay is exact rather than approximate,
 *   - a simulation failure can be reproduced by pasting its seed into a test.
 *
 * Every function here is pure: it returns the next state alongside the value.
 */

/** Advance the generator. Returns the next state and a float in [0, 1). */
export function next(state: number): { state: number; value: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/** Integer in [0, maxExclusive). */
export function nextInt(state: number, maxExclusive: number): { state: number; value: number } {
  const r = next(state);
  return { state: r.state, value: Math.floor(r.value * maxExclusive) };
}

/**
 * Fisher-Yates shuffle. Returns a NEW array; the input is not mutated.
 * Iterating downward and swapping with nextInt(i + 1) gives a uniform permutation.
 */
export function shuffle<T>(state: number, items: readonly T[]): { state: number; value: T[] } {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.state;
    const j = r.value;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return { state: s, value: out };
}

/** Derive a numeric seed from an arbitrary string, so seeds can be shareable words. */
export function seedFromString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
