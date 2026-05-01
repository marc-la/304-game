// Scoring formula for one 304dle session.

export type CapsVerdictKind =
  | 'correct'
  | 'late'
  | 'wrong-bad-order'
  | 'wrong-not-obligated'
  | 'missed';

export interface ScoreInputs {
  verdict: CapsVerdictKind;
  callRound: number | null;
  parRound: number | null;
  hintsUsed: number;
  worldsToggleUses: number;
}

export interface ScoreBreakdown {
  total: number;
  base: number;
  parPenalty: number;
  hintPenalty: number;
  worldsPenalty: number;
}

export const computeScore = (inputs: ScoreInputs): ScoreBreakdown => {
  let base = 0;
  let parPenalty = 0;
  switch (inputs.verdict) {
    case 'correct':
      base = 100;
      if (inputs.callRound !== null && inputs.parRound !== null) {
        const over = Math.max(0, inputs.callRound - inputs.parRound);
        parPenalty = over * 8;
      }
      break;
    case 'late':
      base = 40;
      break;
    case 'wrong-bad-order':
      base = 10;
      break;
    case 'wrong-not-obligated':
    case 'missed':
      base = 0;
      break;
  }
  const hintPenalty = inputs.hintsUsed * 1;
  const worldsPenalty = inputs.worldsToggleUses * 5;
  const total = Math.max(
    0,
    Math.min(100, base - parPenalty - hintPenalty - worldsPenalty),
  );
  return { total, base, parPenalty, hintPenalty, worldsPenalty };
};
