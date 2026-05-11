import { SEAT_NAMES } from '../../types/game';
import { useGameStore } from '../../store/gameStore';
import styles from './SubActions.module.css';

export default function TrumpActions() {
  const whoseTurn = useGameStore(s => s.whoseTurn);

  return (
    <div className={styles.column}>
      <div className={styles.info}>
        <strong>{whoseTurn ? SEAT_NAMES[whoseTurn] : '?'}</strong>: Click a card in your hand to set as trump.
      </div>
      <div className={styles.hint}>
        The card's suit becomes the trump suit. The card is placed face-down on the table.
      </div>
    </div>
  );
}
