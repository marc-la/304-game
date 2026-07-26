import { motion } from 'framer-motion';
import type { CardId } from '@engine/card';
import { powerOf, suitOf } from '@engine/card';
import type { Suit } from '@engine/card';
import { CardView } from './CardView';

interface Props {
  hand: ReadonlyArray<CardId>;
  legalSet: ReadonlySet<CardId>;
  // Every card of this suit is a trump and is rimmed as one. Marking
  // only the single bid card (the previous behaviour) left a player
  // holding five clubs on a spade contract with no in-hand signal at
  // all — and reading your own long suit as trump is exactly the
  // mistake that follows.
  trumpSuit: Suit;
  // Card folded as trump, highlighted when still in hand. null once
  // the trumper has played it (closed-trump end-state) or before
  // a closed-trump §T9 reveal returns it to hand.
  trumpCard: CardId | null;
  onPlay: (card: CardId) => void;
}

const SUIT_ORDER: ReadonlyArray<'h' | 'd' | 'c' | 's'> = ['s', 'h', 'c', 'd'];

// Trumps sort to the right-hand end of the fan, as a block, however
// the base suit order falls. A physical player fans trumps together;
// the app should too.

const sortedHand = (
  hand: ReadonlyArray<CardId>,
  trumpSuit: Suit,
): CardId[] =>
  [...hand].sort((a, b) => {
    const sa = suitOf(a);
    const sb = suitOf(b);
    if (sa !== sb) {
      if (sa === trumpSuit) return 1;
      if (sb === trumpSuit) return -1;
      return SUIT_ORDER.indexOf(sa) - SUIT_ORDER.indexOf(sb);
    }
    return powerOf(a) - powerOf(b);
  });

export const Hand = ({ hand, legalSet, trumpSuit, trumpCard, onPlay }: Props) => {
  const sorted = sortedHand(hand, trumpSuit);
  return (
    <motion.div
      className="dle-hand"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.75, duration: 0.5, ease: 'easeOut' }}
    >
      {sorted.map((c) => {
        const playable = legalSet.has(c);
        return (
          <CardView
            key={c}
            card={c}
            selectable={playable}
            faded={!playable}
            isTrumpCard={suitOf(c) === trumpSuit}
            isBidCard={c === trumpCard}
            onClick={playable ? () => onPlay(c) : undefined}
          />
        );
      })}
    </motion.div>
  );
};
