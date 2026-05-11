import { useGameStore } from '../../store/gameStore';
import { SEAT_NAMES } from '../../types/game';
import styles from './SubActions.module.css';

export default function PrePlayActions() {
  const openTrump = useGameStore(s => s.openTrump);
  const closedTrump = useGameStore(s => s.closedTrump);
  const spoiltTrumps = useGameStore(s => s.spoiltTrumps);
  const absoluteHand = useGameStore(s => s.absoluteHand);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const gameState = useGameStore(s => s.gameState);
  const isPcc = gameState?.bidding?.is_pcc ?? false;

  return (
    <div className={styles.column}>
      <div className={styles.info}>
        <strong>{whoseTurn ? SEAT_NAMES[whoseTurn] : '?'}</strong>: Choose trump mode
      </div>
      <div className={styles.row}>
        <button className="primary" onClick={() => openTrump()}>
          Open Trump
        </button>
        <button
          className="secondary"
          onClick={closedTrump}
          disabled={isPcc}
          title={isPcc ? 'PCC requires Open Trump' : ''}
        >
          Closed Trump
        </button>
      </div>
      <div className={styles.row}>
        <button className="ghost" onClick={spoiltTrumps}>
          Spoilt Trumps
        </button>
        <button className="ghost" onClick={absoluteHand}>
          Absolute Hand
        </button>
      </div>
      {isPcc && <div className={styles.hint}>PCC active — must declare Open Trump</div>}
    </div>
  );
}
