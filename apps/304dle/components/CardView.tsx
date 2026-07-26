import type { CardId } from '@engine/card';
import { rankOf, suitOf } from '@engine/card';
import { SUIT_SYMBOLS } from '../types';

interface Props {
  card: CardId;
  faded?: boolean;
  selectable?: boolean;
  selected?: boolean;
  small?: boolean;
  // Any card of the trump suit.
  isTrumpCard?: boolean;
  // The specific card the trumper bid on. A stronger marker, and only
  // ever one of them.
  isBidCard?: boolean;
  onClick?: () => void;
}

export const CardView = ({
  card, faded, selectable, selected, small, isTrumpCard, isBidCard, onClick,
}: Props) => {
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
    isTrumpCard ? 'dle-card-trump' : '',
    isBidCard ? 'dle-card-bid' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={!selectable && !onClick}
      aria-label={`${rank} of ${suit}${isTrumpCard ? ' — trump' : ''}${isBidCard ? ', the bid card' : ''}`}
    >
      <span className="dle-card-rank">{rank}</span>
      <span className="dle-card-suit">{SUIT_SYMBOLS[suit]}</span>
      {isTrumpCard && <span className="dle-card-trump-pip" aria-hidden />}
    </button>
  );
};

// The back carries the game's own identity rather than a generic
// gradient: the site's mono face (the "whiteboard notation" register
// of soul §II), a ruled border like a scoring sheet, and a lattice of
// the four suits. The 𝟑𝟎𝟒 mathematical-bold glyphs are dropped — they
// render inconsistently across platforms and sit outside the site's
// type system.
export const CardBack = ({ small }: { small?: boolean }) => (
  <div className={`dle-card dle-card-back${small ? ' dle-card-small' : ''}`}>
    <span className="dle-card-back-rule" aria-hidden="true" />
    <span className="dle-card-back-mark" aria-hidden="true">304</span>
  </div>
);
