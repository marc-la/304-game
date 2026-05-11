import type { CardData } from '../../types/game';
import PlayingCard from './PlayingCard';
import CardBack from './CardBack';
import { sortHand, isCardInList, handPoints } from '../../utils/cardUtils';
import styles from './CardHand.module.css';

interface Props {
  cards: CardData[];
  /** Card count for face-down rendering. Defaults to cards.length.
   *  In lobby mode, opponents send empty cards arrays — use ``count``
   *  (from handCounts) to render the right number of card backs. */
  count?: number;
  validPlays?: CardData[];
  faceUp?: boolean;
  small?: boolean;
  onCardClick?: (card: CardData) => void;
  showPoints?: boolean;
  interactive?: boolean;
  /** The card.str of the folded trump card if it's currently
   *  showing in this hand (engine reports it as a valid play for the
   *  trumper even though it isn't strictly "in hand"). Gets the
   *  gold TRUMP tag in the visualisation. */
  trumpCardStr?: string | null;
  /** Suit of the trump for the round, used to subtly mark in-hand
   *  cards of the trump suit. */
  trumpSuit?: 'c' | 'd' | 'h' | 's' | null;
}

export default function CardHand({
  cards,
  count,
  validPlays = [],
  faceUp = true,
  small = false,
  onCardClick,
  showPoints = true,
  interactive = false,
  trumpCardStr = null,
  trumpSuit = null,
}: Props) {
  const sorted = sortHand(cards);
  const total = handPoints(cards);

  // Card spacing:
  // - Face-down stacks (opponents): heavy overlap so the stack is compact.
  // - Opponent face-up (peek/scrutiny): light overlap, still small.
  // - Player's own face-up hand (small=false): NO overlap — cards laid
  //   out side-by-side with a small positive gap so each card is fully
  //   readable.
  const overlapFor = (i: number): number => {
    if (i === 0) return 0;
    if (!faceUp) return small ? -30 : -40;
    if (small) return -20;
    return 6;
  };

  if (!faceUp) {
    const n = count ?? cards.length;
    return (
      <div className={styles.hand}>
        <div className={styles.cards}>
          {Array.from({ length: n }).map((_, i) => (
            <div
              key={i}
              className={styles.cardSlot}
              style={{ marginLeft: overlapFor(i) }}
            >
              <CardBack small={small} />
            </div>
          ))}
        </div>
        {n > 0 && <div className={styles.count}>{n}</div>}
      </div>
    );
  }

  return (
    <div className={styles.hand}>
      <div className={styles.cards}>
        {sorted.map((card, i) => {
          const isValid = validPlays.length === 0 || isCardInList(card, validPlays);
          const clickable = interactive && isValid;
          return (
            <div
              key={card.str}
              className={styles.cardSlot}
              style={{ marginLeft: overlapFor(i) }}
            >
              <PlayingCard
                card={card}
                clickable={clickable}
                dimmed={interactive && !isValid}
                onClick={() => onCardClick?.(card)}
                small={small}
                showPoints={showPoints}
                isTrump={trumpCardStr !== null && card.str === trumpCardStr}
                isTrumpSuit={trumpSuit !== null && card.suit === trumpSuit}
              />
            </div>
          );
        })}
      </div>
      {showPoints && cards.length > 0 && (
        <div className={styles.pointTotal}>{total} pts</div>
      )}
    </div>
  );
}
