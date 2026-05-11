import type { WorldsCount } from '../worlds-counter';
import { formatWorlds } from '../worlds-counter';

interface Props {
  worlds: WorldsCount | null;
}

// Soul §IV.7: the worlds counter is the visible spine. Always
// shown, never paywalled. Voids are deliberately NOT displayed —
// the player should remember.
const intensityClass = (w: WorldsCount | null): string => {
  if (w === null) return 'dle-worlds-idle';
  // Use exact count when available; else fall back to estimate.
  const measure = w.exact ?? Number(w.estimate > 1_000_000n ? 1_000_000n : w.estimate);
  if (measure === 0) return 'dle-worlds-idle';
  if (measure > 100) return 'dle-worlds-cool';
  if (measure > 10) return 'dle-worlds-warm';
  if (measure > 1) return 'dle-worlds-hot';
  return 'dle-worlds-converged';
};

export const PublicInfo = ({ worlds }: Props) => (
  <div className="dle-public">
    <div className={`dle-worlds ${intensityClass(worlds)}`}>
      <span className="dle-worlds-label">Worlds</span>
      <span className="dle-worlds-count">
        {worlds ? formatWorlds(worlds) : '…'}
      </span>
    </div>
  </div>
);
