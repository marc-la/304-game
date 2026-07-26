import type { CardId } from '@engine/card';
import type { Seat } from '@engine/seating';
import type { ScriptedPuzzle } from '../types';
import type { CapsVerdictKind } from '../scoring';
import { HandsReveal } from './HandsReveal';

// Deliberately spare. The previous version carried an emoji share
// grid, a difficulty badge with a blurb, and a five-row definition
// list (called-at / obligation-arose / late-by / worlds-at-call /
// streak). None of it was readable at a glance and most of it was
// scoring machinery leaking into the player's face.
//
// What survives is the three things that answer "what happened":
// the verdict, one sentence of why, and the position you were
// actually reading when you called.

interface Props {
  puzzle: ScriptedPuzzle;
  date: string;
  verdict: CapsVerdictKind;
  callRound: number | null;
  obligatedAtRound: number | null;
  handsAtCall: Record<Seat, CardId[]> | null;
  streakCurrent: number;
  onReplay?: () => void;
}

const VERDICT_LABEL: Record<CapsVerdictKind, string> = {
  correct: 'Caps',
  late: 'Late',
  'wrong-not-obligated': 'Too early',
  missed: 'Missed',
};

const verdictClass = (v: CapsVerdictKind): string => {
  if (v === 'correct') return 'dle-result-correct';
  if (v === 'late') return 'dle-result-late';
  return 'dle-result-fail';
};

// One sentence. Says what happened in the game's own terms, without
// reciting numbers the player has to reassemble into a story.
const explain = (
  verdict: CapsVerdictKind,
  callRound: number | null,
  par: number | null,
): string => {
  if (verdict === 'correct') {
    return 'Every remaining round was yours, and you saw it.';
  }
  if (verdict === 'late') {
    if (par !== null && callRound !== null && callRound > par) {
      const n = callRound - par;
      return `It was already yours at round ${par}. You played on for ${n} more round${n === 1 ? '' : 's'} before calling.`;
    }
    return 'It was already yours before you called — you played on past the moment.';
  }
  if (verdict === 'missed') {
    return par !== null
      ? `Caps was on the table from round ${par}. You never called it.`
      : 'Caps was on the table. You never called it.';
  }
  return 'Not yet yours — the opposition could still legally take a round.';
};

export const ResultScreen = (props: Props) => (
  <div className={`dle-result ${verdictClass(props.verdict)}`}>
    <h2 className="dle-result-title">{VERDICT_LABEL[props.verdict]}</h2>
    <p className="dle-result-line">
      {explain(props.verdict, props.callRound, props.obligatedAtRound)}
    </p>

    {props.handsAtCall && (
      <HandsReveal
        hands={props.handsAtCall}
        trumpSuit={props.puzzle.trump.suit}
        trumperSeat={props.puzzle.trump.trumper}
      />
    )}

    <div className="dle-result-actions">
      {props.onReplay && (
        <button
          type="button"
          className="dle-btn dle-btn-secondary"
          onClick={props.onReplay}
        >
          Play it again
        </button>
      )}
    </div>

    <p className="dle-result-tomorrow">
      {props.streakCurrent > 0 && (
        <span className="dle-result-streak">{props.streakCurrent} day streak · </span>
      )}
      New hand tomorrow.
    </p>
  </div>
);
