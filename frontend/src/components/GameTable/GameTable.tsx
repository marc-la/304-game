import { useGameStore } from '../../store/gameStore';
import SeatPosition from './SeatPosition';
import TrickArea from './TrickArea';
import StoneDisplay from './StoneDisplay';
import TrumpIndicator from './TrumpIndicator';
import type { Seat } from '../../types/game';
import { SEATS } from '../../types/game';
import { getVisualPosition } from '../../utils/seatUtils';
import styles from './GameTable.module.css';

export default function GameTable() {
  const mySeat = useGameStore(s => s.mySeat);
  const gameState = useGameStore(s => s.gameState);

  if (!gameState) {
    return (
      <div className={styles.table}>
        <div className={styles.emptyMessage}>Start a new match to begin</div>
      </div>
    );
  }

  // Orient the table on the local player. In solo/dev mode (no mySeat),
  // default to South so the layout still looks right.
  const orient: Seat = mySeat ?? 'south';

  const seatsByPosition = {} as Record<string, Seat>;
  for (const seat of SEATS) {
    seatsByPosition[getVisualPosition(seat, orient)] = seat;
  }

  return (
    <div className={styles.table}>
      <div className={styles.topArea}>
        <SeatPosition seat={seatsByPosition.top} position="top" />
      </div>
      <div className={styles.middleArea}>
        <div className={styles.leftArea}>
          <SeatPosition seat={seatsByPosition.left} position="left" />
        </div>
        <div className={styles.centerArea}>
          <StoneDisplay />
          <TrickArea />
          <TrumpIndicator />
        </div>
        <div className={styles.rightArea}>
          <SeatPosition seat={seatsByPosition.right} position="right" />
        </div>
      </div>
      <div className={styles.bottomArea}>
        <SeatPosition seat={seatsByPosition.bottom} position="bottom" />
      </div>
    </div>
  );
}
