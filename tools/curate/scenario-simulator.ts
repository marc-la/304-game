// Scenario-aware simulator. Replaces the south-only, open-only L4
// simulator with a generalized version that handles:
//   - Any trumper seat (varies R1 priority and turn order accordingly).
//   - Open or closed trump mode (closed trump uses face-down play
//     and end-of-round trump reveal).
//
// South is always the puzzle's caller; the simulator's job is to
// find the first state at which south becomes caps-obligated under
// the actual play that unfolds.

import { suitOf } from '../../frontend/src/304dle/engine/card';
import type { CardId, Suit } from '../../frontend/src/304dle/engine/card';
import { chooseBotPlay } from '../../frontend/src/304dle/engine/bot';
import { checkCapsObligation } from '../../frontend/src/304dle/engine/caps';
import { findWitnessLine } from '../../frontend/src/304dle/engine/caps-csp';
import { makeRng } from '../../frontend/src/304dle/engine/dealing';
import {
  roundPoints,
  roundTurnOrder,
  roundWinner,
} from '../../frontend/src/304dle/engine/play';
import type { Seat, Team } from '../../frontend/src/304dle/engine/seating';
import { teamOf } from '../../frontend/src/304dle/engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  EngineTrumpState,
  RoundEntry,
} from '../../frontend/src/304dle/engine/state';
import { chooseClosedTrumpPlay } from './closed-trump-bot';
import type { Scenario } from './scenario-dealing';

const SEATS_ALL: Seat[] = ['north', 'west', 'south', 'east'];

interface ScenarioSimState {
  hands: Record<Seat, CardId[]>;
  trump: {
    trumperSeat: Seat;
    trumpSuit: Suit;
    trumpCard: CardId | null;     // null once played (or always for ?)
    trumpCardInHand: boolean;
    isRevealed: boolean;
    isOpen: boolean;
  };
  priority: Seat;
  completed: CompletedRound[];
  pointsWon: Record<Team, number>;
  rng: () => number;
}

const buildEngineState = (
  s: ScenarioSimState,
  currentRound: ReadonlyArray<RoundEntry>,
): EngineGameState => {
  const handsMap = new Map<Seat, CardId[]>();
  for (const seat of SEATS_ALL) handsMap.set(seat, s.hands[seat]);
  const trump: EngineTrumpState = {
    trumperSeat: s.trump.trumperSeat,
    trumpSuit: s.trump.trumpSuit,
    trumpCard: s.trump.trumpCard,
    trumpCardInHand: s.trump.trumpCardInHand,
    isRevealed: s.trump.isRevealed,
    isOpen: s.trump.isOpen,
  };
  return {
    hands: handsMap,
    trump,
    play: {
      roundNumber: s.completed.length + 1,
      priority: s.priority,
      currentRound,
      completedRounds: s.completed,
      pointsWon: s.pointsWon,
      capsObligations: new Map(),
    },
    pccPartnerOut: null,
  };
};

// Deep snapshot — defensive copy so subsequent mutations don't drift
// the captured S* state.
const snapshotState = (state: EngineGameState): EngineGameState => {
  const handsMap = new Map<Seat, ReadonlyArray<CardId>>();
  for (const [seat, cards] of state.hands) handsMap.set(seat, [...cards]);
  return {
    ...state,
    hands: handsMap,
    trump: { ...state.trump },
    play: {
      ...state.play,
      completedRounds: state.play.completedRounds.map(r => ({
        ...r,
        cards: r.cards.map(e => ({ ...e })),
      })),
      currentRound: state.play.currentRound.map(e => ({ ...e })),
    },
  };
};

// Choose one card to play (with face-up/face-down flag) for a given
// seat in the current round. Dispatches to closed-trump bot when in
// closed mode; uses the standard face-up bot when open.
const choosePlay = (
  s: ScenarioSimState,
  seat: Seat,
  currentRound: RoundEntry[],
): { card: CardId; faceDown: boolean } => {
  const state = buildEngineState(s, currentRound);
  const hand = s.hands[seat];

  // Trumper in closed trump may also play the folded card (face-down
  // cut). The closed-trump bot decides this; the bot's "hand"
  // parameter is the in-hand cards only (folded card handled
  // separately).
  if (!s.trump.isOpen) {
    return chooseClosedTrumpPlay({
      seat,
      hand,
      state,
      rng: s.rng,
    });
  }

  // Open trump: face-up only.
  const card = chooseBotPlay({ seat, hand, state, rng: s.rng });
  return { card, faceDown: false };
};

// Apply a play to the state: removes from hand (or the folded
// trump-card slot, if applicable), pushes onto current round.
const applyPlay = (
  s: ScenarioSimState,
  seat: Seat,
  card: CardId,
  faceDown: boolean,
  currentRound: RoundEntry[],
): void => {
  if (
    seat === s.trump.trumperSeat &&
    !s.trump.trumpCardInHand &&
    s.trump.trumpCard === card
  ) {
    // Trumper playing the folded card. Remove from trumpState.
    s.trump.trumpCard = null;
  } else {
    const idx = s.hands[seat].indexOf(card);
    if (idx === -1) {
      throw new Error(`bot picked card ${card} not in ${seat}'s hand`);
    }
    s.hands[seat].splice(idx, 1);
  }
  currentRound.push({
    seat,
    card: faceDown ? null : card,
    faceDown,
    revealed: false,
  });
  // For ground-truth bookkeeping we still need to know what the
  // face-down card was — store it on the entry by setting `card`
  // even when faceDown=true. The engine viewerKnowsIdentity logic
  // only treats it as known under the right conditions.
  currentRound[currentRound.length - 1].card = card;
};

// Resolve a round. Determine winner using ground-truth identities,
// update completed rounds, and (for closed trump) handle trump
// reveal.
const resolveRound = (
  s: ScenarioSimState,
  currentRound: RoundEntry[],
  roundNumber: number,
): void => {
  // Build the list of (seat, card) pairs from ground-truth identities.
  const plays: Array<readonly [Seat, CardId]> = currentRound
    .filter(e => e.card !== null)
    .map(e => [e.seat, e.card!] as const);

  const winner = roundWinner(plays, s.trump.trumpSuit);
  const points = roundPoints(plays);

  // Closed-trump reveal logic.
  let trumpRevealedInRound = false;
  if (!s.trump.isOpen) {
    // If any face-down play was a trump, reveal all trumps in this round.
    const hasFaceDownTrump = currentRound.some(
      e => e.faceDown && e.card !== null && suitOf(e.card) === s.trump.trumpSuit,
    );
    if (hasFaceDownTrump) {
      for (const e of currentRound) {
        if (e.faceDown && e.card !== null && suitOf(e.card) === s.trump.trumpSuit) {
          e.revealed = true;
        }
      }
      // If the originally-folded trump card was NOT played to this
      // round (so it's still on the table), pick it up into the
      // trumper's hand.
      if (s.trump.trumpCard !== null && !s.trump.trumpCardInHand) {
        s.hands[s.trump.trumperSeat].push(s.trump.trumpCard);
        s.trump.trumpCardInHand = true;
      }
      s.trump.isOpen = true;
      s.trump.isRevealed = true;
      trumpRevealedInRound = true;
    }
  }

  s.completed.push({
    roundNumber,
    cards: currentRound.map(e => ({ ...e })),
    winner,
    pointsWon: points,
    trumpRevealed: trumpRevealedInRound,
  });
  s.pointsWon[teamOf(winner)] += points;
  s.priority = winner;
};

export interface ScenarioSimulationOutcome {
  optimalCallRound: number | null;
  obligationState: EngineGameState | null;
  obligationWitness: CardId[] | null;
  southLostARound: boolean;
  southPoints: number;
  southPositionR1: number;       // 1..4 — south's slot in R1's turn order
}

export const simulateScenarioOnce = (
  initialHands: Record<Seat, CardId[]>,
  scenario: Scenario,
  trumpSuit: Suit,
  trumpCard: CardId,
  botSeed: number,
): ScenarioSimulationOutcome => {
  const s: ScenarioSimState = {
    hands: {
      north: [...initialHands.north],
      west: [...initialHands.west],
      south: [...initialHands.south],
      east: [...initialHands.east],
    },
    trump: {
      trumperSeat: scenario.trumperSeat,
      trumpSuit,
      trumpCard,
      trumpCardInHand: scenario.isOpen,
      isRevealed: scenario.isOpen,
      isOpen: scenario.isOpen,
    },
    priority: scenario.trumperSeat,
    completed: [],
    pointsWon: { team_a: 0, team_b: 0 },
    rng: makeRng(botSeed),
  };

  // R1 turn order from this trumper, with south's index.
  const r1TurnOrder = roundTurnOrder(scenario.trumperSeat, null);
  const southPositionR1 = r1TurnOrder.indexOf('south') + 1;

  let optimalCallRound: number | null = null;
  let obligationState: EngineGameState | null = null;
  let obligationWitness: CardId[] | null = null;

  for (let round = 1; round <= 8; round++) {
    const order = roundTurnOrder(s.priority, null);
    const currentRound: RoundEntry[] = [];
    for (const seat of order) {
      const { card, faceDown } = choosePlay(s, seat, currentRound);
      applyPlay(s, seat, card, faceDown, currentRound);
    }
    resolveRound(s, currentRound, round);

    // Did south's team lose this round? Caps is forever broken.
    const winner = s.completed[s.completed.length - 1].winner;
    if (teamOf(winner) !== teamOf('south')) {
      return {
        optimalCallRound: null,
        obligationState: null,
        obligationWitness: null,
        southLostARound: true,
        southPoints: s.pointsWon[teamOf('south')],
        southPositionR1,
      };
    }

    // Check obligation after this round's resolution. Stamp first time.
    if (optimalCallRound === null) {
      const post = buildEngineState(s, []);
      if (checkCapsObligation(post, 'south')) {
        optimalCallRound = round;
        obligationState = snapshotState(post);
        obligationWitness = findWitnessLine(post, 'south') ?? [];
      }
    }
  }

  return {
    optimalCallRound,
    obligationState,
    obligationWitness,
    southLostARound: false,
    southPoints: s.pointsWon[teamOf('south')],
    southPositionR1,
  };
};
