import type { CardId } from '../engine/card';
import { powerOf, suitOf } from '../engine/card';
import { CardView } from './CardView';

interface Props {
  hand: ReadonlyArray<CardId>;
  legalSet: ReadonlySet<CardId>;
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

export const Hand = ({ hand, legalSet, onPlay }: Props) => {
  const sorted = sortedHand(hand);
  return (
    <div className="dle-hand">
      {sorted.map((c) => {
        const playable = legalSet.has(c);
        return (
          <CardView
            key={c}
            card={c}
            selectable={playable}
            faded={!playable}
            onClick={playable ? () => onPlay(c) : undefined}
          />
        );
      })}
    </div>
  );
};
