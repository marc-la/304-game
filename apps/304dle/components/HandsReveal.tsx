import type { CardId } from '@engine/card';
import { powerOf, suitOf } from '@engine/card';
import type { Seat } from '@engine/seating';
import { CardView } from './CardView';

// The post-mortem. Everyone's remaining cards at the moment you
// called, laid out in seat order so you can see the position you were
// actually reading — which card you failed to account for, whose void
// you missed, where the trick you couldn't have won was sitting.
//
// This is licensed teaching: soul §VI.5.2 forbids hints *during* play,
// but §IV.4 makes post-hand scrutiny — the "what were you thinking?!"
// — a core ritual of the game. It is also the honest answer to a
// wrong call, which otherwise just asserts that you were wrong.

interface Props {
  hands: Record<Seat, CardId[]>;
  trumpSuit: string;
  trumperSeat: Seat;
  title: string;
  caption?: string;
}

const SEAT_LABELS: Record<Seat, string> = {
  north: 'Partner',
  west: 'West',
  east: 'East',
  south: 'You',
};

// Same ordering as the player's own hand, so the two read alike.
const SUIT_ORDER: ReadonlyArray<'h' | 'd' | 'c' | 's'> = ['s', 'h', 'c', 'd'];

const sorted = (hand: ReadonlyArray<CardId>): CardId[] =>
  [...hand].sort((a, b) => {
    const sa = suitOf(a);
    const sb = suitOf(b);
    if (sa !== sb) return SUIT_ORDER.indexOf(sa) - SUIT_ORDER.indexOf(sb);
    return powerOf(a) - powerOf(b);
  });

// Opposition first: they are the reason a caps call fails.
const ROWS: Seat[] = ['west', 'east', 'north', 'south'];

export const HandsReveal = ({
  hands, trumpSuit, trumperSeat, title, caption,
}: Props) => {
  if (ROWS.every(s => hands[s].length === 0)) return null;
  return (
    <div className="dle-hands-reveal">
      <h3 className="dle-hands-reveal-title">{title}</h3>
      {caption && <p className="dle-hands-caption">{caption}</p>}
      {ROWS.map(seat => (
        <div
          key={seat}
          className={`dle-hands-row${seat === 'south' ? ' dle-hands-row-you' : ''}`}
        >
          <span className="dle-hands-seat">
            {SEAT_LABELS[seat]}
            {seat === trumperSeat && (
              <span className="dle-hands-trumper" title="Trumper">◆</span>
            )}
          </span>
          <span className="dle-hands-cards">
            {sorted(hands[seat]).map(c => (
              <CardView
                key={c}
                card={c}
                small
                isTrumpCard={suitOf(c) === trumpSuit}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
};
