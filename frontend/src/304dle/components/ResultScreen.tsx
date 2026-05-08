import { useState } from 'react';
import type { DailyPuzzle } from '../types';
import type { CapsVerdictKind } from '../scoring';
import { buildShareGrid } from '../share';

interface Props {
  puzzle: DailyPuzzle;
  verdict: CapsVerdictKind;
  callRound: number | null;
  parRound: number | null;
  orderLength: number | null;
  streakCurrent: number;
  streakLongest: number;
  onReplay?: () => void;
}

const VERDICT_LABEL: Record<CapsVerdictKind, string> = {
  correct: 'Caps',
  late: 'Late Caps',
  'wrong-not-obligated': 'Called too early',
  missed: 'Caps was missed',
};

// Soul §VI.4: verdict-first. The numeric 0-100 is gone. The only
// secondary signal is the par-delta — how many rounds late you
// called vs the earliest possible moment — surfaced as descriptive
// text, not as a penalty.
const verdictClass = (v: CapsVerdictKind): string => {
  if (v === 'correct') return 'dle-result-correct';
  if (v === 'late') return 'dle-result-late';
  return 'dle-result-fail';
};

export const ResultScreen = (props: Props) => {
  const [copied, setCopied] = useState(false);
  const grid = buildShareGrid({
    date: props.puzzle.date,
    verdict: props.verdict,
    callRound: props.callRound,
    parRound: props.parRound,
    orderLength: props.orderLength,
  });
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(grid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const parDelta =
    props.callRound !== null && props.parRound !== null
      ? Math.max(0, props.callRound - props.parRound)
      : null;

  return (
    <div className={`dle-result ${verdictClass(props.verdict)}`}>
      <h2 className="dle-result-title">{VERDICT_LABEL[props.verdict]}</h2>

      <dl className="dle-result-stats">
        {props.callRound !== null && (
          <>
            <dt>Called at</dt><dd>R{props.callRound}</dd>
          </>
        )}
        {props.parRound !== null && (
          <>
            <dt>Par</dt><dd>R{props.parRound}</dd>
          </>
        )}
        {parDelta !== null && parDelta > 0 && (
          <>
            <dt>Late by</dt><dd>{parDelta} round{parDelta === 1 ? '' : 's'}</dd>
          </>
        )}
        <dt>Streak</dt><dd>{props.streakCurrent} (best {props.streakLongest})</dd>
      </dl>

      <pre className="dle-share-grid">{grid}</pre>
      <div className="dle-result-actions">
        <button type="button" className="dle-btn dle-btn-primary" onClick={handleShare}>
          {copied ? 'Copied!' : 'Copy share grid'}
        </button>
        {props.onReplay && props.verdict !== 'correct' && (
          <button
            type="button"
            className="dle-btn dle-btn-secondary"
            onClick={props.onReplay}
            title="Replay this same hand. Today's verdict and streak are already recorded — this is for scrutiny."
          >
            Replay this hand
          </button>
        )}
      </div>
      {props.verdict !== 'correct' && props.onReplay && (
        <p className="dle-result-replay-note">
          Replay won't change today's verdict — only your reading of it.
        </p>
      )}
      <p className="dle-result-tomorrow">Come back tomorrow for a new puzzle.</p>
    </div>
  );
};
