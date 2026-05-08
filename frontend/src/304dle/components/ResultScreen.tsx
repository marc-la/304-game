import { useState } from 'react';
import type { DailyPuzzle } from '../types';
import type { CapsDifficulty, CapsVerdictKind } from '../scoring';
import { buildShareGrid } from '../share';

interface Props {
  puzzle: DailyPuzzle;
  verdict: CapsVerdictKind;
  callRound: number | null;
  obligatedAtRound: number | null;
  worldsAtCall: number | null;
  difficulty: CapsDifficulty | null;
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

const DIFFICULTY_LABEL: Record<CapsDifficulty, string> = {
  master: 'Master',
  competent: 'Competent',
  standard: 'Standard',
  trivial: 'Trivial',
};

const DIFFICULTY_BLURB: Record<CapsDifficulty, string> = {
  master: 'Many worlds still consistent — you read what others couldn\'t.',
  competent: 'A real read.',
  standard: 'Solid call.',
  trivial: 'Information had already collapsed — no real test, no streak credit.',
};

const verdictClass = (v: CapsVerdictKind): string => {
  if (v === 'correct') return 'dle-result-correct';
  if (v === 'late') return 'dle-result-late';
  return 'dle-result-fail';
};

const formatWorldsValue = (n: number): string => {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toExponential(1);
};

export const ResultScreen = (props: Props) => {
  const [copied, setCopied] = useState(false);
  const grid = buildShareGrid({
    date: props.puzzle.date,
    verdict: props.verdict,
    callRound: props.callRound,
    obligatedAtRound: props.obligatedAtRound,
    difficulty: props.difficulty,
    worldsAtCall: props.worldsAtCall,
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
    props.callRound !== null && props.obligatedAtRound !== null
      ? Math.max(0, props.callRound - props.obligatedAtRound)
      : null;

  return (
    <div className={`dle-result ${verdictClass(props.verdict)}`}>
      <h2 className="dle-result-title">{VERDICT_LABEL[props.verdict]}</h2>

      {props.difficulty && props.verdict === 'correct' && (
        <div className={`dle-result-difficulty dle-difficulty-${props.difficulty}`}>
          <span className="dle-difficulty-label">{DIFFICULTY_LABEL[props.difficulty]}</span>
          <span className="dle-difficulty-blurb">{DIFFICULTY_BLURB[props.difficulty]}</span>
        </div>
      )}

      <dl className="dle-result-stats">
        {props.callRound !== null && (
          <>
            <dt>Called at</dt><dd>R{props.callRound}</dd>
          </>
        )}
        {props.obligatedAtRound !== null && (
          <>
            <dt>Obligation arose</dt><dd>R{props.obligatedAtRound}</dd>
          </>
        )}
        {parDelta !== null && parDelta > 0 && (
          <>
            <dt>Late by</dt><dd>{parDelta} round{parDelta === 1 ? '' : 's'}</dd>
          </>
        )}
        {props.worldsAtCall !== null && (
          <>
            <dt>Worlds at call</dt><dd>{formatWorldsValue(props.worldsAtCall)}</dd>
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
