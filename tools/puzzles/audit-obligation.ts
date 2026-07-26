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
// Caveat on strength: orderSweepsWorld is the FIXED-order predicate
// (∃O ∀τ within the world), while the spec's witness is adaptive and
// may branch on what opponents reveal. Adaptive is strictly stronger,
// so a world counted here as "cannot sweep" is not automatically a bug
// — unless the caller's plays are forced, or the count is at or near
// 100%. Treat the output as a screen, not a proof.
//
// Run: npm run puzzles:audit

import { readFileSync, readdirSync } from 'node:fs';
import type { CardId } from '@engine/card';
import { checkCapsObligation } from '@engine/caps';
import { buildInfoSet, enumerateWorlds } from '@engine/info';
import { orderSweepsWorld } from '@engine/dd';
import { toEngineState, newRuntime, applyScriptedPlay, resolveRound, whoseTurn } from '@apps/304dle/runtime';

const perms = <T,>(a:T[]):T[][] => a.length<=1?[a]:a.flatMap((x,i)=>perms([...a.slice(0,i),...a.slice(i+1)]).map(r=>[x,...r]));
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
  const orders = perms([...rt.hands.south]);
  const entries = rt.currentRound.filter(e=>e.card!==null).map(e=>({seat:e.seat, card:e.card as CardId}));
  let n=0,bad=0;
  for (const w of enumerateWorlds(info,{maxWorlds:6000})) {
    n++;
    if(!orders.some(o=>orderSweepsWorld({world:w,callerSeat:'south',callerOrder:o,
      snapshot:{leader:rt.priority,entries},pccPartnerOut:null,
      roundsRemaining:8-rt.completedRounds.length}))) bad++;
  }
  const pct = n? (100*bad/n).toFixed(1):'?';
  if (bad>0) suspect++;
  console.log(`${f}  par R${par}  hand=${rt.hands.south.join(' ')}  worlds=${n}  cannot-sweep=${bad} (${pct}%)${bad>0?'   <-- SUSPECT':''}`);
}
console.log(`\n${suspect}/${files.length} puzzles have non-sweep worlds at their stamped par`);
