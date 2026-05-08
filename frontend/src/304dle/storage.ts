// localStorage persistence for 304dle.
//
// Schema v3: DayResult tracks dynamic-par + worlds-at-call +
// difficulty (Phase 2-5 of the incentive-fix plan). The static
// optimalCallRound from puzzle metadata is no longer recorded.
// Streak: only correct + non-trivial caps extend it.

import type { CapsDifficulty, CapsVerdictKind } from './scoring';

const STORAGE_KEY = '304dle:state';
const SCHEMA_VERSION = 3;

export interface DayResult {
  date: string;
  verdict: CapsVerdictKind;
  callRound: number | null;
  obligatedAtRound: number | null;
  worldsAtCall: number | null;
  difficulty: CapsDifficulty | null;
}

export interface PersistedState {
  version: number;
  lastPlayedDate: string | null;
  todayResult: DayResult | null;
  history: DayResult[];
  streak: { current: number; longest: number; lastDate: string | null };
}

const DEFAULT: PersistedState = {
  version: SCHEMA_VERSION,
  lastPlayedDate: null,
  todayResult: null,
  history: [],
  streak: { current: 0, longest: 0, lastDate: null },
};

export const loadState = (): PersistedState => {
  if (typeof localStorage === 'undefined') return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== SCHEMA_VERSION) return { ...DEFAULT };
    return parsed;
  } catch {
    return { ...DEFAULT };
  }
};

export const saveState = (state: PersistedState): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
};

const consecutiveDays = (a: string, b: string): boolean => {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  const diff = (db.getTime() - da.getTime()) / 86_400_000;
  return diff === 1;
};

// Streak rule: only `correct` + non-trivial difficulty extends.
// Late, wrong, missed, and trivial-correct all reset to 0.
// Soul §IV.11 sting-of-loss + Phase 5 anti-exploit alignment.
export const recordResult = (
  prev: PersistedState,
  result: DayResult,
  extendsStreak: boolean,
): PersistedState => {
  const history = [...prev.history.filter(h => h.date !== result.date), result]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-60);
  let { current, longest, lastDate } = prev.streak;
  if (lastDate === result.date) {
    // re-record: leave streak alone
  } else if (!extendsStreak) {
    current = 0;
  } else if (lastDate === null) {
    current = 1;
  } else if (consecutiveDays(lastDate, result.date)) {
    current = current + 1;
  } else {
    current = 1;
  }
  if (current > longest) longest = current;
  lastDate = result.date;
  return {
    ...prev,
    lastPlayedDate: result.date,
    todayResult: result,
    history,
    streak: { current, longest, lastDate },
  };
};

export const isAlreadyPlayed = (state: PersistedState, today: string): boolean =>
  state.todayResult !== null && state.todayResult.date === today;
