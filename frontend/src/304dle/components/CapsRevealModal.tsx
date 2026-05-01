import { useEffect, useState } from 'react';
import type { CardId } from '../engine/card';
import type { CapsVerdictKind } from '../scoring';
import { CardView } from './CardView';

interface Props {
  order: ReadonlyArray<CardId>;
  verdict: CapsVerdictKind;
  breakingHint: string | null;
  onDone: () => void;
}

const VERDICT_TITLE: Record<CapsVerdictKind, string> = {
  correct: 'Caps!',
  late: 'Late Caps',
  'wrong-bad-order': 'Caps fails',
  'wrong-not-obligated': 'Wrong call',
  missed: 'Missed',
};

const VERDICT_BLURB: Record<CapsVerdictKind, string> = {
  correct: 'Every world consistent with what you know — your order sweeps.',
  late: "Witnessed, but the moment had passed (you played a card after it became obligated).",
  'wrong-bad-order': 'Some world consistent with what you know breaks your witness order.',
  'wrong-not-obligated': "You weren't yet caps-obligated — opponents could legally still take a trick.",
  missed: "Caps was on the table; you didn't claim it.",
};

export const CapsRevealModal = ({ order, verdict, breakingHint, onDone }: Props) => {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (revealed >= order.length) return;
    const t = setTimeout(() => setRevealed(r => r + 1), 350);
    return () => clearTimeout(t);
  }, [revealed, order.length]);

  const verdictClass =
    verdict === 'correct' ? 'dle-reveal-correct' :
    verdict === 'late' ? 'dle-reveal-late' :
    'dle-reveal-fail';

  return (
    <div className="dle-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`dle-modal dle-reveal-modal ${verdictClass}`}>
        <h2>{VERDICT_TITLE[verdict]}</h2>
        <p className="dle-reveal-blurb">{VERDICT_BLURB[verdict]}</p>
        {breakingHint && (
          <p className="dle-reveal-hint">{breakingHint}</p>
        )}
        <div className="dle-reveal-order">
          {order.map((c, i) => (
            <div
              key={c}
              className={`dle-reveal-card${i < revealed ? ' dle-reveal-card-shown' : ''}`}
            >
              <span className="dle-reveal-num">R{i + 1}</span>
              <CardView card={c} small />
            </div>
          ))}
        </div>
        <div className="dle-modal-actions">
          <button
            type="button"
            className="dle-btn dle-btn-primary"
            onClick={onDone}
          >
            See result
          </button>
        </div>
      </div>
    </div>
  );
};
