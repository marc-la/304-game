import { useGameStore } from '../../store/gameStore';
import styles from './StoneDisplay.module.css';

export default function StoneDisplay() {
  const gameState = useGameStore(s => s.gameState);
  if (!gameState) return null;

  const { stone } = gameState;

  return (
    <div className={styles.container}>
      <div className={`${styles.team} ${styles.teamA}`}>
        <span className={styles.label}>Team A (N/S)</span>
        <span className={styles.value}>{stone.team_a}</span>
        <span className={styles.stones}>
          {'●'.repeat(Math.max(0, stone.team_a))}
          {'○'.repeat(Math.max(0, 10 - stone.team_a))}
        </span>
      </div>
      <div className={`${styles.team} ${styles.teamB}`}>
        <span className={styles.label}>Team B (E/W)</span>
        <span className={styles.value}>{stone.team_b}</span>
        <span className={styles.stones}>
          {'●'.repeat(Math.max(0, stone.team_b))}
          {'○'.repeat(Math.max(0, 10 - stone.team_b))}
        </span>
      </div>
    </div>
  );
}
