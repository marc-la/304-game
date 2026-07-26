// Share grid. Verdict + difficulty; no numeric score.

import type { CapsDifficulty, CapsVerdictKind } from './scoring';

// `obligatedAtRound` is deliberately NOT a field here. Making the par
// round unavailable to this module is what stops it leaking back into
// the grid the next time someone edits it.
export interface ShareInputs {
  date: string;
  verdict: CapsVerdictKind;
  callRound: number | null;
  difficulty: CapsDifficulty | null;
  worldsAtCall: number | null;
}

const VERDICT_TAG: Record<CapsVerdictKind, string> = {
  correct: 'Caps',
  late: 'Late',
  'wrong-not-obligated': 'Early',
  missed: 'Missed',
};

const DIFFICULTY_TAG: Record<CapsDifficulty, string> = {
  master: 'Master',
  competent: 'Competent',
  standard: 'Standard',
  trivial: 'Trivial',
};

const buildRoundsRow = (callRound: number | null): string => {
  const filled = callRound ?? 8;
  let s = '';
  for (let r = 1; r <= 8; r++) s += r <= filled ? '🟦' : '⬜';
  return s;
};

const verdictGlyph = (verdict: CapsVerdictKind, difficulty: CapsDifficulty | null): string => {
  if (verdict === 'correct') {
    if (difficulty === 'master') return '🟩🟩🟩';
    if (difficulty === 'competent') return '🟩🟩';
    if (difficulty === 'standard') return '🟩';
    return '⬛'; // trivial — non-streak-extending
  }
  if (verdict === 'late') return '🟨';
  return '🟥';
};

export const buildShareGrid = (inp: ShareInputs): string => {
  const lines: string[] = [];
  const callTag = inp.callRound !== null ? ` · R${inp.callRound}` : '';
  // NEVER emit the par round. Everyone plays the same puzzle, so
  // `(par R5)` in a shared result hands the day's answer to anyone who
  // hasn't played yet. Your own call round is fine — it's your score,
  // and it is not the answer unless you were correct, in which case the
  // verdict tag already said so.
  const diffTag = inp.difficulty ? ` · ${DIFFICULTY_TAG[inp.difficulty]}` : '';
  lines.push(
    `304dle · ${inp.date} · ${VERDICT_TAG[inp.verdict]}${callTag}${diffTag}`,
  );
  lines.push('');
  lines.push(buildRoundsRow(inp.callRound));
  lines.push(verdictGlyph(inp.verdict, inp.difficulty));
  return lines.join('\n');
};
