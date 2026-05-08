// Verdict model for one 304dle session.
//
// Soul §VI.4: 304dle is verdict-first, not score-first. The 0-100
// numeric model was a Wordle vestige that diluted the binary purity
// of "called caps right or you didn't". The single optional metric
// is `parDelta` — how many rounds late you called vs the earliest
// possible moment — which functions as the "elegance" signal.

export type CapsVerdictKind =
  | 'correct'             // adaptive winning strategy exists; called on time
  | 'late'                // strategy exists but caller passed the obligation moment
  | 'wrong-not-obligated' // no adaptive strategy at this state — opps can still take a trick
  | 'missed';             // game ended without a call (curated puzzles always have a witness)

export interface VerdictInputs {
  verdict: CapsVerdictKind;
  callRound: number | null;
  parRound: number | null;
}

export interface Verdict {
  kind: CapsVerdictKind;
  callRound: number | null;
  parRound: number | null;
  parDelta: number | null;     // rounds called past par; null if not applicable
  extendsStreak: boolean;       // 'correct' only — late/wrong/missed reset
}

export const buildVerdict = (inp: VerdictInputs): Verdict => {
  const parDelta =
    inp.callRound !== null && inp.parRound !== null
      ? Math.max(0, inp.callRound - inp.parRound)
      : null;
  return {
    kind: inp.verdict,
    callRound: inp.callRound,
    parRound: inp.parRound,
    parDelta,
    extendsStreak: inp.verdict === 'correct',
  };
};
