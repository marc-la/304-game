# 304 — Caps Formalism

> Formal model for **Caps**, **External Caps**, **Absolute Hand**, and
> **Claim Balance**. Companion to [rules.md](rules.md) (game rules) and
> [play_invariants.md](play_invariants.md) (engine invariants). The
> rules describe *what* the game is; this document defines the
> mathematical predicate the engine must compute, plus the timing
> policy that converts the predicate into "must call now / late /
> wrong". A correct implementation of caps is a correct implementation
> of this document — nothing more, nothing less.

## 1. Why this is hard, in one paragraph

Caps is not a property of the deal. It is a property of a player's
**information set** — what that player can deduce from their own hand
plus the public history of play. Two players sitting at the same table
in the same game can become caps-obligated at different moments,
because they know different things. A naive implementation that
checks "given the actual hands, is there a winning order?" is
**double-dummy** analysis: it tells you whether an omniscient observer
sees a sweep, not whether the candidate caller can deduce one. The
correct test is **single-dummy**: does there exist a play order that
wins against *every* deal consistent with what the player knows?
Single-dummy is strictly stronger than double-dummy and is the only
formulation that matches the rules' phrase "given all information
available to them".

## 2. Notation

| Symbol | Meaning |
|--------|---------|
| `S` | A play-phase state (per [play_invariants.md](play_invariants.md) §2). |
| `V` | The candidate caps-caller (the "viewer"). |
| `r(S)` | Current round number at `S`, in `[1, 8]`. |
| `H_V(S)` | `V`'s hand at `S` (private). |
| `pack` | The fixed 32-card 304 pack. |
| `Team(V)` | The team `V` belongs to. |
| `Adv(V)` | The seats not on `Team(V)` (and not the PCC-out seat). |
| `Fellow(V)` | `V`'s partner (excluded in PCC). |
| `Players(S)` | Non-PCC-out seats. |

## 3. Information sets

For each seat `V` and state `S`, the information set `I_V(S)` is the
union of:

1. **Own hand.** `H_V(S)` — the cards `V` currently holds.
2. **Own play history.** Every card `V` has played, including face-down
   plays. `V` always knows what they themselves played.
3. **Public face-up history.** Every face-up card played by anyone in
   any completed round and the in-progress round.
4. **Public face-down revelations.** Face-down trump cards that were
   flipped during round resolution (per [play_invariants.md](play_invariants.md) §T9).
   These become public at the moment of reveal.
5. **Public suit-exhaustion.** For every completed round whose led
   suit was `s`, every seat `Q` whose play to that round was off-suit
   (face-up non-`s` card, or any face-down card) is publicly known to
   hold zero cards of `s` from that point onward. (A face-down card
   establishes off-suit-ness because the closed-trump rule mandates
   face-down only when the player cannot follow.)
6. **Trumper's privileged observations** (only if `V` is the trumper):
   the identity of every face-down card `V` inspected at end-of-round
   resolution, regardless of whether it was revealed publicly. This
   includes face-down minuses by opponents and partner.

`I_V(S)` does **not** include opponents' hands, opponents' face-down
minuses (unless `V` is the trumper), or the folded trump card before
reveal (unless `V` is the trumper).

**External-team viewers** are non-trumpers; their `I_V(S)` simply
excludes clause 6. The same predicate evaluated against this smaller
information set produces the rules' "more lenient" external-caps
standard automatically — no special-casing.

## 4. Worlds

A **world** `W` is a hypothesis about every card location currently
hidden from `V`. A consistent world `W ∈ Worlds(I_V, S)` assigns:

- An identity to every card in every other seat's hand,
- An identity to every face-down completed-round entry whose value
  `V` does not directly know (clauses 4 and 6 in §3 fix the rest).

`W` is consistent with `I_V(S)` iff:

| # | Constraint |
|---|------------|
| W1 | Card conservation. The multiset of all cards across all locations in `W` equals `pack`. No card appears in two places. |
| W2 | Hand sizes. For every seat `Q ≠ V`, `len(W.hand[Q])` equals the actual hand size implied by `S` (rounds played, played-this-round flag). |
| W3 | Suit-exhaustion. For every `(Q, s)` with `Q` publicly known to be out of `s` (clause 5), no card of suit `s` appears in `W.hand[Q]`. |
| W4 | Hidden minus suit. For every face-down completed-round entry whose identity is hidden from `V`, the assigned card's suit is neither the led suit of that round nor the trump suit (the player couldn't follow, and a trump fold would have been revealed at round end — see [play_invariants.md](play_invariants.md) §S7). |
| W5 | Identity agreement. Cards `V` already knows the identity of (own hand, own plays, public face-ups, public reveals, trumper observations) appear in `W` exactly where `V` knows them to be. |

`Worlds(I_V, S)` is the set of all `W` satisfying W1–W5. It is finite
and, in practice, small once mid-game suit-exhaustion has accumulated.

The **actual world** is always a member of `Worlds(I_V, S)`. It is one
world among many.

## 5. Caps obligation

`V` is **caps-obligated** at state `S` iff:

```
Team(V) has won every round in completed_rounds(S)        (precondition)
∧ ∃ play order O over H_V(S)                              (witness)
∀ W ∈ Worlds(I_V, S)
∀ legal opponent strategy profile σ                       (adversaries)
   the playout from S, with V playing O and the other
   non-PCC-out seats playing σ, ends with Team(V) winning
   every remaining round r(S)+1 … 8.
```

`O` is a fixed permutation of `H_V(S)`. The order does not adapt to
opponent plays — when caps is called the caller exposes their hand and
states the order, so the witness is committed up front. Adaptive
strategies are not relevant: the rules require an *announced* order, so
obligation is the existence of a fixed order that survives all worlds
and all adversaries.

**On legality of the announced order.** When it is `V`'s turn within a
round, `V` plays the next card in `O`. That card must be a legal play
under the standard play rules (follow suit if able; closed-trump
face-down rules; trump-card restrictions; exhausted-trumps). If `O`
ever requires an illegal play in some world `W`, `O` is not a valid
witness in that world.

**On opponent strategies.** `σ` ranges over every legal continuation —
no notion of "reasonable" play. Caps holds only against fully
adversarial opponents, including ones who play their absolute worst
card every turn. This matches the rules' "irrespective of how any
other player chooses to play" verbatim.

**On forced opponent plays.** If a world or the rules force a unique
legal play (e.g. partner has only one card of the led suit), the
adversarial quantifier collapses to that single play. This is how
"deducible certainty via partner" works — it is not a special case in
the formalism, just a consequence of the universal quantifier ranging
over *legal* moves.

## 6. Specialisations

The same predicate, with different parameters, expresses every related
mechanic:

| Mechanic | Specialisation |
|----------|----------------|
| **Caps** (trumping team) | `V ∈ Team(Trumper)`; `I_V` includes clause 6 if `V` is the trumper. |
| **External Caps** | `V ∉ Team(Trumper)`; `I_V` excludes clause 6 (no folded-card observations). |
| **Absolute Hand** | Caps obligation evaluated at `S` = the state immediately after trump selection, before round 1 leads. The caller's information is restricted to their hand and the public bidding history (no play history yet). |
| **Claim Balance** | Replace the goal "Team(V) wins every remaining round" with "Team(V)'s final point total ≥ threshold" where threshold is the bid (for trumping team) or `304 − bid + 1` (for external). World enumeration is identical. |

Absolute Hand is therefore the round-1 case of caps; Claim Balance is
caps with a different terminal predicate. One engine, four mechanics.

## 7. The caps call

A **caps call** by `V` at state `S` consists of:

1. Declaration: `V` announces caps.
2. Hand exposure: `V` lays `H_V(S)` face up.
3. Order: `V` states a permutation `O` of `H_V(S)`.

The call is **correct** iff `V` is caps-obligated at `S` and `O`
witnesses obligation (the same `O` quantifier from §5 is satisfied).

## 8. First opportunity and timing

### 8.1 Observation events

`I_V(S)` updates only on observation events:

| Event | Affects `I_V` of |
|-------|------------------|
| Any seat plays a face-up card | All seats |
| Any seat plays a face-down card | All seats (suit-exhaustion clause 5 fires; the trumper additionally learns the identity at end-of-round) |
| Round resolution (closed trump, face-down trump in round) | All seats (revealed trumps become public); trumper additionally observes all folded card identities |
| Round resolution (closed trump, no face-down trump) | Trumper only (folded card identities) |

There are no other moments where information flows, so obligation can
only flip from False to True at these events.

### 8.2 First obligation state

`S*_V` = the earliest event-state in the actual game's history at which
`V` is caps-obligated. If no such state exists by the end of round 8,
`V` is never caps-obligated and Late Caps does not apply to `V`.

### 8.3 Timing policy

A caps call placed at state `t_call` is judged late or on-time relative
to `S*_V` by a **timing policy** — a pure function of
`(S*_V, t_call, event log)`. The obligation kernel does not depend on
the policy. Three policies are supported:

| Policy | Call is on-time iff |
|--------|---------------------|
| **Strict** | `t_call = S*_V`. The call is placed before any further observation event after `S*_V`. |
| **Lenient** (default per [rules.md](rules.md) §C-3) | No event of type "`V` plays a card" lies strictly between `S*_V` and `t_call`. `V` may call at any moment up to and including their next own-play turn after obligation arose. |
| **Unified-time** | `wall_clock(t_call) − wall_clock(S*_V) ≤ X seconds`, with `X` configurable. |

Lenient is the default for the rules engine. Strict is available for
analytical modes. Unified-time is for live UI where the hard constraint
is human reaction time.

### 8.4 Outcome mapping

Given `S*_V`, `t_call`, and the policy, the call is classified:

| Classification | Conditions |
|----------------|------------|
| **Correct** | `V` is caps-obligated at `t_call` (witnessed by the announced `O`) AND policy says on-time. Bonus applies if `r(S*_V) < 7`. |
| **Late** | `S*_V` exists, `V` is caps-obligated at `t_call`, but policy says not on-time. |
| **Wrong/Early** | `V` is not caps-obligated at `t_call`, OR `O` does not witness obligation. |
| **Missed Late** | No call was made, but `S*_V` exists and the team won all 8 rounds. Treated as Late per [rules.md](rules.md) §C-3(b). |

External-caps outcomes follow the same table against the external
information set.

## 9. Decidability and complexity

Caps obligation is decidable. Naively:

- `|Worlds(I_V, S)|` is bounded by the multinomial over the unaccounted
  cards. Mid-to-late game, suit-exhaustion typically prunes this to
  fewer than a few thousand worlds.
- For each world `W`, the inner game is a 2-player perfect-information
  zero-sum game tree (caller's order is fixed; opponents are
  collectively adversarial). Standard alpha-beta with transposition
  caching solves it in milliseconds for `|H_V| ≤ 8`.
- The outer existential quantifier over `O` ranges over `|H_V|!`
  permutations. Most prefixes are eliminated by alpha-beta: an order
  whose first card loses the next trick in any world dies immediately.

Practical complexity is driven by world count, not order count, because
world enumeration is the only super-polynomial factor that doesn't
admit aggressive pruning.

**Equivalence reductions** (deferred optimisations, not required for
correctness):

- Suit-equivalent cards (consecutive ranks in the same suit, with no
  intervening card held by anyone else) are interchangeable in any
  order or world.
- Worlds that differ only in the assignment of suit-equivalent cards
  can be collapsed.

## 10. Related work

Caps is **single-dummy claim adjudication** in the contract-bridge
sense:

- *Laws of Duplicate Bridge*, Law 70 (concession of tricks): doubt
  resolves against the claimer; the claim must succeed against any
  reasonable opposing line. 304's rule is stricter ("any line", not
  "any reasonable line").
- Frank, Basin, Bundy, *"Single-Dummy Solving"*, AAAI 1992 — the
  vanilla algorithm: enumerate consistent deals, double-dummy each,
  intersect winning strategies. This document's predicate is the
  intersection-based vanilla algorithm with the fixed-order
  restriction.
- Frank & Basin, *"Search in games with incomplete information"*,
  AIJ 1998 — discusses non-locality pathologies that affect
  *probabilistic* single-dummy. Certainty (claim) analysis is immune
  to those pathologies.
- Ginsberg, *"GIB"*, JAIR 2001 — Monte Carlo single-dummy for
  *expectation*; not directly applicable to certainty but the world-
  enumeration architecture is shared.
- Bo Haglund, *DDS* (Double Dummy Solver),
  https://github.com/dds-bridge/dds — reference for the per-world
  inner solver.

## 11. Module decomposition

The implementation is split into three modules along the seams of this
formalism:

| Module | Responsibility | Maps to |
|--------|----------------|---------|
| `info.py` | Build `I_V(S)`; enumerate `Worlds(I_V, S)` | §3, §4 |
| `dd.py` | Per-world double-dummy: does fixed order `O` win against all opponent strategies in world `W`? | inner of §5 |
| `caps.py` | Outer quantifiers; obligation tracking; timing policy; outcome classification | §5, §6, §7, §8 |

Each module is independently testable. `info.py` has no game-tree
search; `dd.py` has no information-set logic; `caps.py` orchestrates
the two and applies policy.

## 12. Out of scope for this document

- Penalty stone amounts (already in [rules.md](rules.md) §C and the
  scoring table).
- The audit/scrutiny UI for disputed calls.
- Pre-play absolute-hand declaration mechanics other than the
  predicate itself.
- Caching strategies beyond the §9 sketch.
- Heuristics for suggesting caps to a human player. The predicate is
  the source of truth; UX hints are downstream.
