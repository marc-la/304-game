// Share grid generator. Wordle-style emoji grid that conveys pacing
// and outcome without revealing the deal.

import type { CapsVerdictKind } from './scoring';

export interface ShareInputs {
  date: string;
  difficulty: 'monday' | 'wednesday' | 'friday' | 'sunday';
  verdict: CapsVerdictKind;
  score: number;
  callRound: number | null;
  orderLength: number | null;
  worldsAtCall: 'many' | 'some' | 'few' | 'one' | null;
}

const DIFFICULTY_LABEL: Record<ShareInputs['difficulty'], string> = {
  monday: 'Mon',
  wednesday: 'Wed',
  friday: 'Fri',
  sunday: 'Sun',
};

const VERDICT_TAG: Record<CapsVerdictKind, string> = {
  correct: 'Caps',
  late: 'Late',
  'wrong-bad-order': 'Wrong',
  'wrong-not-obligated': 'Early',
  missed: 'Missed',
};

const buildRoundsRow = (callRound: number | null): string => {
  const filled = callRound ?? 8;
  let s = '';
  for (let r = 1; r <= 8; r++) s += r <= filled ? '🟦' : '⬜';
  return s;
};

const buildOrderRow = (orderLength: number | null): string => {
  if (orderLength === null) return '';
  let s = '';
  for (let i = 0; i < orderLength; i++) s += '🃏';
  return s;
};

const buildSweepRow = (
  verdict: CapsVerdictKind,
  orderLength: number | null,
): string => {
  if (orderLength === null) return '';
  const ok = verdict === 'correct';
  const partial = verdict === 'late';
  const fillSize = orderLength;
  let s = '';
  for (let i = 0; i < fillSize; i++) {
    if (ok) s += '🟩';
    else if (partial) s += '🟨';
    else s += '🟥';
  }
  return s;
};

export const buildShareGrid = (inp: ShareInputs): string => {
  const lines: string[] = [];
  lines.push(
    `304dle · ${inp.date} (${DIFFICULTY_LABEL[inp.difficulty]}) · ${VERDICT_TAG[inp.verdict]}` +
    (inp.callRound !== null ? ` · R${inp.callRound}` : '') +
    ` · ${inp.score}/100`,
  );
  lines.push('');
  lines.push(buildRoundsRow(inp.callRound));
  const orderRow = buildOrderRow(inp.orderLength);
  if (orderRow) lines.push(orderRow);
  const sweepRow = buildSweepRow(inp.verdict, inp.orderLength);
  if (sweepRow) lines.push(sweepRow);
  return lines.join('\n');
};
