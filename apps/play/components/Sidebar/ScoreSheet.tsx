import { useGameStore } from '../../store/gameStore';
import { SEAT_NAMES, BID_NAMES } from '../../types/game';
import styles from './ScoreSheet.module.css';

export default function ScoreSheet() {
  const gameState = useGameStore(s => s.gameState);
  const play = gameState?.play;
  const bidding = gameState?.bidding;
  const trump = gameState?.trump;

  if (!gameState) return <div className={styles.empty}>No game in progress</div>;

  const bid = bidding?.highest_bid ?? 0;
  const bidName = BID_NAMES[bid] || String(bid);
  const trumper = trump?.trumper_seat;

  return (
    <div className={styles.sheet}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Game {gameState.game_number}</div>
        <div className={styles.row}>
          <span>Dealer:</span>
          <strong>{SEAT_NAMES[gameState.dealer]}</strong>
        </div>
        {trumper && (
          <div className={styles.row}>
            <span>Trumper:</span>
            <strong>{SEAT_NAMES[trumper]}</strong>
          </div>
        )}
        {bid > 0 && (
          <div className={styles.row}>
            <span>Bid:</span>
            <strong>{bidName} ({bid})</strong>
          </div>
        )}
      </div>

      {play && play.completed_rounds.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Rounds</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Winner</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {play.completed_rounds.map(r => (
                <tr key={r.round_number}>
                  <td>{r.round_number}</td>
                  <td>{SEAT_NAMES[r.winner]}</td>
                  <td>{r.points_won}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.totals}>
            <span className="team-a">A: {play.points_won.team_a}</span>
            {' | '}
            <span className="team-b">B: {play.points_won.team_b}</span>
          </div>
        </div>
      )}
    </div>
  );
}
