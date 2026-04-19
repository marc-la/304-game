import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { SEAT_NAMES, SUIT_SYMBOLS } from '../../types/game';
import styles from './CompletedRounds.module.css';

export default function CompletedRounds() {
  const gameState = useGameStore(s => s.gameState);
  const play = gameState?.play;
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!play || play.completed_rounds.length === 0) {
    return <div className={styles.empty}>No completed rounds yet</div>;
  }

  return (
    <div className={styles.list}>
      {play.completed_rounds.map(round => (
        <div key={round.round_number} className={styles.round}>
          <button
            className={styles.roundHeader}
            onClick={() => setExpanded(expanded === round.round_number ? null : round.round_number)}
          >
            <span>Round {round.round_number}</span>
            <span>{SEAT_NAMES[round.winner]} wins ({round.points_won} pts)</span>
            {round.trump_revealed && <span className={styles.trumpBadge}>Trump!</span>}
          </button>
          {expanded === round.round_number && (
            <div className={styles.cards}>
              {round.cards.map(entry => (
                <div key={entry.seat} className={styles.cardEntry}>
                  <span className={styles.cardSeat}>{SEAT_NAMES[entry.seat]}</span>
                  <span
                    className={styles.cardValue}
                    style={{
                      color: entry.card.suit === 'h' || entry.card.suit === 'd'
                        ? 'var(--color-suit-red)' : 'var(--color-suit-black)'
                    }}
                  >
                    {entry.card.rank}{SUIT_SYMBOLS[entry.card.suit]}
                  </span>
                  {entry.face_down && <span className={styles.faceDown}>(was face-down)</span>}
                  {entry.seat === round.winner && <span className={styles.winnerMark}>★</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
