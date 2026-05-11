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
  const mySeat = useGameStore(s => s.mySeat);
  const gameState = useGameStore(s => s.gameState);
  const play = gameState?.play;
  const lastCompletedRound = useGameStore(s => s.lastCompletedRound);
  const pendingRoundContinue = useGameStore(s => s.pendingRoundContinue);
  const continueRound = useGameStore(s => s.continueRound);

  const orient = mySeat ?? 'south';

  const currentRound = play?.current_round ?? [];
  const roundNumber = play?.round_number ?? 0;
  const priority = play?.priority;

  // While paused, force-display the last completed round's cards
  // (engine state has already moved on, but UX-wise the user is still
  // looking at the round they just saw).
  const completedRoundFromState =
    play?.completed_rounds && play.completed_rounds.length > 0
      ? play.completed_rounds[play.completed_rounds.length - 1]
      : null;
  const completedToShow =
    completedRoundFromState ?? lastCompletedRound ?? null;
  const showCompleted =
    pendingRoundContinue ||
    (currentRound.length === 0 && completedToShow != null);

  const displayEntries: RoundEntry[] = showCompleted
    ? (completedToShow?.cards ?? [])
    : currentRound;
  const isLastRound = showCompleted;

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
          {displayEntries.map((entry, idx) => {
            const pos = getVisualPosition(entry.seat, orient);
            const offset = POSITION_OFFSETS[pos];
            // entry.card is null for redacted face-down minuses (we know
            // someone played a card but not which one).
            const showFaceDown =
              entry.face_down && !entry.revealed;
            const cardKey = entry.card?.str ?? `hidden-${idx}`;
            return (
              <motion.div
                key={`${entry.seat}-${cardKey}`}
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
                {showFaceDown || entry.card === null ? (
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
      {pendingRoundContinue && completedToShow && (
        <div className={styles.continuePrompt}>
          <div className={styles.continueText}>
            {SEAT_NAMES[completedToShow.winner]} wins round{' '}
            {completedToShow.round_number} (+{completedToShow.points_won} pts)
          </div>
          <button
            type="button"
            className={styles.continueButton}
            onClick={continueRound}
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}
