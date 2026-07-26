// Offline caps verifier.
//
// `checkCapsObligation` is a CSP over an information set — fast, and
// twice found unsound. This tool answers the same question the slow,
// literal way, with no shared code with the CSP, so the two can be
// cross-checked. It is the thing to reach for when a player disputes a
// par round.
//
// Caps is `∀W ∃σ_W` (docs/specs/caps_formalism.md §5), so:
//
//   * To PROVE obligation it is enough to exhibit one fixed order that
//     sweeps every consistent world — `∃O ∀W` implies `∀W ∃σ_W`. This
//     is sound but incomplete: some obligated states have no single
//     order, only per-world strategies.
//   * To REFUTE obligation it is enough to exhibit one consistent world
//     in which no adaptive strategy sweeps. This is sound and, for that
//     world, complete.
//
// Both directions are one-sided, which is exactly what is wanted: the
// tool either proves, refutes, or says "undetermined within budget"
// and never guesses.
//
// Worlds are sampled, not exhausted — at seven cards a hand there are
// far too many. Sampling is stratified toward the layouts that
// actually break caps claims (outstanding trumps concentrated in one
// opponent, opponents void in the suits the caller must lead), because
// uniform sampling wastes almost all its budget on easy worlds.
//
// CLI:
//   npm run puzzles:verify -- --date 2026-08-02 --round 1
//   npm run puzzles:verify -- --date 2026-08-14 --round 3 --worlds 4000

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suitOf } from '../../engine/card';
import type { CardId, Suit } from '../../engine/card';
import { checkCapsObligation } from '../../engine/caps';
import { orderSweepsWorld, worldSweepsAdaptive } from '../../engine/dd';
import { buildInfoSet, enumerateWorlds } from '../../engine/info';
import type { World } from '../../engine/info';
import type { Seat } from '../../engine/seating';
import { SEATS_BY_INDEX, SEAT_INDEX } from '../../engine/seating';
import type { ScriptedPuzzle } from '../../apps/304dle/types';
import {
  applyScriptedPlay,
  newRuntime,
  resolveRound,
  toEngineState,
  whoseTurn,
} from '../../apps/304dle/runtime';
import type { Runtime } from '../../apps/304dle/runtime';

const REPO_ROOT = resolve(__dirname, '../..');

interface Args {
  date: string;
  round: number;      // verify at the END of this round, resolved
  worlds: number;
  budgetMs: number;
}

const parseArgs = (): Args => {
  const a = process.argv.slice(2);
  let date = '';
  let round = 0;
  let worlds = 2000;
  let budgetMs = 120_000;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--date') date = a[++i];
    else if (a[i] === '--round') round = parseInt(a[++i], 10);
    else if (a[i] === '--worlds') worlds = parseInt(a[++i], 10);
    else if (a[i] === '--budget-ms') budgetMs = parseInt(a[++i], 10);
  }
  if (!date) throw new Error('--date YYYY-MM-DD required');
  if (!round) throw new Error('--round N required (verify at the end of round N)');
  return { date, round, worlds, budgetMs };
};

// Candidate caps lines, rather than all n! orders (7 cards = 5040,
// each needing a full solve per world — hopeless).
//
// A real caps line has a shape: draw the outstanding trumps, then cash
// winners suit by suit. So enumerate orderings of the SUIT GROUPS, with
// each suit played high-to-low internally. Four suits gives 24
// candidates, which covers essentially every line a player would
// actually claim. Incomplete by construction — a failure to find one
// proves nothing, which is why the tool reports "undetermined" rather
// than "not obligated".
const RANK_ORDER = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const rankIdx = (c: CardId): number =>
  RANK_ORDER.indexOf(c.slice(0, c.length - 1));

const candidateOrders = (hand: ReadonlyArray<CardId>, trump: Suit): CardId[][] => {
  const bySuit = new Map<Suit, CardId[]>();
  for (const c of hand) {
    const s = suitOf(c);
    if (!bySuit.has(s)) bySuit.set(s, []);
    bySuit.get(s)!.push(c);
  }
  for (const cards of bySuit.values()) cards.sort((a, b) => rankIdx(a) - rankIdx(b));
  const suits = [...bySuit.keys()];
  const out: CardId[][] = [];
  const permute = (rest: Suit[], acc: Suit[]) => {
    if (rest.length === 0) {
      out.push(acc.flatMap(s => bySuit.get(s)!));
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    }
  };
  permute(suits, []);
  // Trump-first lines are the usual claim shape — try them first.
  out.sort((a, b) => {
    const at = suitOf(a[0]) === trump ? 0 : 1;
    const bt = suitOf(b[0]) === trump ? 0 : 1;
    return at - bt;
  });
  return out;
};

// Play the script to the end of `round`, resolved, so the caller is at
// a clean decision point.
const advance = (p: ScriptedPuzzle, round: number): Runtime => {
  const rt = newRuntime({
    hands: p.hands,
    trumpSuit: p.trump.suit,
    trumpCard: p.trump.card,
    trumperSeat: p.trump.trumper,
    priority: p.priority,
    script: p.script,
    mode: p.trump.mode,
  });
  for (let r = 1; r <= round; r++) {
    while (whoseTurn(rt) !== null) applyScriptedPlay(rt);
    resolveRound(rt);
  }
  return rt;
};

const handsOf = (w: World): Map<Seat, ReadonlyArray<CardId>> => {
  const m = new Map<Seat, ReadonlyArray<CardId>>();
  for (let i = 0; i < 4; i++) m.set(SEATS_BY_INDEX[i], w.hands[i]);
  return m;
};

// How dangerous does this world look for the caller? Higher is nastier,
// so the refutation search tries these first. Two things break caps
// claims in practice: outstanding trumps piled into ONE opponent hand
// (so two trump leads cannot draw them all), and opponents void in the
// suits the caller is relying on (so they can ruff a winner).
const hostility = (w: World, callerSeat: Seat, trump: Suit): number => {
  let score = 0;
  let maxTrumpInOneOpp = 0;
  for (let i = 0; i < 4; i++) {
    const seat = SEATS_BY_INDEX[i];
    if (seat === callerSeat) continue;
    const hand = w.hands[i];
    const trumps = hand.filter(c => suitOf(c) === trump).length;
    const isOpp = i !== SEAT_INDEX[callerSeat] &&
      SEATS_BY_INDEX[i] !== partnerOf(callerSeat);
    if (isOpp) {
      maxTrumpInOneOpp = Math.max(maxTrumpInOneOpp, trumps);
      const suits = new Set(hand.map(c => suitOf(c)));
      score += (4 - suits.size) * 2;   // voids are ruffing opportunities
    }
  }
  return score + maxTrumpInOneOpp * 5;
};

const partnerOf = (s: Seat): Seat =>
  s === 'north' ? 'south' : s === 'south' ? 'north' : s === 'east' ? 'west' : 'east';

const main = () => {
  const args = parseArgs();
  const p = JSON.parse(
    readFileSync(resolve(REPO_ROOT, `site/public/puzzles/${args.date}.json`), 'utf-8'),
  ) as ScriptedPuzzle;

  const rt = advance(p, args.round);
  const state = toEngineState(rt);
  const hand = [...rt.hands.south];
  const roundsRemaining = 8 - rt.completedRounds.length;

  console.log(`${args.date}  trump=${p.trump.suit}  trumper=${p.trump.trumper}`);
  console.log(`verifying at: end of R${args.round}, resolved`);
  console.log(`  leader next : ${rt.priority}`);
  console.log(`  south holds : ${hand.join(' ')}  (${roundsRemaining} rounds left)`);
  console.log(`  ENGINE says : ${checkCapsObligation(state, 'south') ? 'OBLIGATED' : 'not obligated'}`);

  if (hand.length === 0) { console.log('  nothing to verify'); return; }

  const info = buildInfoSet(state, 'south');
  const deadline = Date.now() + args.budgetMs;

  // Collect a sample of worlds, keeping the most hostile ones.
  const sample: World[] = [];
  for (const w of enumerateWorlds(info, { maxWorlds: args.worlds })) {
    sample.push(w);
    if (Date.now() > deadline) break;
  }
  sample.sort((a, b) =>
    hostility(b, 'south', p.trump.suit) - hostility(a, 'south', p.trump.suit));
  console.log(`  sampled     : ${sample.length} worlds (hostile-first)`);

  // --- Proof pass first: it is far cheaper (the caller's card is
  // fixed at every turn, so only the opponents branch).
  const orders = candidateOrders(hand, p.trump.suit);
  console.log(`  proving     : ${orders.length} candidate lines x ${sample.length} worlds`);
  for (const order of orders) {
    if (Date.now() > deadline) break;
    let allSweep = true;
    for (const w of sample) {
      if (!orderSweepsWorld({
        world: w,
        callerSeat: 'south',
        callerOrder: order,
        snapshot: { leader: rt.priority, entries: [] },
        pccPartnerOut: null,
        roundsRemaining,
      })) { allSweep = false; break; }
    }
    if (allSweep) {
      console.log(`\n  RESULT: OBLIGATED — this line sweeps all ${sample.length} sampled worlds:`);
      console.log(`    ${order.join(' → ')}`);
      console.log('  (sound: one order winning every consistent world is a witness family)');
      return;
    }
  }

  // --- Refutation pass: one world with no adaptive sweep kills it.
  // Expensive, so it runs only after the cheap proof pass failed.
  let refuted: World | null = null;
  let adaptiveChecked = 0;
  for (const w of sample) {
    if (Date.now() > deadline) break;
    adaptiveChecked++;
    const ok = worldSweepsAdaptive({
      hands: handsOf(w),
      callerSeat: 'south',
      leader: rt.priority,
      inProgress: [],
      roundsRemaining,
      trumpSuit: p.trump.suit,
    });
    if (!ok) { refuted = w; break; }
  }

  if (refuted !== null) {
    console.log(`\n  RESULT: NOT OBLIGATED — refuted after ${adaptiveChecked} worlds.`);
    console.log('  A layout consistent with everything south had seen, in which south cannot sweep:');
    for (const st of ['north', 'west', 'east'] as Seat[]) {
      console.log(`    ${st.padEnd(6)} ${refuted.hands[SEAT_INDEX[st]].join(' ')}`);
    }
    console.log(`    ${'south'.padEnd(6)} ${hand.join(' ')}`);
    return;
  }

  console.log(`\n  RESULT: undetermined within budget.`);
  console.log(`  No world refuted it (${adaptiveChecked} checked adaptively) and no candidate`);
  console.log('  line swept every sampled world — obligation may still hold via');
  console.log('  per-world strategies. Raise --worlds/--budget-ms, or treat as unproven.');
};

main();
