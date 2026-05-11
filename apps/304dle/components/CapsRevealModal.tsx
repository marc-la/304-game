import { useEffect, useState } from 'react';
import type { CardId } from '@engine/card';
import type { CapsVerdictKind } from '../scoring';
import { CardView } from './CardView';

interface Props {
  verdict: CapsVerdictKind;
  witnessLine: CardId[] | null;
  onDone: () => void;
}

const VERDICT_TITLE: Record<CapsVerdictKind, string> = {
  correct: 'Caps!',
  late: 'Late Caps',
  'wrong-not-obligated': 'Wrong call',
  missed: 'Missed',
};

const VERDICT_BLURB: Record<CapsVerdictKind, string> = {
  correct: 'Adaptive winning strategy in every consistent world. Engine demonstration line:',
  late: 'You had a winning strategy — but the moment had passed. You played a card after the obligation arose.',
  'wrong-not-obligated': "No adaptive strategy here yet — opponents could legally still take a trick.",
  missed: "Caps was on the table; you didn't claim it.",
};

export const CapsRevealModal = ({ verdict, witnessLine, onDone }: Props) => {
  const order = witnessLine ?? [];
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

        {order.length > 0 && (
          <div className="dle-reveal-order">
            {order.map((c, i) => (
              <div
                key={`${c}:${i}`}
                className={`dle-reveal-card${i < revealed ? ' dle-reveal-card-shown' : ''}`}
              >
                <span className="dle-reveal-num">R{i + 1}</span>
                <CardView card={c} small />
              </div>
            ))}
          </div>
        )}

        {order.length > 0 && (
          <p className="dle-reveal-foot">
            One demonstration line — your strategy could adapt to opp plays.
          </p>
        )}

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
