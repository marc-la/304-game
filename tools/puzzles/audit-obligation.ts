// Soundness audit for the caps-obligation predicate.
//
// For every shipped puzzle, replay to the round where the engine first
// stamps south as caps-obligated, then independently enumerate every
// world consistent with south's information set and ask, per world,
// whether ANY ordering of south's remaining cards sweeps.
//
// A puzzle where the engine says "obligated" but south cannot sweep in
// some consistent world is a soundness violation: caps means
// `∀W ∃σ_W` (caps_formalism.md §5), so a single non-sweep world
// refutes it.
//
// The per-world solve is ADAPTIVE, matching the spec: within a world
// the caller picks each card knowing what has been played so far, and
// every other seat — partner included, per §5's note that the caller
// "cannot rely on partner choice" — is adversarial. So a world counted
// here as "cannot sweep" genuinely refutes obligation, and the output
// is a proof rather than a screen.
//
// Run: npm run puzzles:audit

import { readFileSync, readdirSync } from 'node:fs';
import type { CardId } from '@engine/card';
import { suitOf } from '@engine/card';
import { checkCapsObligation } from '@engine/caps';
import { buildInfoSet, enumerateWorlds } from '@engine/info';
import { legalPlays, roundTurnOrder, roundWinner, seatsHoldingTrump } from '@engine/play';
import type { Suit } from '@engine/card';
import { SEATS_BY_INDEX, teamOf } from '@engine/seating';
import type { Seat } from '@engine/seating';
import { toEngineState, newRuntime, applyScriptedPlay, resolveRound, whoseTurn } from '@apps/304dle/runtime';


// Adaptive per-world sweep: does the caller have a strategy that wins
// every remaining round in THIS fully-known world, against every legal
// continuation by all three other seats?
const worldSweeps = (
  hands: Map<Seat, CardId[]>,
  callerSeat: Seat,
  leader: Seat,
  inProgress: Array<[Seat, CardId]>,
  roundsRemaining: number,
  trumpSuit: Suit,
): boolean => {
  if (roundsRemaining <= 0) return true;
  const order = roundTurnOrder(leader, null);
  if (inProgress.length >= order.length) {
    const winner = roundWinner(inProgress, trumpSuit);
    if (teamOf(winner) !== teamOf(callerSeat)) return false;
    if (roundsRemaining === 1) return true;
    return worldSweeps(hands, callerSeat, winner, [], roundsRemaining - 1, trumpSuit);
  }
  const seat = order[inProgress.length];
  const hand = hands.get(seat) ?? [];
  if (hand.length === 0) return false;
  const handsArr: ReadonlyArray<CardId>[] = [[], [], [], []];
  for (let i = 0; i < 4; i++) handsArr[i] = hands.get(SEATS_BY_INDEX[i]) ?? [];
  const legal = legalPlays({
    hand,
    ledSuit: inProgress.length > 0 ? suitOf(inProgress[0][1]) : null,
    trumpSuit,
    isLead: inProgress.length === 0,
    seatsWithTrumps: seatsHoldingTrump(handsArr, trumpSuit),
    seat,
  });
  if (legal.length === 0) return false;
  for (const c of legal) {
    const next = new Map(hands);
    next.set(seat, hand.filter(x => x !== c));
    const ok = worldSweeps(
      next, callerSeat, leader, [...inProgress, [seat, c]], roundsRemaining, trumpSuit,
    );
    // Caller picks the best line (existential); everyone else is
    // adversarial (universal).
    if (seat === callerSeat) { if (ok) return true; }
    else if (!ok) return false;
  }
  return seat !== callerSeat;
};

const files = readdirSync('site/public/puzzles').filter(f=>/^\d{4}-/.test(f)).sort();
let suspect=0;
for (const f of files) {
  const P = JSON.parse(readFileSync(`site/public/puzzles/${f}`,'utf-8'));
  const rt = newRuntime({ hands:P.hands, trumpSuit:P.trump.suit, trumpCard:P.trump.card,
    trumperSeat:P.trump.trumper, priority:P.priority, script:P.script, mode:P.trump.mode });
  let par=0;
  for (let r=1;r<=7;r++){
    while (whoseTurn(rt)!==null) applyScriptedPlay(rt);
    if (checkCapsObligation(toEngineState(rt),'south')) { par=r; break; }
    resolveRound(rt);
  }
  if (!par) { console.log(`${f}  no obligation found`); continue; }
  const st = toEngineState(rt);
  const info = buildInfoSet(st,'south');
  if (rt.hands.south.length > 6) { console.log(`${f}  par R${par}  (hand too big to audit)`); continue; }
  const entries: Array<[Seat, CardId]> = rt.currentRound
    .filter(e=>e.card!==null).map(e=>[e.seat, e.card as CardId]);
  let n=0,bad=0;
  for (const w of enumerateWorlds(info,{maxWorlds:6000})) {
    n++;
    const hands = new Map<Seat, CardId[]>();
    for (let i=0;i<4;i++) hands.set(SEATS_BY_INDEX[i], [...w.hands[i]]);
    if(!worldSweeps(hands,'south',rt.priority,entries,
                    8-rt.completedRounds.length,P.trump.suit)) bad++;
  }
  const pct = n? (100*bad/n).toFixed(1):'?';
  if (bad>0) suspect++;
  console.log(`${f}  par R${par}  hand=${rt.hands.south.join(' ')}  worlds=${n}  cannot-sweep=${bad} (${pct}%)${bad>0?'   <-- SUSPECT':''}`);
}
console.log(`\n${suspect}/${files.length} puzzles have non-sweep worlds at their stamped par`);
