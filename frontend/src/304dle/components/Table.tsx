import { AnimatePresence, motion } from 'framer-motion';
import type { Runtime } from '../runtime';
import { whoseTurn } from '../runtime';
import { CardBack, CardView } from './CardView';
import { SUIT_SYMBOLS } from '../../types/game';
import { teamOf, type Seat } from '../engine/seating';

interface Props {
  runtime: Runtime;
}

const SEAT_LABELS: Record<Seat, string> = {
  north: 'Partner',
  east: 'East',
  west: 'West',
  south: 'You',
};

const PETAL: Record<Seat, { row: 1 | 2 | 3; col: 1 | 2 | 3; rotate: number }> = {
  north: { row: 1, col: 2, rotate: 180 },
  west:  { row: 2, col: 1, rotate: 90 },
  south: { row: 3, col: 2, rotate: 0 },
  east:  { row: 2, col: 3, rotate: -90 },
};

const orderedSeats: Seat[] = ['north', 'west', 'south', 'east'];

export const Table = ({ runtime }: Props) => {
  const turn = whoseTurn(runtime);
  const counts = {
    north: runtime.hands.north.length,
    west: runtime.hands.west.length,
    east: runtime.hands.east.length,
  };
  const inProgress = runtime.currentRound;
  const findEntry = (seat: Seat) => inProgress.find(e => e.seat === seat);

  const tricksA = runtime.completedRounds.filter(r => teamOf(r.winner) === 'team_a').length;
  const tricksB = runtime.completedRounds.length - tricksA;

  // Sweep direction for the just-resolved trick.
  const lastCompleted = runtime.completedRounds[runtime.completedRounds.length - 1];
  const sweepTo: 'a' | 'b' | null = lastCompleted
    ? teamOf(lastCompleted.winner) === 'team_a' ? 'a' : 'b'
    : null;
  // Team A pile is bottom-left; Team B pile is top-right.
  const exitX = sweepTo === 'a' ? -160 : sweepTo === 'b' ? 160 : 0;
  const exitY = sweepTo === 'a' ? 80 : sweepTo === 'b' ? -80 : 0;

  return (
    <div className="dle-table">
      <div className="dle-table-header">
        <motion.span
          className="dle-trump-chip"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 18, delay: 0.15 }}
        >
          Trump <span aria-hidden>{SUIT_SYMBOLS[runtime.trumpSuit]}</span>
          <span className="dle-trump-card-mini">
            <CardView card={runtime.trumpCard} small isTrumpCard />
          </span>
        </motion.span>
        <span className="dle-points-readout">
          You/N <b>{runtime.pointsWon.team_a}</b>
          <span className="dle-points-divider">·</span>
          E/W <b>{runtime.pointsWon.team_b}</b>
        </span>
        <span className="dle-round-chip">R {Math.min(runtime.roundNumber, 8)} / 8</span>
      </div>

      <div className="dle-board">
        {/* Team B pile — top-right corner, off-axis */}
        <div className="dle-pile-wrap dle-pile-wrap-b">
          <PileStack count={tricksB} />
        </div>

        {/* Team A pile — bottom-left corner, off-axis */}
        <div className="dle-pile-wrap dle-pile-wrap-a">
          <PileStack count={tricksA} />
        </div>

        {/* North — partner */}
        <motion.div
          className={`dle-seat dle-seat-north${turn === 'north' ? ' dle-seat-active' : ''}`}
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
        >
          <div className="dle-seat-fan dle-seat-fan-h">
            {Array.from({ length: counts.north }).map((_, i) => (
              <CardBack small key={i} />
            ))}
          </div>
          <div className="dle-seat-label">{SEAT_LABELS.north}</div>
        </motion.div>

        {/* West */}
        <motion.div
          className={`dle-seat dle-seat-west${turn === 'west' ? ' dle-seat-active' : ''}`}
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6, duration: 0.5, ease: 'easeOut' }}
        >
          <div className="dle-seat-fan dle-seat-fan-v dle-rotate-cw">
            {Array.from({ length: counts.west }).map((_, i) => (
              <CardBack small key={i} />
            ))}
          </div>
          <div className="dle-seat-label">{SEAT_LABELS.west}</div>
        </motion.div>

        {/* East */}
        <motion.div
          className={`dle-seat dle-seat-east${turn === 'east' ? ' dle-seat-active' : ''}`}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.45, duration: 0.5, ease: 'easeOut' }}
        >
          <div className="dle-seat-fan dle-seat-fan-v dle-rotate-ccw">
            {Array.from({ length: counts.east }).map((_, i) => (
              <CardBack small key={i} />
            ))}
          </div>
          <div className="dle-seat-label">{SEAT_LABELS.east}</div>
        </motion.div>

        {/* Centre — 4-petal flower */}
        <div className="dle-flower">
          <AnimatePresence>
            {orderedSeats.map(seat => {
              const e = findEntry(seat);
              if (!e?.card) return null;
              const p = PETAL[seat];
              return (
                <motion.div
                  key={`${seat}:${runtime.roundNumber}`}
                  className="dle-petal"
                  style={{ gridRow: p.row, gridColumn: p.col }}
                  initial={{ opacity: 0, scale: 0.6, rotate: p.rotate }}
                  animate={{ opacity: 1, scale: 1, rotate: p.rotate }}
                  exit={{
                    opacity: 0, scale: 0.45, rotate: p.rotate,
                    x: exitX, y: exitY,
                    transition: { duration: 0.55, ease: 'easeIn' },
                  }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                >
                  <CardView card={e.card} small />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const PileStack = ({ count }: { count: number }) => {
  if (count === 0) return <span className="dle-pile dle-pile-empty" aria-hidden />;
  const visible = Math.min(count, 4);
  return (
    <span className="dle-pile" aria-label={`${count} tricks won`}>
      {Array.from({ length: visible }).map((_, i) => (
        <span
          key={i}
          className="dle-pile-card"
          style={{
            transform: `translate(${i * 1.5}px, ${-i * 1.5}px)`,
            zIndex: visible - i,
          }}
        />
      ))}
      <span className="dle-pile-count">{count}</span>
    </span>
  );
};
