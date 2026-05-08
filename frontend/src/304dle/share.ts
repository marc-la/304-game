// Share grid. Verdict-first; no numeric score.

import type { CapsVerdictKind } from './scoring';

export interface ShareInputs {
  date: string;
  verdict: CapsVerdictKind;
  callRound: number | null;
  parRound: number | null;
  orderLength: number | null;
}

const VERDICT_TAG: Record<CapsVerdictKind, string> = {
  correct: 'Caps',
  late: 'Late',
  'wrong-not-obligated': 'Early',
  missed: 'Missed',
};

const buildRoundsRow = (callRound: number | null): string => {
  const filled = callRound ?? 8;
  let s = '';
  for (let r = 1; r <= 8; r++) s += r <= filled ? '🟦' : '⬜';
  return s;
};

const buildSweepRow = (
  verdict: CapsVerdictKind,
  orderLength: number | null,
): string => {
  if (orderLength === null) return '';
  const ok = verdict === 'correct';
  const partial = verdict === 'late';
  let s = '';
  for (let i = 0; i < orderLength; i++) {
    if (ok) s += '🟩';
    else if (partial) s += '🟨';
    else s += '🟥';
  }
  return s;
};

export const buildShareGrid = (inp: ShareInputs): string => {
  const lines: string[] = [];
  const callTag = inp.callRound !== null ? ` · R${inp.callRound}` : '';
  const parTag =
    inp.parRound !== null && inp.callRound !== null && inp.callRound > inp.parRound
      ? ` (par R${inp.parRound})`
      : '';
  lines.push(
    `304dle · ${inp.date} · ${VERDICT_TAG[inp.verdict]}${callTag}${parTag}`,
  );
  lines.push('');
  lines.push(buildRoundsRow(inp.callRound));
  const sweep = buildSweepRow(inp.verdict, inp.orderLength);
  if (sweep) lines.push(sweep);
  return lines.join('\n');
};
