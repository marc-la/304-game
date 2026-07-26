import { AnimatePresence, motion } from 'framer-motion';
import { suitOf } from '@engine/card';
import type { RoundEntry } from '@engine/state';
import type { Runtime } from '../runtime';
import { turnOrder, whoseTurn } from '../runtime';
import { CardBack, CardView } from './CardView';
import { PublicInfo } from './PublicInfo';
import type { WorldsCount } from '../worlds-counter';
import { SUIT_SYMBOLS } from '../types';
import { teamOf, type Seat } from '@engine/seating';

// Whether the viewer can see the identity of this round entry.
// Mirrors engine info.ts:viewerKnowsIdentity but extended to the
// in-progress round during the LINGER period (round-full but not yet
// resolved): the trumper privately learns every face-down identity,
// and any face-down trump triggers a public §T9 reveal that flips all
// face-down trumps for everyone.
const viewerKnowsEntry = (
  e: RoundEntry,
  viewer: Seat,
  rt: Runtime,
  roundFull: boolean,
): boolean => {
  if (!e.faceDown) return e.card !== null;
  if (e.revealed) return e.card !== null;
  if (e.seat === viewer) return e.card !== null;
  if (viewer === rt.trump.trumperSeat && roundFull) return true;
  if (roundFull && e.card !== null && suitOf(e.card) === rt.trump.trumpSuit) {
    const anyFaceDownTrump = rt.currentRound.some(
      x => x.faceDown && x.card !== null && suitOf(x.card) === rt.trump.trumpSuit,
    );
    if (anyFaceDownTrump) return true;
  }
  return false;
};

interface Props {
  runtime: Runtime;
  worlds: WorldsCount | null;
}

const SEAT_LABELS: Record<Seat, string> = {
  north: 'Partner',
  east: 'East',
  west: 'West',
  south: 'You',
};

// The four-petal flower. Position encodes provenance — north's card
// sits north, west's sits west — which is the whole of what soul §III.5
// asks for: "who played what within a trick" stays readable.
//
// Rotation is NOT part of that. Turning each card to its placer's
// orientation mimics a physical table, but at a physical table you can
// move your head; on a screen it just leaves half the trick upside
// down or sideways, and the trick is the thing the player is meant to
// be reading. All four sit upright.
const PETAL: Record<Seat, { row: 1 | 2 | 3; col: 1 | 2 | 3; rotate: number }> = {
  north: { row: 1, col: 2, rotate: 0 },
  west:  { row: 2, col: 1, rotate: 0 },
  south: { row: 3, col: 2, rotate: 0 },
  east:  { row: 2, col: 3, rotate: 0 },
};

const orderedSeats: Seat[] = ['north', 'west', 'south', 'east'];

// Role markers pinned to a seat. The trumper and the round's leader
// were previously discoverable only from a header chip and from
// watching who plays first — testing showed both got missed, and the
// generated puzzles make guessing actively wrong: the trumper is north
// about half the time, and south leads round 1 in roughly one puzzle
// in eight. Both facts are public at a real table, so showing them
// costs no deduction (soul §III.1) and their absence was just fog.
const SeatRoles = ({
  seat, trumperSeat, leaderSeat, trumpSuit, trumpKnown,
}: {
  seat: Seat;
  trumperSeat: Seat;
  leaderSeat: Seat;
  trumpSuit: string;
  trumpKnown: boolean;
}) => {
  const isTrumper = seat === trumperSeat;
  const isLeader = seat === leaderSeat;
  if (!isTrumper && !isLeader) return null;
  return (
    <span className="dle-seat-roles">
      {isTrumper && (
        <span className="dle-role dle-role-trumper" title="Trumper — won the bid and set trump">
          {trumpKnown ? SUIT_SYMBOLS[trumpSuit as 's'] : '?'}
        </span>
      )}
      {isLeader && (
        <span className="dle-role dle-role-leader" title="Leads this round">↻</span>
      )}
    </span>
  );
};

export const Table = ({ runtime, worlds }: Props) => {
  const turn = whoseTurn(runtime);
  const counts = {
    north: runtime.hands.north.length,
    west: runtime.hands.west.length,
    east: runtime.hands.east.length,
  };
  const inProgress = runtime.currentRound;
  const findEntry = (seat: Seat) => inProgress.find(e => e.seat === seat);
  const roundFull = inProgress.length === turnOrder(runtime).length;
  const viewer: Seat = 'south';
  const isViewerTrumper = viewer === runtime.trump.trumperSeat;
  const trumpModeLabel = runtime.trump.isOpen ? 'Open' : 'Closed';
  const trumperLabel = isViewerTrumper
    ? 'You'
    : SEAT_LABELS[runtime.trump.trumperSeat];

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
          title={
            isViewerTrumper
              ? `You are the trumper. ${trumpModeLabel} trump. ${runtime.trump.isOpen ? 'Suit shown.' : 'Folded face-down on the table; revealed when a face-down trump is played.'}`
              : `${trumperLabel} is the trumper. ${trumpModeLabel} trump.`
          }
        >
          {/* Name the trumper explicitly. The generator rotates the
              caps-obligated seat into south, so the trumper is NOT
              reliably you — it is north in roughly half the puzzles.
              "Your Trump" was a coin-flip lie. */}
          <span className="dle-trump-suit" aria-hidden>
            {runtime.trump.isRevealed || isViewerTrumper
              ? SUIT_SYMBOLS[runtime.trump.trumpSuit]
              : '?'}
          </span>
          <span className="dle-trump-who">
            {trumperLabel === 'You' ? 'you trump' : `${trumperLabel} trumps`}
          </span>
        </motion.span>
        {/* No points readout. Caps is "do I win every REMAINING
            round" — the running total is irrelevant to that question,
            and showing it hands over an aggregate the player didn't
            compute (soul §VI.4). It also leaked the construction: every
            puzzle is a sweep, so E/W was permanently 0. */}
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
          <div className="dle-seat-label">
            {SEAT_LABELS.north}
            <SeatRoles
              seat="north"
              trumperSeat={runtime.trump.trumperSeat}
              leaderSeat={runtime.priority}
              trumpSuit={runtime.trump.trumpSuit}
              trumpKnown={runtime.trump.isRevealed || isViewerTrumper}
            />
          </div>
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
          <div className="dle-seat-label">
            {SEAT_LABELS.west}
            <SeatRoles
              seat="west"
              trumperSeat={runtime.trump.trumperSeat}
              leaderSeat={runtime.priority}
              trumpSuit={runtime.trump.trumpSuit}
              trumpKnown={runtime.trump.isRevealed || isViewerTrumper}
            />
          </div>
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
          <div className="dle-seat-label">
            {SEAT_LABELS.east}
            <SeatRoles
              seat="east"
              trumperSeat={runtime.trump.trumperSeat}
              leaderSeat={runtime.priority}
              trumpSuit={runtime.trump.trumpSuit}
              trumpKnown={runtime.trump.isRevealed || isViewerTrumper}
            />
          </div>
        </motion.div>

        {/* South — you. No card fan (your hand is below the felt), but
            the seat must exist on the table: with only three seats
            drawn, your own role at the table had nowhere to be shown. */}
        <div
          className={`dle-seat dle-seat-south${turn === 'south' ? ' dle-seat-active' : ''}`}
        >
          <div className="dle-seat-label">
            {SEAT_LABELS.south}
            <SeatRoles
              seat="south"
              trumperSeat={runtime.trump.trumperSeat}
              leaderSeat={runtime.priority}
              trumpSuit={runtime.trump.trumpSuit}
              trumpKnown={runtime.trump.isRevealed || isViewerTrumper}
            />
          </div>
        </div>

        {/* Centre — 4-petal flower */}
        <div className="dle-flower">
          {/* Folded trump card on the table (closed-trump pre-reveal),
              visible as a face-down card pinned to centre. Only the
              trumper-viewer can see its identity; others see a back. */}
          {!runtime.trump.trumpCardInHand && runtime.trump.trumpCard !== null && (
            <div
              className="dle-petal dle-petal-folded-trump"
              style={{ gridRow: 2, gridColumn: 2 }}
              title={
                isViewerTrumper
                  ? `Folded trump card (you committed ${runtime.trump.trumpCard})`
                  : 'The trump card sits face-down on the table.'
              }
            >
              {isViewerTrumper
                ? <CardView card={runtime.trump.trumpCard} small />
                : <CardBack small />}
            </div>
          )}
          <AnimatePresence>
            {orderedSeats.map(seat => {
              const e = findEntry(seat);
              if (!e?.card) return null;
              const showFaceUp = viewerKnowsEntry(e, viewer, runtime, roundFull);
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
                  {showFaceUp
                    ? <CardView card={e.card} small />
                    : <CardBack small />}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <PublicInfo worlds={worlds} />
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
