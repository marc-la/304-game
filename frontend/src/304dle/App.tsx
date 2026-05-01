import { useEffect, useState } from 'react';
import { useStore } from './store';
import type { PuzzleFile } from './types';
import { Table } from './components/Table';
import { Hand } from './components/Hand';
import { PublicInfo } from './components/PublicInfo';
import { CapsEntryModal } from './components/CapsEntryModal';
import { CapsRevealModal } from './components/CapsRevealModal';
import { ResultScreen } from './components/ResultScreen';
import { Onboarding } from './components/Onboarding';
import { deduceExhaustedSuits } from './engine/caps';
import { whoseTurn, turnOrder, isGameOver } from './runtime';
import type { Runtime } from './runtime';
import { suitOf } from './engine/card';

const opponentTrumpsRemaining = (rt: Runtime): number => {
  const trump = rt.trumpSuit;
  let n = 0;
  for (const seat of ['north', 'east', 'west'] as const) {
    for (const c of rt.hands[seat]) if (suitOf(c) === trump) n++;
  }
  return n;
};
import {
  isAlreadyPlayed,
  loadState,
  recordResult,
  saveState,
  setPreference,
} from './storage';
import './styles.css';

const todayDateString = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const usePuzzleLoader = () => {
  const setPuzzle = useStore(s => s.setPuzzle);
  useEffect(() => {
    const today = todayDateString();
    const year = today.slice(0, 4);
    fetch(`./puzzles/${year}.json`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data: PuzzleFile) => {
        const puzzle = data.puzzles.find(p => p.date === today);
        setPuzzle(puzzle ?? null, today);
      })
      .catch(() => setPuzzle(null, today));
  }, [setPuzzle]);
};

export const App = () => {
  usePuzzleLoader();
  const state = useStore(s => s.state);
  const [persisted, setPersisted] = useState(loadState);
  // Show onboarding for first-time visitors only.
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
            score={r.score}
            verdict={r.verdict}
            callRound={r.callRound}
            orderLength={null}
            hintsUsed={0}
            worldsToggleUses={0}
            streakCurrent={persisted.streak.current}
            streakLongest={persisted.streak.longest}
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
          You are South, the trumper. Eight rounds. Call Caps when you're sure.
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
    // Persist on first visit to result.
    if (
      persisted.todayResult === null ||
      persisted.todayResult.date !== state.puzzle.date
    ) {
      const next = recordResult(persisted, {
        date: state.puzzle.date,
        score: state.score,
        verdict: state.verdict,
        callRound: state.callRound,
      });
      saveState(next);
      setPersisted(next);
    }
    return (
      <main className="dle-app">
        <ResultScreen
          puzzle={state.puzzle}
          score={state.score}
          verdict={state.verdict}
          callRound={state.callRound}
          orderLength={state.orderLength}
          hintsUsed={state.hintsUsed}
          worldsToggleUses={state.worldsToggleUses}
          streakCurrent={persisted.streak.current}
          streakLongest={persisted.streak.longest}
        />
      </main>
    );
  }

  const runtime =
    state.kind === 'playing' ||
    state.kind === 'caps-entry' ||
    state.kind === 'caps-reveal'
      ? state.runtime
      : null;
  if (runtime === null) return null;

  return (
    <main className="dle-app">
      <PlayingShell
        runtime={runtime}
        appState={state}
        persisted={persisted}
        setPersisted={setPersisted}
      />
    </main>
  );
};

interface ShellProps {
  runtime: Runtime;
  appState: ReturnType<typeof useStore.getState>['state'];
  persisted: ReturnType<typeof loadState>;
  setPersisted: (s: ReturnType<typeof loadState>) => void;
}

const PlayingShell = ({ runtime, appState, persisted, setPersisted }: ShellProps) => {
  const playCard = useStore(s => s.playCard);
  const advanceBots = useStore(s => s.advanceBots);
  const resolveCurrentRound = useStore(s => s.resolveCurrentRound);
  const openCapsEntry = useStore(s => s.openCapsEntry);
  const cancelCapsEntry = useStore(s => s.cancelCapsEntry);
  const toggleCardInOrder = useStore(s => s.toggleCardInOrder);
  const submitCaps = useStore(s => s.submitCaps);
  const finishGame = useStore(s => s.finishGame);
  const skipCapsToResult = useStore(s => s.skipCapsToResult);
  const recordHint = useStore(s => s.recordHint);
  const recordWorldsToggle = useStore(s => s.recordWorldsToggle);
  const legalPlaysForSouth = useStore(s => s.legalPlaysForSouth);

  const turn = whoseTurn(runtime);
  const order = turnOrder(runtime);
  const roundComplete = runtime.currentRound.length === order.length;

  // Auto-tick: bots play with a beat, then resolve, then continue.
  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) return;
    if (turn === null && roundComplete) {
      const t = setTimeout(() => resolveCurrentRound(), 800);
      return () => clearTimeout(t);
    }
    if (turn !== null && turn !== 'south') {
      const t = setTimeout(() => advanceBots(), 600);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, runtime.currentRound.length, turn, roundComplete, advanceBots, resolveCurrentRound, runtime]);

  // Game-over → result screen.
  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) {
      const t = setTimeout(() => skipCapsToResult(), 600);
      return () => clearTimeout(t);
    }
  }, [appState.kind, runtime.roundNumber, skipCapsToResult, runtime]);

  // Persist preferences when worlds toggle flipped.
  const showWorlds = persisted.preferences.showWorldsHint;

  const onWorldsToggle = () => {
    const next = setPreference(persisted, 'showWorldsHint', !showWorlds);
    saveState(next);
    setPersisted(next);
    if (!showWorlds) {
      recordWorldsToggle();
    }
  };

  // Public voids — derive from completed rounds.
  const voids = deduceExhaustedSuits({
    hands: new Map(),
    trump: {
      trumperSeat: 'south',
      trumpSuit: runtime.trumpSuit,
      trumpCard: runtime.trumpCard,
      trumpCardInHand: true,
      isRevealed: true,
      isOpen: true,
    },
    play: {
      roundNumber: runtime.roundNumber,
      priority: runtime.priority,
      currentRound: runtime.currentRound,
      completedRounds: runtime.completedRounds,
      pointsWon: runtime.pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  });

  const legalSet = new Set(legalPlaysForSouth());

  const dateLabel =
    'puzzle' in appState ? appState.puzzle.date : '';

  return (
    <>
      <header className="dle-app-header">
        <h1>304dle</h1>
        <span className="dle-app-date">{dateLabel}</span>
      </header>
      <Table runtime={runtime} />
      <PublicInfo
        voids={voids}
        showWorlds={showWorlds}
        worldsBucket={null}
        onToggleWorlds={onWorldsToggle}
      />
      <Hand
        hand={runtime.hands.south}
        legalSet={legalSet}
        onPlay={turn === 'south' ? playCard : () => {}}
      />
      <div className="dle-actions">
        <button
          type="button"
          className="dle-btn dle-btn-secondary"
          onClick={recordHint}
          title="Reveals deduced voids and trump count for this round (-1)"
        >
          Hint -1
        </button>
        <button
          type="button"
          className="dle-btn dle-btn-primary"
          disabled={runtime.hands.south.length === 0}
          onClick={openCapsEntry}
        >
          Call Caps
        </button>
      </div>
      {runtime.hintsUsed > 0 && (
        <p className="dle-hint-readout">
          Hints used: {runtime.hintsUsed}. Trumps remaining among opponents:{' '}
          {opponentTrumpsRemaining(runtime)}.
        </p>
      )}

      {appState.kind === 'caps-entry' && (
        <CapsEntryModal
          hand={runtime.hands.south}
          chosen={appState.chosen}
          onToggle={toggleCardInOrder}
          onSubmit={submitCaps}
          onCancel={cancelCapsEntry}
        />
      )}

      {appState.kind === 'caps-reveal' && (
        <CapsRevealModal
          order={appState.order}
          verdict={appState.verdict}
          breakingHint={appState.breakingWorldHint}
          onDone={finishGame}
        />
      )}
    </>
  );
};
