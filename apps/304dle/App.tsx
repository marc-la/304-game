import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import type { ScriptedPuzzle } from './types';
import { Table } from './components/Table';
import { Hand } from './components/Hand';
import { CapsConfirmModal } from './components/CapsConfirmModal';
import { CapsRevealModal } from './components/CapsRevealModal';
import { ResultScreen } from './components/ResultScreen';
import { Onboarding } from './components/Onboarding';
import { whoseTurn, turnOrder, isGameOver } from './runtime';
import type { Runtime } from './runtime';
import { countWorlds } from './worlds-counter';
import { buildVerdict } from './scoring';
import { SETTLE_MS, lingerMsForRound, tempoForBotPlay } from './tempo';
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

// One file per date. Fetching `${date}.json` rather than the whole
// pool means the payload is ~2KB instead of ~800KB, and view-source
// leaks only the puzzle you are already playing — the year's answers
// are not sitting in the browser cache. (There is no way to keep this
// data secret on a static host; the goal is only to not hand out
// *future* days.)
const loadDailyPuzzle = async (date: string): Promise<ScriptedPuzzle | null> => {
  try {
    const r = await fetch(`./puzzles/${date}.json`);
    if (!r.ok) return null;
    const puzzle = (await r.json()) as ScriptedPuzzle;
    if (puzzle.schemaVersion !== 2) return null;
    return { ...puzzle, date };
  } catch {
    return null;
  }
};

// `?date=YYYY-MM-DD` plays a specific day instead of today's. This
// exists so the shipped window can actually be play-tested — otherwise
// the only reachable puzzle is the one matching the system clock.
//
// A preview session is NOT recorded: no result written, no streak
// touched, and the already-played gate is skipped so the same hand can
// be replayed as many times as you like. It gives a player nothing
// they couldn't get by fetching the JSON directly, so it isn't a
// cheat vector — but it must never be able to *inflate* a streak.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const previewDate = (): string | null => {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('date');
  return q !== null && DATE_RE.test(q) ? q : null;
};

const usePuzzleLoader = () => {
  const setPuzzle = useStore(s => s.setPuzzle);
  useEffect(() => {
    const date = previewDate() ?? todayDateString();
    loadDailyPuzzle(date).then(p => setPuzzle(p, date));
  }, [setPuzzle]);
};

export const App = () => {
  usePuzzleLoader();
  const state = useStore(s => s.state);
  const isPreview = previewDate() !== null;
  const [persisted, setPersisted] = useState(loadState);
  const [showOnboarding, setShowOnboarding] = useState(
    () =>
      !isPreview &&
      persisted.history.length === 0 &&
      persisted.todayResult === null,
  );

  if (state.kind === 'loading') {
    return <main className="dle-loading">Loading today's puzzle…</main>;
  }
  if (state.kind === 'no-puzzle') {
    return (
      <main className="dle-loading">
        <h1>No puzzle for {state.date}</h1>
        <p>{isPreview ? 'That date is outside the generated window.' : 'Check back tomorrow.'}</p>
      </main>
    );
  }

  if (state.kind === 'intro') {
    const today = state.date;
    // Preview sessions skip the already-played tombstone so the same
    // hand can be replayed while testing.
    if (!isPreview && isAlreadyPlayed(persisted, today) && persisted.todayResult) {
      const r = persisted.todayResult;
      return (
        <main className="dle-app">
          <ResultScreen
            puzzle={state.puzzle}
            date={today}
            verdict={r.verdict}
            callRound={r.callRound}
            obligatedAtRound={r.obligatedAtRound}
            handsAtCall={null}
            streakCurrent={persisted.streak.current}
            onReplay={() => useStore.getState().replayHand()}
          />
        </main>
      );
    }
    return (
      <main className="dle-app dle-intro">
        {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} />}
        <h1>304dle</h1>
        <p className="dle-intro-date">
          {state.date}
          {isPreview && <span className="dle-preview-tag">preview · not recorded</span>}
        </p>
        <p className="dle-intro-blurb">
          You are South. Your cards play themselves — the only decision is when to call Caps.
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
      !isPreview &&
      (persisted.todayResult === null ||
        persisted.todayResult.date !== state.date)
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
          handsAtCall={state.handsAtCall}
          streakCurrent={persisted.streak.current}
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
  // The trick is complete and still on the table. Clicking always
  // advances it — early rounds also auto-advance after their linger,
  // rounds 5+ wait indefinitely. Making the click available in *both*
  // cases is what lets the early lingers be generous: a player who has
  // read the trick is never held there.
  const canAdvance =
    appState.kind === 'playing' &&
    turn === null &&
    roundComplete &&
    !isGameOver(runtime);
  const awaitingAdvance =
    canAdvance && lingerMsForRound(runtime.roundNumber) === null;

  useEffect(() => {
    if (appState.kind !== 'playing') return;
    if (isGameOver(runtime)) return;

    // Round is full. Linger so the trick can be re-read (soul §VI.2),
    // then advance — but only for rounds 1–4. From round 5 the table
    // waits for the player (see `lingerMsForRound`), because that is
    // where the caps call lives and a forced advance would slam the
    // window shut mid-thought.
    if (turn === null && roundComplete) {
      const linger = lingerMsForRound(runtime.roundNumber);
      if (linger === null) return;
      const t = setTimeout(() => resolveCurrentRound(), linger);
      return () => clearTimeout(t);
    }

    if (turn !== null && turn !== 'south') {
      // SETTLE_MS is added to the bot's own deliberation so the
      // previous card has landed and been read before this one starts
      // moving. Without it, placements overlap.
      const { delayMs } = tempoForBotPlay(runtime, turn);
      const t = setTimeout(() => playScripted(), delayMs + SETTLE_MS);
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
      {/* Rounds 5–8 hold until the player releases them. The whole
          felt is the target — no button, because a labelled "Continue"
          reads as chrome to get past, and this beat is the one where
          the caps call actually happens. */}
      <div
        className={`dle-table-wrap${awaitingAdvance ? ' dle-awaiting' : ''}`}
        onClick={canAdvance ? () => resolveCurrentRound() : undefined}
      >
        <Table runtime={runtime} worlds={worldsCount} />
      </div>
      <Hand
        hand={runtime.hands.south}
        legalSet={legalSet}
        trumpCard={runtime.trump.trumpCard}
        onPlay={turn === 'south' ? () => playScripted() : () => {}}
      />
      <div className="dle-actions">
        <button
          type="button"
          className="dle-btn dle-btn-caps"
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
