// Card primitives for the 304dle engine.
//
// Cards are encoded as branded strings (e.g. 'Jc', 'Ah', '10d') rather
// than class instances. This gives free deep equality, set membership,
// JSON serialisation, and Map keys. The brand prevents accidental
// mixing with arbitrary strings.

export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 'J' | '9' | 'A' | '10' | 'K' | 'Q' | '8' | '7';
export type CardId = string & { readonly __brand: 'CardId' };

export const RANKS: readonly Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];

const POWER: Record<Rank, number> = {
  J: 0, '9': 1, A: 2, '10': 3, K: 4, Q: 5, '8': 6, '7': 7,
};
const POINTS: Record<Rank, number> = {
  J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2, '8': 0, '7': 0,
};

export const card = (rank: Rank, suit: Suit): CardId =>
  (rank + suit) as CardId;

export const rankOf = (c: CardId): Rank =>
  (c.length === 3 ? '10' : c[0]) as Rank;

export const suitOf = (c: CardId): Suit =>
  c[c.length - 1] as Suit;

export const powerOf = (c: CardId): number => POWER[rankOf(c)];
export const pointsOf = (c: CardId): number => POINTS[rankOf(c)];

export const PACK: readonly CardId[] = SUITS.flatMap(s =>
  RANKS.map(r => card(r, s)),
);

export const handPoints = (cards: ReadonlyArray<CardId>): number =>
  cards.reduce((sum, c) => sum + pointsOf(c), 0);

// Whether `a` beats `b` in a round, given the led suit and (optional)
// trump suit. Mirrors Card.beats() in the Python reference.
export const beats = (
  a: CardId,
  b: CardId,
  ledSuit: Suit,
  trump: Suit | null,
): boolean => {
  const aTrump = trump !== null && suitOf(a) === trump;
  const bTrump = trump !== null && suitOf(b) === trump;
  if (aTrump && !bTrump) return true;
  if (!aTrump && bTrump) return false;
  if (aTrump && bTrump) return powerOf(a) < powerOf(b);
  if (suitOf(a) === ledSuit && suitOf(b) !== ledSuit) return true;
  if (suitOf(a) !== ledSuit && suitOf(b) === ledSuit) return false;
  if (suitOf(a) === ledSuit && suitOf(b) === ledSuit)
    return powerOf(a) < powerOf(b);
  return false;
};

// Stable sort key — powerful first, ties broken by suit then rank.
// Used by the world enumerator (deterministic output requires sorted
// inputs).
export const cardSortKey = (c: CardId): string => c;

export const sortByCardId = (cards: ReadonlyArray<CardId>): CardId[] =>
  [...cards].sort();
