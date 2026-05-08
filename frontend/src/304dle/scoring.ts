// Verdict + difficulty model for one 304dle session.
//
// Soul-aligned scoring (post-rules-rewrite, post-incentive-fix):
//   - The verdict is the binary outcome (correct / late / wrong /
//     missed). This is the primary signal.
//   - The difficulty is the *quality* signal — derived from the
//     count of consistent worlds at the moment of call. A master
//     call is one made when many worlds remain; a trivial call is
//     one where deduction has already collapsed to single digits.
//   - The dynamic par is the actual round in which obligation
//     first arose during this play (runtime.capsObligations
//     stamp). The static optimalCallRound from puzzle metadata is
//     no longer a scoring input — it stays as a curator hint only.
//
// Streak: only correct + non-trivial caps extend the streak.
// Trivial caps (worlds-at-call ≤ 10) register the verdict but
// don't compound — discouraging the dump-and-lock-caps exploit.

export type CapsVerdictKind =
  | 'correct'
  | 'late'
  | 'wrong-not-obligated'
  | 'missed';

export type CapsDifficulty = 'master' | 'competent' | 'standard' | 'trivial';

export interface VerdictInputs {
  verdict: CapsVerdictKind;
  callRound: number | null;
  obligatedAtRound: number | null;
  worldsAtCall: number | null;
}

export interface Verdict {
  kind: CapsVerdictKind;
  callRound: number | null;
  obligatedAtRound: number | null;
  parDelta: number | null;       // rounds called past the dynamic par
  worldsAtCall: number | null;
  difficulty: CapsDifficulty | null;
  extendsStreak: boolean;
}

export const gradeDifficulty = (worldsAtCall: number): CapsDifficulty => {
  if (worldsAtCall > 1000) return 'master';
  if (worldsAtCall > 100) return 'competent';
  if (worldsAtCall > 10) return 'standard';
  return 'trivial';
};

export const buildVerdict = (inp: VerdictInputs): Verdict => {
  const parDelta =
    inp.callRound !== null && inp.obligatedAtRound !== null
      ? Math.max(0, inp.callRound - inp.obligatedAtRound)
      : null;
  const difficulty =
    inp.worldsAtCall !== null ? gradeDifficulty(inp.worldsAtCall) : null;
  // Streak: must be correct AND difficulty must be non-trivial.
  // Trivial caps (e.g. dump-and-wait exploits) don't compound.
  const extendsStreak =
    inp.verdict === 'correct' && difficulty !== null && difficulty !== 'trivial';
  return {
    kind: inp.verdict,
    callRound: inp.callRound,
    obligatedAtRound: inp.obligatedAtRound,
    parDelta,
    worldsAtCall: inp.worldsAtCall,
    difficulty,
    extendsStreak,
  };
};
