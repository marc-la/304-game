import type { Suit } from '../engine/card';
import type { Seat } from '../engine/seating';
import { SEAT_NAMES, SUIT_SYMBOLS } from '../../types/game';

interface Props {
  voids: Map<Seat, Set<Suit>>;
  showWorlds: boolean;
  worldsBucket: 'many' | 'some' | 'few' | 'one' | null;
  onToggleWorlds: () => void;
}

const BUCKET_LABEL: Record<'many' | 'some' | 'few' | 'one', string> = {
  many: '▒▒▒▒',
  some: '▒▒▒░',
  few: '▒▒░░',
  one: '▒░░░',
};

export const PublicInfo = ({ voids, showWorlds, worldsBucket, onToggleWorlds }: Props) => {
  const chips: Array<{ seat: Seat; suit: Suit }> = [];
  for (const [seat, suits] of voids) {
    for (const suit of suits) chips.push({ seat, suit });
  }
  return (
    <div className="dle-public">
      <div className="dle-voids">
        {chips.length === 0 && (
          <span className="dle-voids-empty">No public voids yet</span>
        )}
        {chips.map(({ seat, suit }) => (
          <span key={`${seat}:${suit}`} className="dle-void-chip">
            {SEAT_NAMES[seat][0]} void <span aria-hidden>{SUIT_SYMBOLS[suit]}</span>
          </span>
        ))}
      </div>
      <div className="dle-worlds">
        <button
          type="button"
          className="dle-worlds-toggle"
          onClick={onToggleWorlds}
        >
          {showWorlds ? 'Hide worlds' : 'Show worlds (-5)'}
        </button>
        {showWorlds && worldsBucket && (
          <span className="dle-worlds-bucket" aria-label={`${worldsBucket} worlds remaining`}>
            {BUCKET_LABEL[worldsBucket]}
          </span>
        )}
      </div>
    </div>
  );
};
