import { useGameStore } from '../../store/gameStore';
import styles from './SubActions.module.css';

export default function ResultDisplay() {
  const gameState = useGameStore(s => s.gameState);
  const nextGame = useGameStore(s => s.nextGame);
  const newMatch = useGameStore(s => s.newMatch);
  const matchComplete = useGameStore(s => s.matchComplete);
  const matchWinner = useGameStore(s => s.matchWinner);
  const result = gameState?.result;

  if (!result) return null;

  const directionLabel =
    result.stone_direction === 'give' ? 'gives' :
    result.stone_direction === 'receive' ? 'receives' : 'no change';

  return (
    <div className={styles.column}>
      <div className={styles.resultBox}>
        <div className={styles.resultTitle}>Game Over</div>
        <div className={styles.resultDesc}>{result.description}</div>
        {result.trumper_points != null && (
          <div className={styles.info}>
            Trumper: {result.trumper_points} pts | Opposition: {result.opposition_points} pts
          </div>
        )}
        {result.stone_exchanged > 0 && (
          <div className={styles.info}>
            Stone: {result.stone_exchanged} ({directionLabel})
          </div>
        )}
        <div className={styles.info}>
          Team A: {gameState?.stone.team_a} | Team B: {gameState?.stone.team_b}
        </div>
      </div>

      {matchComplete ? (
        <div className={styles.column}>
          <div className={styles.matchWinner}>
            Match Winner: {matchWinner === 'team_a' ? 'Team A (N/S)' : 'Team B (E/W)'}!
          </div>
          <button className="primary" onClick={() => newMatch()}>New Match</button>
        </div>
      ) : (
        <div className={styles.row}>
          <button className="primary" onClick={nextGame}>Next Game</button>
          <button className="secondary" onClick={() => newMatch()}>New Match</button>
        </div>
      )}
    </div>
  );
}
