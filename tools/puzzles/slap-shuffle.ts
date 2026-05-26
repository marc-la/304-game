// Rules-faithful slap shuffle and cut.
//
// docs/rules.md: "The dealer shuffles the pack, performing 1–4
// overhand shuffles. Minimal shuffling is preferred — this preserves
// the order of cards from the previous game to encourage high-value
// betting. Once shuffled, the player to the left of the dealer may
// cut the pack once, or tap the top of the deck to decline the cut.
// No further shuffles from the dealer after the cut."
//
// One "overhand shuffle" in our table tradition: pull a contiguous
// chunk from the middle of the deck, slap it on top. (This is the
// "pull from middle, slap on top" motion the rules describe.) Repeat
// 1–4 times.
//
// One "cut": split the deck at some position and place the bottom
// piece on top.
//
// Critically: this is a *near-identity* operation. Strong hands that
// arose in one game tend to re-emerge in the next.

import type { CardId } from '../../engine/card';
import { makeRng } from '../../engine/dealing';

export interface ShuffleParams {
  // Number of slap shuffles to perform. Default: random in [2, 4].
  shuffles?: number;
  // Whether the cut happens. Default: random with ~70% probability.
  cut?: boolean;
}

// One slap shuffle: pick a contiguous chunk from somewhere in the
// middle of the deck (not the very top or bottom) and slap it on top.
const slapOnce = (deck: ReadonlyArray<CardId>, rng: () => number): CardId[] => {
  const n = deck.length;
  if (n < 4) return [...deck];
  // Chunk start: anywhere in [n*0.15, n*0.6]. Chunk length: 25%-50% of deck.
  const start = Math.floor(rng() * (n * 0.45) + n * 0.15);
  const lenMin = Math.floor(n * 0.25);
  const lenMax = Math.floor(n * 0.50);
  const len = lenMin + Math.floor(rng() * (lenMax - lenMin + 1));
  const safeLen = Math.max(1, Math.min(len, n - start));
  const chunk = deck.slice(start, start + safeLen);
  const rest = [...deck.slice(0, start), ...deck.slice(start + safeLen)];
  return [...chunk, ...rest];
};

const cutOnce = (deck: ReadonlyArray<CardId>, rng: () => number): CardId[] => {
  const n = deck.length;
  // Cut point in the central 60% so the cut actually moves something.
  const lo = Math.floor(n * 0.2);
  const hi = Math.floor(n * 0.8);
  const at = lo + Math.floor(rng() * (hi - lo + 1));
  return [...deck.slice(at), ...deck.slice(0, at)];
};

export const slapShuffleAndCut = (
  deck: ReadonlyArray<CardId>,
  seed: number,
  params: ShuffleParams = {},
): CardId[] => {
  const rng = makeRng(seed);
  const shuffles = params.shuffles ?? (2 + Math.floor(rng() * 3));
  let cur = [...deck];
  for (let i = 0; i < shuffles; i++) cur = slapOnce(cur, rng);
  const doCut = params.cut ?? (rng() < 0.7);
  if (doCut) cur = cutOnce(cur, rng);
  return cur;
};
