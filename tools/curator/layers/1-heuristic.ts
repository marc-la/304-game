// Layer 1 — Static hand-strength heuristic. Cheap dud filter on south's
// hand. Deliberately broad: rejects hands where caps is implausible, but
// does not gate on specific card holdings ("must have a J", "must have
// 5 trump"). Shape variety is preserved.

import { pointsOf, rankOf, suitOf } from '@engine/card';
import type { CardId, Suit } from '@engine/card';
import { SUITS } from '@engine/card';
import type { CuratorThresholds, HandFeatures, Layer1Result } from '../types';

const TRUMP_TOP_RANKS = new Set(['J', '9', 'A']);

const computeFeatures = (
  hand: ReadonlyArray<CardId>,
  trump: Suit,
): HandFeatures => {
  let hcp = 0;
  const bySuit: Record<Suit, CardId[]> = { c: [], d: [], h: [], s: [] };
  for (const c of hand) {
    hcp += pointsOf(c);
    bySuit[suitOf(c)].push(c);
  }

  const trumpHand = bySuit[trump];
  const trumpLen = trumpHand.length;
  let trumpTopCount = 0;
  for (const c of trumpHand) {
    if (TRUMP_TOP_RANKS.has(rankOf(c))) trumpTopCount++;
  }

  const lengths = SUITS.map(s => bySuit[s].length).sort((a, b) => b - a) as
    [number, number, number, number];

  // Top honors: per side suit, count any of {AK pair, J9 pair, JA pair}
  // — proxies for "I can win a non-trump trick by power alone." Bare
  // count, not weighted.
  let topHonors = 0;
  for (const s of SUITS) {
    if (s === trump) continue;
    const ranks = new Set(bySuit[s].map(rankOf));
    if (ranks.has('A') && ranks.has('K')) topHonors++;
    if (ranks.has('J') && ranks.has('9')) topHonors++;
    if (ranks.has('J') && ranks.has('A')) topHonors++;
  }

  return { hcp, trumpLen, trumpTopCount, shape: lengths, topHonors };
};

export const evaluateHand = (
  hand: ReadonlyArray<CardId>,
  trump: Suit,
  thresholds: CuratorThresholds,
): Layer1Result => {
  const features = computeFeatures(hand, trump);

  if (features.trumpLen < thresholds.minTrumpLen) {
    return { pass: false, reason: 'no-trump', features };
  }
  if (features.hcp < thresholds.minHcp && features.trumpTopCount === 0) {
    return { pass: false, reason: 'dud-hand', features };
  }
  if (features.trumpLen === 1 && features.trumpTopCount === 0) {
    return { pass: false, reason: 'fragile-trump', features };
  }
  return { pass: true, features };
};
