---
title: 304dle — Gameplay Logic Zero-Trust Verification
purpose: A fresh-session audit prompt. Verify every rule constraint that the 304dle gameplay engine *claims* to enforce — visibility, legal-play restrictions, trumper rules, §T9 reveals, info-set clauses — by reading the canonical docs as the spec and reading the code as untrusted. Find what is missing, what is wrong, and what is unverified.
status: handoff, 2026-05-26
audience: a fresh Claude session with no prior context on this repo
---

# Mission

You are auditing the **gameplay** layer of 304dle (the daily caps-puzzle app) for fidelity to the 304 rules. **Trust nothing until you've verified it.** The output is a findings report (described in §8 below), not a refactor — your job is to identify gaps, not to fix them. Suggesting fixes is welcome; implementing them is out of scope for this audit.

The team has had three sessions extending the engine and runtime: a scripted-playout puzzle mode (where pre-baked play sequences drive the game), closed-trump integration (face-down plays, §T9 reveals, info-set asymmetry), and a tournament harness for bots. The runtime has gone through two reshapes. **Drift between the canonical docs and the implementation is plausible and is what you are looking for.**

---

# 1. Scope

## In scope

- **Engine play rules**: legal plays, follow-suit, trumper-specific constraints (§T-1..§T-6), exhausted-trumps lead obligation, round resolution, trump-state transitions (§S1..§S11).
- **Information set** (§3 of caps_formalism): what each viewer can and cannot see at every moment, including the trumper's privileged observations at round resolution.
- **Closed-trump §T9 reveal**: when and how face-down trump plays cause public reveal; what happens to the folded trump card.
- **304dle runtime** wiring: does the script-driver correctly maintain trump state, currentRound, completedRounds, capsObligation tracking, hand state?
- **304dle UI visibility**: does the table render face-down cards correctly per viewer, including the linger period between round-fill and round-resolve?
- **Caps obligation predicate**: not the algorithm internals (those are formalism §5/§9), but whether the engine *calls* it with the right state at the right moment.
- **Tournament + match-collector trump/priority** decoupling.

## Out of scope (do not audit these)

- **Bidding** (auctions, partnering, skips, pass-on, redeal). 304dle has *no* bidding — it starts post-trump-reveal. This is a deliberate curatorial decision per `.claude/soul.md §VI.1.1`.
- **Trump-suit selection** mechanics. Trump is curatorial in 304dle (chosen offline). Don't audit the trump-selection rule.
- **Stone economy / scoring tables**. 304dle doesn't track stone; verdicts are correct/late/wrong-not-obligated.
- **PCC (Partner Closed Caps), External Caps, Absolute Hand, Claim Balance, Spoilt Trumps**. Not implemented in 304dle v1; per `.claude/soul.md §VI`.
- **The bot algorithms themselves** (B0..B7 logic). Those have their own handoff at `docs/bot-speed-handoff.md`. You may verify that bots only return *legal* plays (because that's a contract on the runtime), but not whether their decisions are *good*.
- **The multiplayer backend** (`multiplayer/`). Exiled per `.claude/directory.md`.
- **Cosmetic UI** (animations, colors, layout). Only audit UI insofar as it controls *visibility* (what the player can see).

---

# 2. Canonical source-of-truth docs (read these first, in this order)

1. [`docs/rules.md`](rules.md) — **the rules**. Every constraint cited as §X-N comes from here. Focus on these sections:
   - "Closed Trump Games" → §T-1..§T-6
   - "Exhausted Trumps" → §T8 (in play_invariants)
   - "Resolving Folded Cards" → §T9
   - "Caps" → §C-1..§C-16 (most are out of scope but §C-1, §C-3, §C-6 govern when calls are valid)
   - "Play" intro — follow-suit obligation
2. [`docs/play_invariants.md`](play_invariants.md) — **engine invariants**. §S1..§S11 state invariants, §T1..§T10 transition rules, §C1 forward closure, §C2 move-set agreement. *Every one* of these should hold in the runtime.
3. [`docs/caps_formalism.md`](caps_formalism.md) — **information set math**. §3 clauses 1–6 define what each viewer knows. §4 defines world consistency. §5 defines the caps-obligation predicate. §6 specialisations. §8 timing policy.
4. [`.claude/soul.md`](../.claude/soul.md) — the soul constitution. Where it asserts behavior, hold the code to it. Particularly §VI.1.1 (curatorial decisions vs live mechanics) and §VI.2 (what 304dle preserves vs strips).

Treat these docs as authoritative. If they conflict, raise that as a finding — but assume the docs are right and the code is wrong unless you can prove otherwise.

---

# 3. Files to attack (the implementation)

You will need to read all of these. Cite findings with `file.ts:line` precision.

## Engine layer (pure rule logic)

- [`engine/play.ts`](../engine/play.ts) — `legalPlays`, `roundWinner`, `roundTurnOrder`, `seatsHoldingTrump`. The legal-play function is the single point of truth for what cards are playable; if a constraint isn't here, it's likely missing.
- [`engine/state.ts`](../engine/state.ts) — `EngineGameState`, `RoundEntry`, `CompletedRound`, `CapsObligation`. The shape of the state — verify it has every field needed for §S1..§S11.
- [`engine/info.ts`](../engine/info.ts) — `buildInfoSet`, `viewerKnowsIdentity`, `enumerateWorlds`. The information-set construction. Verify it matches caps_formalism §3 clause by clause.
- [`engine/caps.ts`](../engine/caps.ts) and [`engine/caps-csp.ts`](../engine/caps-csp.ts) — `checkCapsObligation`, `trackCapsObligation`, `isCapsLate`. Verify the *timing* (when the engine calls these) rather than the inner algorithm.
- [`engine/seating.ts`](../engine/seating.ts) — turn order. Verify *anticlockwise* per rules.

## 304dle runtime + state machine

- [`apps/304dle/runtime.ts`](../apps/304dle/runtime.ts) — **the most likely place for drift.** `applyPlay`, `applyScriptedPlay`, `resolveRound`, `toEngineState`. Does it maintain every §S invariant? Does §T9 fire correctly? Is the folded-trump-card source/sink correct?
- [`apps/304dle/store.ts`](../apps/304dle/store.ts) — the state machine (intro → playing → caps-confirm → caps-reveal → result). Verify state transitions don't allow invalid play (e.g. submitting caps after game-over, replaying a hand mid-game).
- [`apps/304dle/types.ts`](../apps/304dle/types.ts) — schema. `ScriptedPuzzle` should have everything needed to reconstruct a valid initial state.

## 304dle UI (visibility only)

- [`apps/304dle/components/Table.tsx`](../apps/304dle/components/Table.tsx) — has its own `viewerKnowsEntry` helper for the linger period. Does it agree with engine `viewerKnowsIdentity` for all cases? **Particularly concerning**: the linger-period rendering vs the engine's `inCompletedRound` flag.
- [`apps/304dle/components/Hand.tsx`](../apps/304dle/components/Hand.tsx) — south's hand display. Trivial in scope but cross-check that `legalSet` filtering doesn't leak info about cards south doesn't have.
- [`apps/304dle/App.tsx`](../apps/304dle/App.tsx) — the linger-vs-resolve timing (`ROUND_LINGER_MS`). Does it interact safely with caps submission?

## Out of scope code (do NOT audit; just orient)

- `engine/bots/*` — bot logic. Only verify they emit *legal* plays via existing tests, don't audit their decision quality.
- `engine/bot.ts`, `engine/simple-bot.ts` — older bots, used by play app and curator. Not in 304dle.
- `tools/curator/*` — closed-trump-bot puzzle pipeline. Out of 304dle's runtime path; only audit if a runtime finding traces back here.
- `tools/bots/elo/*` — tournament harness. Different problem.
- `apps/play/*` — the play app (vs-bots). Not 304dle.
- `multiplayer/*` — exiled.

---

# 4. Methodology — zero-trust process

For every rule cited below, do this:

1. **Find the implementation.** Grep for the symbol or read the file. If you can't locate the enforcement, it's a P1 finding.
2. **Read the code.** Don't take comments at face value; trace the data flow.
3. **Construct a counter-example.** Build a concrete `EngineGameState` or `Runtime` that *would* violate the rule if the enforcement were missing or wrong. Mentally walk the code with that state.
4. **If possible, write a failing test.** A test that would expose the bug is the strongest finding. (You don't have to commit it — paste it in the findings report.)
5. **If the rule is enforced in *one* place but bypassed in another**, flag it. Example: `legalPlays` might enforce §T-1, but the runtime's `applyPlay` might accept any card — if the script-driver feeds it bad data, the constraint is bypassed.

Be especially suspicious of:

- **Hardcoded `true`/`false`** for trump state fields (`isOpen`, `isRevealed`, `trumpCardInHand`). The runtime should compute these, not assume them.
- **`as` casts** for `CardId | null`. A `null` reaching a non-null path is a bug source.
- **Comments saying "v1 simplification"** — these often hide unenforced constraints.
- **Code paths conditional on `mode === 'open'`** without a closed-mode equivalent.
- **Recent commits.** `git log --oneline -20` will surface what changed recently — those areas have less burn-in.

---

# 5. The verification checklist

Each item: **find the enforcement; verify; document or flag.**

## A. State invariants (play_invariants.md §S1..§S11)

| # | Invariant | Where to look | Verify |
|---|---|---|---|
| A1 | **§S1 card conservation**: every card from the 32-card pack is in exactly one location (hand / folded / current / completed). | runtime.ts, especially `applyPlay`, `resolveRound`, the folded-trump source/sink | Construct: trumper plays folded card as cut. Does it appear in `currentRound` and nowhere else? Does §T9 reveal not duplicate it? |
| A2 | **§S2 hand sizes**: `len(hand) + (1 if trumper holds folded card on table) = (9 - r) - played_now`. | runtime.ts, throughout the run | After §T9 fires and folded card moves to trumper's hand, do sizes still satisfy this? |
| A3 | **§S3 round structure**: roundNumber ∈ [1,8]; completedRounds.length = r-1 during play; every completed round has exactly 4 entries (3 PCC, not us). | runtime.ts:resolveRound | Verify resolveRound increments roundNumber, archives currentRound. |
| A4 | **§S4 priority and turn**: After round resolution, priority = winner of just-resolved round. | runtime.ts:resolveRound:226 (or wherever priority is set) | Single-line check. Easy. |
| A5 | **§S5 led suit**: led suit is the suit of the first face-up card in current round. | engine/play.ts, runtime usage | What happens if the leader plays face-down (illegal but if it occurred)? Verify ledSuit() returns null in that case. |
| A6 | **§S6 trump state**: exactly one of {closed-pre-reveal, closed-post-reveal, open-declared-pre-play} holds. | runtime.ts:newRuntime + §T9 reveal logic | Verify state transitions: closed → closed-post-reveal → done. Open never transitions. Closed-post-reveal: `isOpen=true, isRevealed=true`, folded card either in hand or already played. |
| A7 | **§S7 face-down cards**: only created in closed pre-reveal. After reveal, all plays face-up. | engine/play.ts (legalPlays should refuse face-down post-reveal) + runtime.ts (applyPlay must respect this) | Construct: closed game where §T9 fires in round 4. From round 5 onward, can a non-leader play face-down? It shouldn't be possible. Audit. |
| A8 | **§S8 trumper face-down legality**: every face-down trumper play is either the folded trump card OR a non-trump-suit card. **Never an in-hand trump.** | tools/curator/closed-trump-bot.ts + runtime.ts | Audit the closed-trump-bot's decision logic. Specifically: can it pick an in-hand trump and play it face-down? §T-4 says no. |
| A9 | **§S9 points conservation**: `points_won[A] + points_won[B] = sum of all completed-round points`. | runtime.ts:resolveRound | Trivial unless someone double-counts. |
| A10 | **§S10 location uniqueness**: no card in two places. | Cross-cutting; verify across applyPlay + resolveRound + §T9. | Particularly concerning: §T9 picks up folded card to hand. Is it ever in both `currentRound` and `hand`? |
| A11 | **§S11 PCC seat frozen**: PCC not in v1; verify `pccPartnerOut: null` always. Audit any branch that handles non-null. | runtime.ts | Dead-code check. Should be `null` always. |

## B. Play-transition rules (play_invariants.md §T1..§T10)

| # | Rule | Where | Verify |
|---|---|---|---|
| B1 | **§T1 card source**: every played card was in the player's hand OR was the folded trump card (trumper only). | runtime.ts:applyPlay:155 | The branching `if (seat === trumper && !trumpCardInHand && trumpCard === card)` covers the folded case. Is the else branch correct? |
| B2 | **§T2 follow suit**: if player has any card of led suit, played card's suit = led suit. **NOT enforced in the runtime** — it's enforced in `legalPlays`. Verify the runtime trusts the script/bot to comply. Then verify `legalPlays` is actually called everywhere appropriate. | engine/play.ts:legalPlays:22-39 + runtime.ts | Construct: bot returns a non-led-suit card when the player holds led-suit cards. Does the runtime catch it? Apparently not. **Is this a finding?** Discuss. |
| B3 | **§T3 closed-trump face-down rule**: face-down iff closed-pre-reveal AND not leading AND can't follow. | engine/play.ts + closed-trump-bot.ts | Audit: is there any path that produces face-down outside this triple-conjunction? |
| B4 | **§T4 trumper face-down restriction**: trumper face-down is folded card OR non-trump. **Strictly stronger than §T3.** | closed-trump-bot.ts | The bot has `if (isTrumper)` branch — does it always honor §T4? |
| B5 | **§T5 trump-card face-up restriction**: folded trump card playable face-up *only* in round 8 as trumper's last card. | runtime.ts (the source/sink in applyPlay) + closed-trump-bot.ts (the §T-2 fallback we added) | The closed-trump-bot's new R8-last-card branch returns `faceDown: false`. Verify it can only fire when round=8 AND hand is empty. Construct mid-game attempts and verify they don't fire it. |
| B6 | **§T6 closed-trump R1 lead restriction**: trumper with priority on R1 in closed cannot lead trump. | engine/play.ts:legalPlays + closed-trump-bot.ts:138-153 | The bot has `restrictTrumpLead` logic but the rules also require `legalPlays` to enforce it. Currently `legalPlays` doesn't (look closely). **Likely finding.** |
| B7 | **§T7 open-trump R1 lead obligation**: open-trump trumper with priority on R1 MUST lead trump (non-PCC). | engine/play.ts | Is this enforced? Search for it. **Likely finding** — easy to miss when you also have to handle closed-trump. |
| B8 | **§T8 exhausted trumps**: trumper with priority + has trump + nobody else holds trump → must lead trump. | engine/play.ts:legalPlays:29-37 | Read: enforced when `seatsWithTrumps.size === 1 && seatsWithTrumps.has(seat)`. Verify the caller (runtime/script-driver) actually passes the correct set. |
| B9 | **§T9 round resolution + reveal**: face-down trump in round → reveal all trumps, lift folded card to hand if not played, trump becomes open. | runtime.ts:resolveRound:240-280 | Most complex spot in the codebase. Walk it carefully: edge cases include (a) trumper plays folded card as cut (slot empties — then what?), (b) multiple face-down trumps in same round, (c) face-down trump but no folded card lift needed. |
| B10 | **§T10 phase exits**: caps call → SCRUTINY → COMPLETE. Caps cannot be called after R8's final card. | store.ts (submitCaps, finishGame); engine/caps.ts:trackCapsObligation:163-168 | trackCapsObligation has a "callWindowClosed" check. Verify it actually prevents stamping at the boundary. Test: simulate playing the very last card of R8 and call caps after. |

## C. Information set (caps_formalism §3 clauses 1–6)

| # | Clause | Where | Verify |
|---|---|---|---|
| C1 | **Clause 1 — own hand**: viewer sees own hand. | info.ts:buildInfoSet:96 | Trivial. |
| C2 | **Clause 2 — own play history**: viewer always sees what they themselves played (even face-down). | info.ts:viewerKnowsIdentity:74 (the `entry.seat === viewer` branch) | Verify. |
| C3 | **Clause 3 — public face-up history**: face-up cards public to all. | info.ts | Verify. |
| C4 | **Clause 4 — public face-down revelations**: §T9 reveals are public. | info.ts:viewerKnowsIdentity:73 (`entry.revealed`) | Verify the `revealed` flag is set by resolveRound and consumed correctly here. |
| C5 | **Clause 5 — public suit exhaustion**: face-down or off-suit play establishes the player is void in that suit, public knowledge. | info.ts:absorbExhaustion:107-115 | Verify. Construct a state where someone plays face-down on a non-led-suit — does the exhaustion fire? |
| C6 | **Clause 6 — trumper's privileged observations**: trumper knows every face-down card identity at round resolution. | info.ts:viewerKnowsIdentity:75 (`viewerIsTrumper && inCompletedRound`) | Verify `inCompletedRound` flag is passed correctly from `absorbRound` (line 139-144 of info.ts). Particularly: during the *in-progress* round, is this false? It must be — clause 6 is "at round resolution," not mid-round. |

## D. Caps timing (caps_formalism §8)

| # | Item | Where | Verify |
|---|---|---|---|
| D1 | **First-obligation stamp S\***: obligation tracked at the earliest event where it holds. | engine/caps.ts:trackCapsObligation + runtime.ts (calls it after every play + after resolveRound) | Trace every trackCapsObligation call site. Are any missing? |
| D2 | **Lenient timing policy** (default): no own-play between S\* and t_call. | engine/caps.ts:isCapsLate:184-207 | Read and verify against §8.3 lenient definition. |
| D3 | **Trumper's clause-6 timing**: obligation may flip from False to True at round resolution (because the trumper just learned a face-down identity). | runtime.ts:resolveRound:288 (the post-resolve trackCapsObligation call) | Verify this fires AFTER §T9 effects are applied. Otherwise the trumper's new knowledge is not reflected in the obligation check. |

## E. UI visibility (Table.tsx)

| # | Item | Where | Verify |
|---|---|---|---|
| E1 | Non-trumper south sees face-down opp cards as backs. | Table.tsx:viewerKnowsEntry | Verify. |
| E2 | Non-trumper south sees publicly-revealed trumps (§T9) as face-up. | Table.tsx:viewerKnowsEntry — the `roundFull && anyFaceDownTrump` branch | Construct: closed game, R3 east cuts with trump face-down. After round-full but before resolve, can south (non-trumper assuming alt-trumper puzzle) see the cut? |
| E3 | Trumper-south sees all face-down identities once round is full. | Table.tsx:viewerKnowsEntry — `isViewerTrumper && roundFull` | Verify. Cross-check: mid-round (length < 4), trumper does NOT see face-downs. |
| E4 | Folded trump card on the table (closed pre-reveal): trumper sees identity, non-trumper sees back. | Table.tsx:170-190 (the dle-petal-folded-trump branch) | Verify. |
| E5 | **Linger period vs engine info-set**: Table.tsx's `viewerKnowsEntry` should agree with engine `viewerKnowsIdentity` once the round is *completed* (post-resolve). During the linger (round full, pre-resolve), Table.tsx claims trumper sees all but engine `viewerKnowsIdentity` requires `inCompletedRound=true` which is set when the entry is in `completedRounds`. **Audit this divergence carefully.** | Cross-cut | The linger-period rendering is an intentional UX choice but the *engine* doesn't fire trackCapsObligation during the linger (only at resolve). Verify the player can't call caps during linger and get an incorrect verdict because of clause-6 timing. |

## F. Runtime state machine (store.ts)

| # | Item | Where | Verify |
|---|---|---|---|
| F1 | Caps call is only valid from `playing` or `caps-confirm` states. | store.ts:submitCaps | Verify. Construct: try to submit caps from `intro` or `result`. |
| F2 | `replayHand` rebuilds runtime from puzzle and resets to `playing`. | store.ts:replayHand | Verify hands, trump state, cursor all reset. |
| F3 | `skipCapsToResult` only fires when game is over. | store.ts:skipCapsToResult | Verify the guard. |
| F4 | `playScripted` cannot advance past script.length. | runtime.ts:applyScriptedPlay | Verify the throw is reachable but never thrown in normal flow. |

---

# 6. Specific high-risk areas worth a deep dive

These are spots where I suspect bugs but haven't proven anything:

1. **`legalPlays` does not currently enforce §T-1, §T-6, §T-7, or §T-8 *for the trumper*.** Read [`engine/play.ts:22-39`](../engine/play.ts#L22). It enforces follow-suit and exhausted-trumps-lead. It does NOT enforce: (a) trumper can't lead trump on R1 in closed (§T-1 → §T-6 actually), (b) trumper MUST lead trump on R1 in open (§T-7). The closed-trump-bot has a hand-rolled `restrictTrumpLead` but the engine doesn't. If a script-driver fed an illegal play, the runtime would accept it silently. **Trace this.**

2. **The §T9 "folded card stays on the table after a face-down trump cut" case.** When a non-trumper cuts with a face-down trump AND the trumper has not yet played the folded card, the folded card lifts to the trumper's hand. But what if the trumper played the folded card *earlier in the same game* (so the slot is already null at the §T9 moment)? Read [`runtime.ts:resolveRound:265-275`](../apps/304dle/runtime.ts#L265). The condition is `trump.trumpCard !== null && !trump.trumpCardInHand` — if the folded card is null (already played), no lift. Is that correct? I think so but verify.

3. **The trumper's clause-6 observation timing.** When the round fills, what happens? Read `runtime.ts:resolveRound`. The sequence: (a) determine winner, (b) compute points, (c) apply §T9 reveal effects, (d) push to completedRounds, (e) update priority + round number, (f) call `trackCapsObligation`. The trumper's info-set now sees the face-down identities (because `inCompletedRound=true`). Caps obligation can flip True. Good. But what if the engine evaluates obligation *before* §T9 reveals — does it matter? §T9 only affects what's *publicly* revealed; the trumper sees everything in the completed round either way. Verify this isn't a hidden ordering bug.

4. **Tournament's trump derivation for non-south trumpers.** Read [`tools/bots/elo/match.ts:longestSuit`](../tools/bots/elo/match.ts) and the new flow. When trumper rotates to (say) east, the trump suit is derived from east's hand. Is the deal "fair" across trumper rotations? In the original south-only setup, south got the longest-suit-of-south as trump — a slight advantage. With rotation, the rotating-trumper gets that advantage on their turn. Verify both teams get equivalent advantage over 50/50 split.

5. **The `viewerKnowsEntry` linger-period helper vs `viewerKnowsIdentity` engine helper.** They have different signatures and slightly different semantics. The UI uses one, the engine uses the other. **They should agree on every input where they overlap.** Construct test cases that exercise both and confirm.

6. **Caps obligation tracker only stamps south.** Read [`engine/caps.ts:trackCapsObligation:163`](../engine/caps.ts#L163) — defaults to `['south']`. For 304dle this is fine because south is the player. But the scripted puzzle generator rotates the obligated seat *into* south. What if the rotation is buggy and the obligated seat is actually north? The runtime would never stamp it. Verify the rotation is correct in [`tools/puzzles/generate-scripted.ts`](../tools/puzzles/generate-scripted.ts).

7. **Closed-trump-bot §T-2 last-card branch.** Added recently in [`tools/curator/closed-trump-bot.ts`](../tools/curator/closed-trump-bot.ts). The condition is `isTrumper && hand.length === 0 && foldedCard !== null`. Verify this only fires at the correct moment. What if hand becomes empty mid-game due to a bug — could this branch return the folded card prematurely?

---

# 7. How to run things

Setup:
```bash
export PATH=/home/marc/.nvm/versions/node/v22.16.0/bin:$PATH
cd frontend
npm install   # only if node_modules is missing
```

Run the existing tests:
```bash
npm test
```

Type-check:
```bash
npx tsc --noEmit -p tsconfig.app.json
```

Build:
```bash
npm run build
```

Generate a smoke puzzle for inspection:
```bash
npm run puzzles:generate -- --count 3 --mode closed --max-matches 200 --out /tmp/audit-puzzles.json
```

There is no live dev server testing tool for this audit — the testing approach is *unit-level inspection* against the rules, not runtime exercising.

---

# 8. Output format

Produce a single markdown report. Suggested structure:

```markdown
# 304dle Gameplay Verification Report

Date:
Verifier:
Commits scanned: (run `git log --oneline -10` and paste)

## Summary

- N items verified
- M findings (X P1, Y P2, Z P3)
- K tests recommended

## Verified items

| # | Rule | File:line | Notes |
| A1 | §S1 card conservation | runtime.ts:155-172 | Confirmed by walking applyPlay+resolveRound on a 4-game trace |
| ... |

## Findings

### F1: §T-1 not enforced in legalPlays for closed-trump R1 trumper lead [P1]

**Rule**: rules.md §T-1 — "The Trumper cannot lead with the Trump suit on the first round when they have priority."

**Implementation**: engine/play.ts:22-39 (legalPlays) does not check this.

**Counter-example**: ... (construct a state that proves it)

**Test to add**: ...

**Suggested fix**: ...

### F2: ...

## Recommended tests

[Paste the failing-test source for the strongest 3-5 findings. Even if not committed, this is what would have caught the bugs.]

## Notes / non-findings

[Things that looked suspicious but turned out OK. One sentence each.]
```

Severities:
- **P1**: Rule is unenforced; bug is reachable in normal play; silent corruption or incorrect verdict.
- **P2**: Rule is unenforced but only reachable via adversarial inputs or via paths the system doesn't actually take. Still worth fixing.
- **P3**: Cosmetic / nice-to-have / clarity. Or: rule is enforced but not in the right place.

---

# 9. Time budget guidance

- Reading the canonical docs (rules, play_invariants, caps_formalism): **45–60 min**
- Reading the implementation files (engine + runtime + Table.tsx): **60–90 min**
- Working through the checklist § 5 items: **2–3 hours**
- Deep-dive on §6 items: **1–2 hours**
- Writing the report: **30–60 min**

Total: ~5–7 hours of focused work. If the time budget is shorter, prioritize §5 sections A, B, and C (the rule-mechanical checks) — they have the highest finding-density.

---

# 10. What success looks like

A report that:

- Names every checklist item from §5 as either **verified (with file:line citation)** or **finding (with severity + suggested fix)**.
- Has at least 3 concrete *failing tests* in the recommendations — these are what catch regressions.
- Does not waste time on out-of-scope items.
- Is short on opinion, long on receipts.

The team has tried to be careful but has shipped fast across three sessions. **Assume drift exists.** Your job is to find it.

---

*End of handoff. Open with: read `docs/rules.md` closed-trump section + `docs/play_invariants.md` §T1..§T10, then `engine/play.ts` and `apps/304dle/runtime.ts`. Then start the checklist.*
