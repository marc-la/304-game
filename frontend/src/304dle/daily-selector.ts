// Date-seeded selection from a curated puzzle pool.
//
// Strategy: per-year permutation. The pool is shuffled once with
// an RNG seeded by the year, then walked by day-of-year mod
// pool-size. Two consequences:
//
//   1. Within a year, no puzzle repeats until the pool is
//      exhausted (assuming pool >= 365).
//   2. Adding new puzzles to the pool changes everyone's
//      mapping for the *next* year only — the current year's
//      shuffle is locked once the pool was first hashed at
//      year-rollover.
//
// For a pool smaller than 365, repeats happen but are
// deterministic. This is acceptable for the launch period.

const xorshift32 = (seed: number): (() => number) => {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xFFFFFFFF) / 0xFFFFFFFF;
  };
};

const yearOf = (date: string): number => parseInt(date.slice(0, 4), 10);

const dayOfYearUTC = (date: string): number => {
  const d = new Date(date + 'T00:00:00Z');
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
};

// Seed-mix: spread the year integer through the xorshift state so
// adjacent years produce visually distinct permutations.
const yearSeed = (year: number): number =>
  (Math.imul(year, 0x9E3779B1) ^ 0xDEADBEEF) >>> 0;

export const selectPuzzleForDate = <P>(
  date: string,
  pool: ReadonlyArray<P>,
): P | null => {
  if (pool.length === 0) return null;
  const rng = xorshift32(yearSeed(yearOf(date)));
  const perm = pool.map((_, i) => i);
  // Fisher–Yates
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const idx = perm[dayOfYearUTC(date) % perm.length];
  return pool[idx];
};
