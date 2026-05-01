import type { Runtime } from '../runtime';
import { whoseTurn } from '../runtime';
import { CardBack, CardView } from './CardView';
import { SUIT_SYMBOLS } from '../../types/game';

interface Props {
  runtime: Runtime;
}

const SEAT_LABELS = {
  north: 'North · Partner',
  east: 'East',
  west: 'West',
  south: 'South · You',
} as const;

export const Table = ({ runtime }: Props) => {
  const turn = whoseTurn(runtime);
  const counts = {
    north: runtime.hands.north.length,
    west: runtime.hands.west.length,
    east: runtime.hands.east.length,
  };
  const inProgress = runtime.currentRound;
  const findEntry = (seat: 'north' | 'west' | 'south' | 'east') =>
    inProgress.find(e => e.seat === seat);

  return (
    <div className="dle-table">
      <div className="dle-table-header">
        <span className="dle-trump-chip">
          Trump <span aria-hidden>{SUIT_SYMBOLS[runtime.trumpSuit]}</span>
        </span>
        <span className="dle-round-chip">Round {Math.min(runtime.roundNumber, 8)} / 8</span>
      </div>

      <div className={`dle-seat dle-seat-north${turn === 'north' ? ' dle-seat-active' : ''}`}>
        <div className="dle-seat-label">{SEAT_LABELS.north}</div>
        <div className="dle-seat-cards">
          {Array.from({ length: counts.north }).map((_, i) => (
            <CardBack small key={i} />
          ))}
        </div>
        {findEntry('north')?.card && (
          <div className="dle-seat-played">
            <CardView card={findEntry('north')!.card!} small />
          </div>
        )}
      </div>

      <div className={`dle-seat dle-seat-west${turn === 'west' ? ' dle-seat-active' : ''}`}>
        <div className="dle-seat-label">{SEAT_LABELS.west}</div>
        <div className="dle-seat-cards dle-seat-cards-side">
          {Array.from({ length: counts.west }).map((_, i) => (
            <CardBack small key={i} />
          ))}
        </div>
        {findEntry('west')?.card && (
          <div className="dle-seat-played">
            <CardView card={findEntry('west')!.card!} small />
          </div>
        )}
      </div>

      <div className={`dle-seat dle-seat-east${turn === 'east' ? ' dle-seat-active' : ''}`}>
        <div className="dle-seat-label">{SEAT_LABELS.east}</div>
        <div className="dle-seat-cards dle-seat-cards-side">
          {Array.from({ length: counts.east }).map((_, i) => (
            <CardBack small key={i} />
          ))}
        </div>
        {findEntry('east')?.card && (
          <div className="dle-seat-played">
            <CardView card={findEntry('east')!.card!} small />
          </div>
        )}
      </div>

      <div className="dle-table-center">
        <div className="dle-tricks">
          <span>You/N: <b>{runtime.pointsWon.team_a}</b></span>
          <span>E/W: <b>{runtime.pointsWon.team_b}</b></span>
        </div>
        {findEntry('south')?.card && (
          <div className="dle-seat-played dle-played-south">
            <CardView card={findEntry('south')!.card!} small />
          </div>
        )}
      </div>
    </div>
  );
};
