import { motion } from 'framer-motion';
import type { CardId } from '../engine/card';
import { powerOf, suitOf } from '../engine/card';
import { CardView } from './CardView';

interface Props {
  hand: ReadonlyArray<CardId>;
  legalSet: ReadonlySet<CardId>;
  trumpCard: CardId;          // the card folded as trump (highlighted)
  onPlay: (card: CardId) => void;
}

const SUIT_ORDER: ReadonlyArray<'h' | 'd' | 'c' | 's'> = ['s', 'h', 'c', 'd'];

const sortedHand = (hand: ReadonlyArray<CardId>): CardId[] =>
  [...hand].sort((a, b) => {
    const sa = suitOf(a);
    const sb = suitOf(b);
    if (sa !== sb) return SUIT_ORDER.indexOf(sa) - SUIT_ORDER.indexOf(sb);
    return powerOf(a) - powerOf(b);
  });

export const Hand = ({ hand, legalSet, trumpCard, onPlay }: Props) => {
  const sorted = sortedHand(hand);
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
            isTrumpCard={c === trumpCard}
            onClick={playable ? () => onPlay(c) : undefined}
          />
        );
      })}
    </motion.div>
  );
};
