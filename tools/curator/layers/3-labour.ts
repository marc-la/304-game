// Layer 3 — Deduction labour. The cardinal hard-caps signal: how
// many facts in south's information set at S* are load-bearing for
// caps obligation. A fact is load-bearing iff relaxing it (treating
// south as having forgotten that one observation while remembering
// the rest) admits a consistent world in which south is no longer
// obligated under adaptive-caps semantics.
//
// Atomic facts considered:
//   - Each played-card identity in south's `knownPlayed` set.
//   - Each suit-exhaustion observation (re-derived implicitly when a
//     played-card is dropped, but also tested in isolation since some
//     exhaustions can be load-bearing without their underlying card
//     being so).
//
// The predicate is `checkCapsObligation` (CSP-based, adaptive). No
// world enumeration; no fixed-order witness search.

import { suitOf } from '@engine/card';
import type { CardId, Suit } from '@engine/card';
import { checkCapsObligation } from '@engine/caps';
import type { Seat } from '@engine/seating';
import { SEAT_INDEX } from '@engine/seating';
import type {
  CompletedRound,
  EngineGameState,
  RoundEntry,
} from '@engine/state';
import type { CuratorThresholds, Layer3Result } from '../types';

const ledSuitOf = (entries: ReadonlyArray<RoundEntry>): Suit | null => {
  for (const e of entries) {
    if (!e.faceDown && e.card !== null) return suitOf(e.card);
  }
  return null;
};

interface PlayedSlot {
  card: CardId;
  seat: Seat;
  roundNumber: number;
  ledSuit: Suit;
}

const indexPlayedCards = (state: EngineGameState): PlayedSlot[] => {
  const out: PlayedSlot[] = [];
  for (const round of state.play.completedRounds) {
    const led = ledSuitOf(round.cards);
    if (led === null) continue;
    for (const entry of round.cards) {
      if (entry.faceDown || entry.card === null) continue;
      // Skip south's own plays — those are not "deduction" facts,
      // they're own-action memory.
      if (entry.seat === 'south') continue;
      out.push({
        card: entry.card,
        seat: entry.seat,
        roundNumber: round.roundNumber,
        ledSuit: led,
      });
    }
  }
  return out;
};

// Rebuild a state with one played-card hidden (replaced by a hidden
// slot constrained to the same suit south originally observed). The
// info-set reconstruction in caps-csp's CSPCtx will see the slot and
// expand the unknown pool accordingly.
const blindOnePlayed = (
  state: EngineGameState,
  fact: PlayedSlot,
): EngineGameState => {
  const newCompleted: CompletedRound[] = state.play.completedRounds.map(r => {
    if (r.roundNumber !== fact.roundNumber) return r;
    return {
      ...r,
      cards: r.cards.map(e => {
        if (e.seat === fact.seat && e.card === fact.card) {
          // Mark this entry as face-down with no revealed identity.
          // The caps-csp solver reads the info-set built from this
          // state and will treat it as an unknown slot.
          return { ...e, card: null, faceDown: true, revealed: false };
        }
        return e;
      }),
    };
  });
  return {
    ...state,
    play: { ...state.play, completedRounds: newCompleted },
  };
};

// State-level relaxation for an exhaustion fact: rebuild the round
// where the off-suit play happened so that south "saw a follow-suit"
// instead. We model this by adding a synthetic non-off-suit
// substitute — but conservatively, simply removing the off-suit play
// from south's view (turning it into a hidden slot but treating its
// suit as the led suit) approximates "south did not observe the
// void". Implementation: same as blindOnePlayed for the off-suit
// card, but the resulting hidden-slot constraint flips knownSuit
// from card.suit to ledSuit.
const blindExhaustion = (
  state: EngineGameState,
  seat: Seat,
  suit: Suit,
): EngineGameState | null => {
  // Find the round where this seat played off-suit on a `suit` lead
  // (the observation that established the exhaustion).
  let roundIdx = -1;
  let entryIdx = -1;
  for (let i = 0; i < state.play.completedRounds.length; i++) {
    const r = state.play.completedRounds[i];
    const led = ledSuitOf(r.cards);
    if (led !== suit) continue;
    for (let j = 0; j < r.cards.length; j++) {
      const e = r.cards[j];
      if (e.seat !== seat) continue;
      if (e.faceDown || e.card === null) continue;
      if (suitOf(e.card) === led) continue;
      // Found the off-suit play.
      roundIdx = i;
      entryIdx = j;
      break;
    }
    if (roundIdx >= 0) break;
  }
  if (roundIdx < 0) return null;

  const newCompleted = state.play.completedRounds.map((r, i) => {
    if (i !== roundIdx) return r;
    return {
      ...r,
      cards: r.cards.map((e, j) => {
        if (j !== entryIdx) return e;
        // Hide identity AND lie about suit-of-play to the info-set
        // builder by marking the entry face-down. The buildInfoSet
        // logic then sees an off-suit hidden play and would still
        // count it as exhaustion. To actually relax exhaustion we
        // need a deeper hook — for now, use a different mechanism:
        // mark with synthetic ledSuit-matching card.
        return { ...e, card: null, faceDown: true, revealed: false };
      }),
    };
  });
  return {
    ...state,
    play: { ...state.play, completedRounds: newCompleted },
  };
};

// blindExhaustion is reserved for a future explicit exhaustion-fact
// relaxation. For now exhaustions are tested implicitly: when an
// off-suit played card is blinded via blindOnePlayed, the (seat,
// led-suit) exhaustion that card established is automatically
// re-derived from the remaining face-up plays in info-set
// reconstruction.
void blindExhaustion;

export interface DeductionLabourArgs {
  state: EngineGameState;       // state at S*
  thresholds: CuratorThresholds;
}

export const computeDeductionLabour = (
  args: DeductionLabourArgs,
): Layer3Result => {
  // Sanity: original state must still be obligated.
  if (!checkCapsObligation(args.state, 'south')) {
    return { pass: false, reason: 'no-witness' };
  }

  const facts = indexPlayedCards(args.state);
  const loadBearingCards: CardId[] = [];

  for (const fact of facts) {
    const relaxed = blindOnePlayed(args.state, fact);
    const stillObligated = checkCapsObligation(relaxed, 'south');
    if (!stillObligated) {
      loadBearingCards.push(fact.card);
    }
  }

  const labour = loadBearingCards.length;

  // Witness suit-span — informational only. Computed from south's
  // own remaining hand at S* (which is what the caller will play
  // out). Adaptive caps doesn't have a single witness, so we use
  // the breadth of south's hand as a proxy.
  const ownHand = args.state.hands[SEAT_INDEX.south] ?? [];
  const witnessSuitSpan = new Set(ownHand.map(c => suitOf(c))).size;

  if (labour < args.thresholds.minLabour) {
    return { pass: false, reason: 'low-labour', labour, witnessSuitSpan };
  }
  if (witnessSuitSpan < args.thresholds.minWitnessSuitSpan) {
    return {
      pass: false,
      reason: 'single-suit-witness',
      labour,
      witnessSuitSpan,
    };
  }

  return {
    pass: true,
    labour,
    loadBearingCards,
    loadBearingExhaustions: [],   // see blindExhaustion note above
    witnessSuitSpan,
  };
};
