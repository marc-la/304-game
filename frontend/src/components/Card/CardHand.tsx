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
}: Props) {
  const sorted = sortHand(cards);
  const total = handPoints(cards);

  if (!faceUp) {
    const n = count ?? cards.length;
    return (
      <div className={styles.hand}>
        <div className={styles.cards}>
          {Array.from({ length: n }).map((_, i) => (
            <div
              key={i}
              className={styles.cardSlot}
              style={{ marginLeft: i > 0 ? (small ? -30 : -40) : 0 }}
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
              style={{ marginLeft: i > 0 ? (small ? -20 : -15) : 0 }}
            >
              <PlayingCard
                card={card}
                clickable={clickable}
                dimmed={interactive && !isValid}
                onClick={() => onCardClick?.(card)}
                small={small}
                showPoints={showPoints}
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
