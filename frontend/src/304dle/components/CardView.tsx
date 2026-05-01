import type { CardId } from '../engine/card';
import { rankOf, suitOf } from '../engine/card';
import { SUIT_SYMBOLS } from '../../types/game';

interface Props {
  card: CardId;
  faded?: boolean;
  selectable?: boolean;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
}

export const CardView = ({ card, faded, selectable, selected, small, onClick }: Props) => {
  const rank = rankOf(card);
  const suit = suitOf(card);
  const isRed = suit === 'h' || suit === 'd';
  const cls = [
    'dle-card',
    isRed ? 'dle-card-red' : 'dle-card-black',
    faded ? 'dle-card-faded' : '',
    selectable ? 'dle-card-selectable' : '',
    selected ? 'dle-card-selected' : '',
    small ? 'dle-card-small' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={!selectable && !onClick}
      aria-label={`${rank} of ${suit}`}
    >
      <span className="dle-card-rank">{rank}</span>
      <span className="dle-card-suit">{SUIT_SYMBOLS[suit]}</span>
    </button>
  );
};

export const CardBack = ({ small }: { small?: boolean }) => (
  <div className={`dle-card dle-card-back${small ? ' dle-card-small' : ''}`}>
    <span aria-hidden="true">𝟑𝟎𝟒</span>
  </div>
);
