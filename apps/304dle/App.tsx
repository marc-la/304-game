import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import type { ScriptedPuzzle, ScriptedPuzzleFile } from './types';
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
import { tempoForBotPlay } from './tempo';
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

const loadDailyPuzzle = async (date: string): Promise<ScriptedPuzzle | null> => {
  try {
    const r = await fetch('./puzzles/scripts.json');
    if (!r.ok) return null;
    const file = (await r.json()) as ScriptedPuzzleFile;
    if (file.schemaVersion !== 2) return null;
    const sel = selectPuzzleForDate(date, file.puzzles);
    if (sel) return { ...sel, date };
    return null;
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
    const today = state.date;
    if (isAlreadyPlayed(persisted, today) && persisted.todayResult) {
      const r = persisted.todayResult;
      return (
        <main className="dle-app">
          <ResultScreen
            puzzle={state.puzzle}
            date={today}
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
        <p className="dle-intro-date">{state.date}</p>
        <p className="dle-intro-blurb">
          You are South. Plays are scripted — your only decision is when to call Caps.
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
      persisted.todayResult.date !== state.date
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
          date: state.date,
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
          date={state.date}
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
  const playScripted = useStore(s => s.playScripted);
  const resolveCurrentRound = useStore(s => s.resolveCurrentRound);
  const openCapsConfirm = useStore(s => s.openCapsConfirm);
  const cancelCapsConfirm = useStore(s => s.cancelCapsConfirm);
  const submitCaps = useStore(s => s.submitCaps);
  const finishGame = useStore(s => s.finishGame);
  const skipCapsToResult = useStore(s => s.skipCapsToResult);
  const scriptedCardForSouth = useStore(s => s.scriptedCardForSouth);

  const turn = whoseTurn(runtime);
  const order = turnOrder(runtime);
  const roundComplete = runtime.currentRound.length === order.length;

  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) return;
    // Grace period: when the round fills, the engine does NOT
    // auto-resolve. The just-completed round stays on the table until
    // the player either calls caps or clicks Continue. This matches
    // the table convention: a brief window to call caps on the
    // closing card of a round before play moves on.
    if (turn === null && roundComplete) return;
    if (turn !== null && turn !== 'south') {
      const { delayMs } = tempoForBotPlay(runtime, turn);
      const t = setTimeout(() => playScripted(), delayMs);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, runtime.currentRound.length, turn, roundComplete, playScripted, resolveCurrentRound, runtime]);

  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) {
      const t = setTimeout(() => skipCapsToResult(), 600);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, skipCapsToResult, runtime]);

  const worldsCount = useMemo(
    () => countWorlds(runtime),
    [runtime, runtime.roundNumber, runtime.currentRound.length],
  );

  const scriptedCard = scriptedCardForSouth();
  const legalSet = new Set(scriptedCard !== null ? [scriptedCard] : []);
  const dateLabel = appState.kind === 'playing' ||
    appState.kind === 'caps-confirm' ||
    appState.kind === 'caps-reveal'
    ? appState.date
    : '';

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
        trumpCard={runtime.trump.trumpCard}
        onPlay={turn === 'south' ? () => playScripted() : () => {}}
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
        {turn === null && roundComplete && !isGameOver(runtime) && (
          <button
            type="button"
            className="dle-btn"
            onClick={() => resolveCurrentRound()}
          >
            Continue
          </button>
        )}
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
