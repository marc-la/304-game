import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import PlayingCard from '../Card/PlayingCard';
import CardBack from '../Card/CardBack';
import type { RoundEntry } from '../../types/game';
import { SEAT_NAMES } from '../../types/game';
import { getVisualPosition } from '../../utils/seatUtils';
import styles from './TrickArea.module.css';

const POSITION_OFFSETS: Record<string, { x: number; y: number }> = {
  bottom: { x: 0, y: 30 },
  top: { x: 0, y: -30 },
  left: { x: -50, y: 0 },
  right: { x: 50, y: 0 },
};

export default function TrickArea() {
  const activeSeat = useGameStore(s => s.activeSeat);
  const gameState = useGameStore(s => s.gameState);
  const play = gameState?.play;
  const lastCompletedRound = useGameStore(s => s.lastCompletedRound);

  const currentRound = play?.current_round ?? [];
  const roundNumber = play?.round_number ?? 0;
  const priority = play?.priority;

  // Show current round cards, or last completed if current is empty
  const displayEntries: RoundEntry[] = currentRound.length > 0 ? currentRound : (lastCompletedRound?.cards ?? []);
  const isLastRound = currentRound.length === 0 && lastCompletedRound != null;

  return (
    <div className={styles.trickArea}>
      {roundNumber > 0 && (
        <div className={styles.roundLabel}>Round {roundNumber} of 8</div>
      )}
      {priority && currentRound.length > 0 && (
        <div className={styles.ledBy}>Led by {SEAT_NAMES[priority]}</div>
      )}
      <div className={styles.cards}>
        <AnimatePresence>
          {displayEntries.map((entry) => {
            const pos = getVisualPosition(entry.seat, activeSeat);
            const offset = POSITION_OFFSETS[pos];
            return (
              <motion.div
                key={`${entry.seat}-${entry.card.str}`}
                className={styles.trickCard}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{
                  opacity: isLastRound ? 0.5 : 1,
                  scale: 1,
                  x: offset.x,
                  y: offset.y,
                }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.2 }}
              >
                {entry.face_down && !entry.revealed ? (
                  <CardBack small label="?" />
                ) : (
                  <PlayingCard card={entry.card} small showPoints={false} />
                )}
                <div className={styles.seatLabel}>{SEAT_NAMES[entry.seat]}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {/* Points summary during play */}
      {play && (
        <div className={styles.pointsSummary}>
          <span className="team-a">A: {play.points_won.team_a}</span>
          {' / '}
          <span className="team-b">B: {play.points_won.team_b}</span>
        </div>
      )}
    </div>
  );
}
