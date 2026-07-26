// Live possible-worlds count from South's viewpoint. Soul §IV.7:
// the visible spine of the puzzle.
//
// Strategy: constraint-aware multinomial estimator for the
// general case; switch to exact enumeration when the estimate
// drops below MAX_WORLDS. The estimator factors in deduced void
// constraints — as voids accumulate during play, the displayed
// count drops faster than just hand-size shrinkage would warrant.

import { buildInfoSet, enumerateWorlds, MAX_WORLDS } from '@engine';
import type { Suit } from '@engine/card';
import type { Seat } from '@engine/seating';
import type { Runtime } from './runtime';
import { toEngineState } from './runtime';

export interface WorldsCount {
  estimate: bigint;
  exact: number | null;
  capped: boolean;
}

const ENUM_BUDGET = MAX_WORLDS;

const factBigInt = (n: number): bigint => {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
};

// Multinomial coefficient n! / (k1! * k2! * ... * km!) where
// k_i are the slot sizes (here: opp hand sizes).
const multinomial = (sizes: number[]): bigint => {
  const n = sizes.reduce((a, b) => a + b, 0);
  let num = factBigInt(n);
  for (const k of sizes) num /= factBigInt(k);
  return num;
};

// C(n, k) as bigint.
const choose = (n: number, k: number): bigint => {
  if (k < 0 || k > n) return 0n;
  if (k === 0 || k === n) return 1n;
  let num = 1n, den = 1n;
  for (let i = 1; i <= k; i++) {
    num *= BigInt(n - i + 1);
    den *= BigInt(i);
  }
  return num / den;
};

// Constraint penalty: probability (under a uniform prior over hand
// assignments) that opps' deduced exhaustions hold simultaneously.
// Computed as the product of per-(opp, exhausted-suit) probabilities
// that the opp's hand contains zero cards of that suit, treated as
// independent (over-counts dependence — the result is therefore an
// upper bound on the constraint factor, i.e. a slight over-estimate
// of remaining worlds).
//
// Returned as (numerator, denominator) bigints so caller can apply
// the factor to the estimate without losing precision.
const constraintFactor = (
  poolBySuit: Record<Suit, number>,
  totalPool: number,
  opps: Array<{ size: number; exhausted: ReadonlySet<Suit> }>,
): { num: bigint; den: bigint } => {
  let num = 1n;
  let den = 1n;
  for (const opp of opps) {
    if (opp.size === 0) continue;
    for (const suit of opp.exhausted) {
      const c = poolBySuit[suit];
      if (c === 0) continue;
      // P(no suit in hand of size opp.size drawn from pool of size
      // totalPool) = C(totalPool - c, opp.size) / C(totalPool, opp.size)
      num *= choose(totalPool - c, opp.size);
      den *= choose(totalPool, opp.size);
    }
  }
  return { num, den };
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
  const opps: Array<{ size: number; exhausted: ReadonlySet<Suit> }> = [];
  for (const [seat, size] of info.handSizes) {
    if (seat === viewer) continue;
    sizes.push(size);
    opps.push({ size, exhausted: info.exhaustedSuits.get(seat) ?? new Set() });
  }
  // Hidden folded trump card slot.
  if (info.foldedTrumpOnTable && info.knownFoldedTrumpCard === null) sizes.push(1);
  // Hidden slots — unrevealed face-down opp minuses in completed (and
  // in-progress) rounds. Each occupies one card from the pool with a
  // forbidden-suit constraint (led suit, trump suit). Modelled as
  // size-1 "pseudo-opps" so the multinomial denominator and the
  // constraint factor both account for them.
  for (const hs of info.hiddenSlots) {
    sizes.push(1);
    const forbidden = new Set<Suit>();
    if (hs.knownSuit !== undefined) {
      // The slot is locked to one suit — translate to "exhausted in
      // every other suit" so the constraint factor weights it correctly.
      for (const s of (['c', 'd', 'h', 's'] as Suit[])) {
        if (s !== hs.knownSuit) forbidden.add(s);
      }
    } else {
      forbidden.add(hs.ledSuit);
      // Hidden minuses in completed rounds are also non-trump (any
      // face-down trump would have been revealed at §T9). If
      // info.trumpSuit is known, add it to the forbidden set.
      if (info.trumpSuit !== null) forbidden.add(info.trumpSuit);
    }
    opps.push({ size: 1, exhausted: forbidden });
  }

  // Build pool composition by suit. The "pool" is everything the
  // viewer doesn't see: full deck minus own hand minus knownPlayed
  // minus the known-folded-trump-card (if any).
  const poolBySuit: Record<Suit, number> = { c: 0, d: 0, h: 0, s: 0 };
  let totalPool = 0;
  const seen = new Set<string>([
    ...info.ownHand,
    ...info.knownPlayed,
    ...(info.knownFoldedTrumpCard !== null ? [info.knownFoldedTrumpCard] : []),
  ]);
  for (const suit of ['c', 'd', 'h', 's'] as Suit[]) {
    for (const rank of ['J', '9', 'A', '10', 'K', 'Q', '8', '7']) {
      const card = (rank + suit);
      if (!seen.has(card)) {
        poolBySuit[suit]++;
        totalPool++;
      }
    }
  }

  const baseMultinomial = multinomial(sizes);
  const { num, den } = constraintFactor(poolBySuit, totalPool, opps);

  const estimate = den === 0n ? baseMultinomial : (baseMultinomial * num) / den;

  // Auto-exact when estimate is small enough to enumerate.
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

export const formatWorlds = (w: WorldsCount): string => {
  if (w.exact !== null) {
    if (w.exact === 0) return '—';
    if (w.exact < 1000) return String(w.exact);
    return formatBigInt(BigInt(w.exact));
  }
  return formatBigInt(w.estimate);
};

// Human banding, never scientific notation. `9.4e9` is not a quantity
// anyone reads as tension — it reads as a machine artefact, and the
// exponent steps quantise so coarsely that an ordinary card play often
// showed no change at all while a discovered void showed a visible
// double-step, effectively announcing "something important just
// happened" without the player having noticed what.
const SUFFIXES: ReadonlyArray<[bigint, string]> = [
  [1_000_000_000_000n, 'T'],
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'k'],
];

const formatBigInt = (n: bigint): string => {
  if (n === 0n) return '0';
  if (n < 1000n) return n.toString();
  for (const [unit, suffix] of SUFFIXES) {
    if (n >= unit) {
      // One decimal below 10 units, none above: 9.4B, then 24B.
      const whole = n / unit;
      if (whole < 10n) {
        const tenths = (n * 10n) / unit % 10n;
        return tenths === 0n
          ? `${whole}${suffix}`
          : `${whole}.${tenths}${suffix}`;
      }
      return `${whole}${suffix}`;
    }
  }
  return n.toString();
};

// Numeric measure for difficulty grading (Phase 4).
// Caller passes the worlds count at submitCaps time; this picks
// one comparable scalar (exact when known, log-magnitude of
// estimate otherwise — both bounded into the same regime).
export const measureForDifficulty = (w: WorldsCount): number => {
  if (w.exact !== null) return w.exact;
  // Log-scale the bigint estimate. We don't need precision here.
  const s = w.estimate.toString();
  return Math.pow(10, s.length - 1) * parseFloat(s[0] + '.' + (s[1] ?? '0'));
};
