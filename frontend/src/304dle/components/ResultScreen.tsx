import { useState } from 'react';
import type { DailyPuzzle } from '../types';
import type { CapsVerdictKind } from '../scoring';
import { buildShareGrid } from '../share';

interface Props {
  puzzle: DailyPuzzle;
  score: number;
  verdict: CapsVerdictKind;
  callRound: number | null;
  orderLength: number | null;
  hintsUsed: number;
  worldsToggleUses: number;
  streakCurrent: number;
  streakLongest: number;
}

const VERDICT_LABEL: Record<CapsVerdictKind, string> = {
  correct: 'Caps called correctly',
  late: 'Late caps — credit, but not on time',
  'wrong-bad-order': 'Order broke in some world',
  'wrong-not-obligated': 'Called too early',
  missed: 'Caps was missed',
};

export const ResultScreen = (props: Props) => {
  const [copied, setCopied] = useState(false);
  const grid = buildShareGrid({
    date: props.puzzle.date,
    difficulty: props.puzzle.difficulty,
    verdict: props.verdict,
    score: props.score,
    callRound: props.callRound,
    orderLength: props.orderLength,
    worldsAtCall: null,
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
  return (
    <div className="dle-result">
      <h2 className="dle-result-title">{VERDICT_LABEL[props.verdict]}</h2>
      <div className="dle-result-score">{props.score}<span> / 100</span></div>

      <dl className="dle-result-stats">
        {props.callRound !== null && (
          <>
            <dt>Called at</dt><dd>Round {props.callRound}</dd>
          </>
        )}
        {props.puzzle.classification.optimalCallRound !== null && (
          <>
            <dt>Par</dt><dd>Round {props.puzzle.classification.optimalCallRound}</dd>
          </>
        )}
        <dt>Hints used</dt><dd>{props.hintsUsed}</dd>
        <dt>Worlds peeks</dt><dd>{props.worldsToggleUses}</dd>
        <dt>Current streak</dt><dd>{props.streakCurrent}</dd>
        <dt>Longest streak</dt><dd>{props.streakLongest}</dd>
      </dl>

      <pre className="dle-share-grid">{grid}</pre>
      <div className="dle-result-actions">
        <button type="button" className="dle-btn dle-btn-primary" onClick={handleShare}>
          {copied ? 'Copied!' : 'Copy share grid'}
        </button>
      </div>
      <p className="dle-result-tomorrow">Come back tomorrow for a new puzzle.</p>
    </div>
  );
};
