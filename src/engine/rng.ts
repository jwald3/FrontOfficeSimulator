// Deterministic per-run randomness. Every roll is derived from the run seed plus a
// stable key, so the same decision in the same run always produces the same result —
// resubmitting a slightly different offer can't fish for a better roll.

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A uniform roll in [0, 1) that is fixed for this seed and key. */
export function roll(seed: number, key: string): number {
  return mulberry32(seed ^ hashString(key))()
}

/** A roll mapped onto [min, max]. */
export function rollRange(seed: number, key: string, min: number, max: number): number {
  return min + roll(seed, key) * (max - min)
}

export function newSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0
}
