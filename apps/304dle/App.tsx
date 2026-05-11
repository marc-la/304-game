import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import type { CuratedPuzzleFile, DailyPuzzle, PuzzleFile } from './types';
import { Table } from './components/Table';
import { Hand } from './components/Hand';
import { PublicInfo } from './components/PublicInfo';
import { CapsConfirmModal } from './components/CapsConfirmModal';
import { CapsRevealModal } from './components/CapsRevealModal';
import { ResultScreen } from './components/ResultScreen';
import { Onboarding } from './components/Onboarding';
import { whoseTurn, turnOrder, isGameOver } from './runtime';
import type { Runtime } from './runtime';
import { selectPuzzleForDate } from './daily-selector';
import { countWorlds } from './worlds-counter';
import { buildVerdict } from './scoring';
import { ROUND_LINGER_MS, tempoForBotPlay } from './tempo';
import {
  isAlreadyPlayed,
  loadState,
  recordResult,
  saveState,
} from './storage';
import './app.css';

const todayDateString = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const loadDailyPuzzle = async (date: string): Promise<DailyPuzzle | null> => {
  try {
    const r = await fetch('./puzzles/curated.json');
    if (r.ok) {
      const file = (await r.json()) as CuratedPuzzleFile;
      const sel = selectPuzzleForDate(date, file.puzzles);
      if (sel) return { ...sel, date };
    }
  } catch {
    // fall through to year file
  }
  try {
    const year = date.slice(0, 4);
    const r = await fetch(`./puzzles/${year}.json`);
    if (!r.ok) return null;
    const file = (await r.json()) as PuzzleFile;
    return file.puzzles.find(p => p.date === date) ?? null;
  } catch {
    return null;
  }
};

const usePuzzleLoader = () => {
  const setPuzzle = useStore(s => s.setPuzzle);
  useEffect(() => {
    const today = todayDateString();
    loadDailyPuzzle(today).then(p => setPuzzle(p, today));
  }, [setPuzzle]);
};

export const App = () => {
  usePuzzleLoader();
  const state = useStore(s => s.state);
  const [persisted, setPersisted] = useState(loadState);
  const [showOnboarding, setShowOnboarding] = useState(
    () => persisted.history.length === 0 && persisted.todayResult === null,
  );

  if (state.kind === 'loading') {
    return <main className="dle-loading">Loading today's puzzle…</main>;
  }
  if (state.kind === 'no-puzzle') {
    return (
      <main className="dle-loading">
        <h1>No puzzle for {state.date}</h1>
        <p>Check back tomorrow.</p>
      </main>
    );
  }

  if (state.kind === 'intro') {
    const today = state.puzzle.date;
    if (isAlreadyPlayed(persisted, today) && persisted.todayResult) {
      const r = persisted.todayResult;
      return (
        <main className="dle-app">
          <ResultScreen
            puzzle={state.puzzle}
            verdict={r.verdict}
            callRound={r.callRound}
            obligatedAtRound={r.obligatedAtRound}
            worldsAtCall={r.worldsAtCall}
            difficulty={r.difficulty}
            streakCurrent={persisted.streak.current}
            streakLongest={persisted.streak.longest}
            onReplay={() => useStore.getState().replayHand()}
          />
        </main>
      );
    }
    return (
      <main className="dle-app dle-intro">
        {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} />}
        <h1>304dle</h1>
        <p className="dle-intro-date">{state.puzzle.date}</p>
        <p className="dle-intro-blurb">
          You are South, the trumper. Eight rounds. Call Caps when the worlds collapse.
        </p>
        <button
          type="button"
          className="dle-btn dle-btn-primary dle-btn-large"
          onClick={() => useStore.getState().startGame()}
        >
          Begin
        </button>
        {persisted.streak.current > 0 && (
          <p className="dle-streak-pill">Streak: {persisted.streak.current}</p>
        )}
      </main>
    );
  }

  if (state.kind === 'result') {
    if (
      persisted.todayResult === null ||
      persisted.todayResult.date !== state.puzzle.date
    ) {
      const v = buildVerdict({
        verdict: state.verdict,
        callRound: state.callRound,
        obligatedAtRound: state.obligatedAtRound,
        worldsAtCall: state.worldsAtCall,
      });
      const next = recordResult(
        persisted,
        {
          date: state.puzzle.date,
          verdict: state.verdict,
          callRound: state.callRound,
          obligatedAtRound: state.obligatedAtRound,
          worldsAtCall: state.worldsAtCall,
          difficulty: state.difficulty,
        },
        v.extendsStreak,
      );
      saveState(next);
      setPersisted(next);
    }
    return (
      <main className="dle-app">
        <ResultScreen
          puzzle={state.puzzle}
          verdict={state.verdict}
          callRound={state.callRound}
          obligatedAtRound={state.obligatedAtRound}
          worldsAtCall={state.worldsAtCall}
          difficulty={state.difficulty}
          streakCurrent={persisted.streak.current}
          streakLongest={persisted.streak.longest}
          onReplay={() => useStore.getState().replayHand()}
        />
      </main>
    );
  }

  const runtime =
    state.kind === 'playing' ||
    state.kind === 'caps-confirm' ||
    state.kind === 'caps-reveal'
      ? state.runtime
      : null;
  if (runtime === null) return null;

  return (
    <main className="dle-app">
      <PlayingShell runtime={runtime} appState={state} />
    </main>
  );
};

interface ShellProps {
  runtime: Runtime;
  appState: ReturnType<typeof useStore.getState>['state'];
}

const PlayingShell = ({ runtime, appState }: ShellProps) => {
  const playCard = useStore(s => s.playCard);
  const advanceBots = useStore(s => s.advanceBots);
  const resolveCurrentRound = useStore(s => s.resolveCurrentRound);
  const openCapsConfirm = useStore(s => s.openCapsConfirm);
  const cancelCapsConfirm = useStore(s => s.cancelCapsConfirm);
  const submitCaps = useStore(s => s.submitCaps);
  const finishGame = useStore(s => s.finishGame);
  const skipCapsToResult = useStore(s => s.skipCapsToResult);
  const legalPlaysForSouth = useStore(s => s.legalPlaysForSouth);

  const turn = whoseTurn(runtime);
  const order = turnOrder(runtime);
  const roundComplete = runtime.currentRound.length === order.length;

  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) return;
    if (turn === null && roundComplete) {
      const t = setTimeout(() => resolveCurrentRound(), ROUND_LINGER_MS);
      return () => clearTimeout(t);
    }
    if (turn !== null && turn !== 'south') {
      const { delayMs } = tempoForBotPlay(runtime, turn);
      const t = setTimeout(() => advanceBots(), delayMs);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, runtime.currentRound.length, turn, roundComplete, advanceBots, resolveCurrentRound, runtime]);

  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) {
      const t = setTimeout(() => skipCapsToResult(), 600);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, skipCapsToResult, runtime]);

  // Live worlds count, recomputed only on play boundaries.
  const worldsCount = useMemo(
    () => countWorlds(runtime),
    [runtime, runtime.roundNumber, runtime.currentRound.length],
  );

  const legalSet = new Set(legalPlaysForSouth());
  const dateLabel = 'puzzle' in appState ? appState.puzzle.date : '';

  return (
    <>
      <header className="dle-app-header">
        <h1>304dle</h1>
        <span className="dle-app-date">{dateLabel}</span>
      </header>
      <Table runtime={runtime} />
      <PublicInfo worlds={worldsCount} />
      <Hand
        hand={runtime.hands.south}
        legalSet={legalSet}
        trumpCard={runtime.trumpCard}
        onPlay={turn === 'south' ? playCard : () => {}}
      />
      <div className="dle-actions">
        <button
          type="button"
          className="dle-btn dle-btn-primary"
          disabled={runtime.hands.south.length === 0}
          onClick={openCapsConfirm}
        >
          Call Caps
        </button>
      </div>

      {appState.kind === 'caps-confirm' && (
        <CapsConfirmModal
          onConfirm={submitCaps}
          onCancel={cancelCapsConfirm}
        />
      )}

      {appState.kind === 'caps-reveal' && (
        <CapsRevealModal
          verdict={appState.verdict}
          witnessLine={appState.witnessLine}
          onDone={finishGame}
        />
      )}
    </>
  );
};
