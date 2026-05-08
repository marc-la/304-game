// Live possible-worlds count from South's viewpoint. Soul §IV.7:
// the visible spine of the puzzle.
//
// Strategy: cheap upper-bound multinomial estimate every play
// (BigInt; the count routinely exceeds 2^53). When the estimate
// drops below EXACT_THRESHOLD, switch to an exact count via the
// engine's world enumerator. Display in scientific notation for
// large counts; integer when small.

import { buildInfoSet, enumerateWorlds, MAX_WORLDS } from './engine';
import type { Seat } from './engine/seating';
import type { Runtime } from './runtime';
import { toEngineState } from './runtime';

export interface WorldsCount {
  estimate: bigint;     // upper-bound multinomial estimate
  exact: number | null; // exact integer when known, else null
  capped: boolean;      // true when even the estimate is capped at the display ceiling
}

const ENUM_BUDGET = MAX_WORLDS; // cap on exact enumeration cost

const factBigInt = (n: number): bigint => {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
};

// Multinomial coefficient (n; k1, k2, ..., km).
const multinomial = (sizes: number[]): bigint => {
  const n = sizes.reduce((a, b) => a + b, 0);
  let num = factBigInt(n);
  for (const k of sizes) num /= factBigInt(k);
  return num;
};

export const countWorlds = (
  rt: Runtime,
  viewer: Seat = 'south',
): WorldsCount => {
  let info;
  try {
    info = buildInfoSet(toEngineState(rt), viewer);
  } catch {
    return { estimate: 0n, exact: 0, capped: false };
  }

  const sizes: number[] = [];
  for (const [seat, size] of info.handSizes) {
    if (seat === viewer) continue;
    sizes.push(size);
  }
  // Add a slot for the folded trump card if it's hidden from viewer.
  if (info.foldedTrumpOnTable && info.knownFoldedTrumpCard === null) sizes.push(1);

  const estimate = multinomial(sizes);

  // Switch to exact when the estimate is small enough that
  // enumeration is feasible. The enumerator caps at MAX_WORLDS;
  // if the actual count is above EXACT_THRESHOLD but below
  // MAX_WORLDS, we still get an exact count.
  if (estimate <= BigInt(ENUM_BUDGET)) {
    let n = 0;
    for (const _ of enumerateWorlds(info, { maxWorlds: ENUM_BUDGET + 1 })) {
      n++;
      if (n > ENUM_BUDGET) break;
    }
    return {
      estimate,
      exact: n <= ENUM_BUDGET ? n : null,
      capped: n > ENUM_BUDGET,
    };
  }

  return { estimate, exact: null, capped: false };
};

// Format a worlds count for display. Always one cell of text.
//   - exact, n=0   → "—"
//   - exact, n=1   → "1"
//   - exact, small → "N" (e.g. "42")
//   - exact, mid   → "1.2k"
//   - estimate     → scientific (e.g. "1.4e7")
export const formatWorlds = (w: WorldsCount): string => {
  if (w.exact !== null) {
    if (w.exact === 0) return '—';
    if (w.exact < 1000) return String(w.exact);
    return formatBigInt(BigInt(w.exact));
  }
  return formatBigInt(w.estimate);
};

const formatBigInt = (n: bigint): string => {
  if (n === 0n) return '0';
  if (n < 1000n) return n.toString();
  // Scientific notation: two significant digits.
  const s = n.toString();
  const exp = s.length - 1;
  const mantissa =
    s.length === 1 ? s
    : s[0] + (s[1] === '0' ? '' : '.' + s[1]);
  return `${mantissa}e${exp}`;
};
