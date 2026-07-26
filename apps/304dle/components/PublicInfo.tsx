import type { WorldsCount } from '../worlds-counter';
import { formatWorlds } from '../worlds-counter';

interface Props {
  worlds: WorldsCount | null;
}

// The deduction ticker: how many deals of the unseen cards are still
// consistent with everything you have watched.
//
// It was labelled "Worlds" in a bordered pill at hand-size — a term
// out of the formalism that means nothing at the table, styled as if
// it were the score. Now: "deals left", set small and mono in the
// felt's bottom-right, reading as instrumentation rather than as the
// thing you are playing for.
//
// Soul §VI.2 calls this "the visible spine of the puzzle", so it is
// demoted but never hidden. Two states only — ambient, and a single
// tightening below ~1000 — because five colour bands on a 12px element
// is noise, and a per-play delta is a tell the player didn't earn.
const isTight = (w: WorldsCount | null): boolean => {
  if (w === null) return false;
  if (w.exact !== null) return w.exact > 0 && w.exact <= 1000;
  return w.estimate > 0n && w.estimate <= 1000n;
};

export const PublicInfo = ({ worlds }: Props) => (
  <div className={`dle-ticker${isTight(worlds) ? ' dle-ticker-tight' : ''}`}>
    <span className="dle-ticker-count">{worlds ? formatWorlds(worlds) : '—'}</span>
    <span className="dle-ticker-label">deals left</span>
  </div>
);
