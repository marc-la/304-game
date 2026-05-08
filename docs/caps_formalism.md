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
checks "given the actual hands, does the caller have a winning
strategy?" is **double-dummy** analysis on the actual deal: it tells
you whether an omniscient observer sees a sweep, not whether the
candidate caller can deduce one. The correct test is **single-dummy**:
in *every* deal consistent with what the player knows, does the
caller have a (possibly deal-dependent, adaptive) strategy that wins?
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
∧ ∀ W ∈ Worlds(I_V, S)
   ∃ adaptive strategy σ_W : Histories → LegalPlays_V     (per-world witness)
∀ legal opponent strategy profile τ                       (adversaries)
   the playout from S, with V playing σ_W against τ and
   the other non-PCC-out seats playing τ, ends with
   Team(V) winning every remaining round r(S)+1 … 8.
```

The witness is **adaptive** and **per-world**: for each world `W`
consistent with `V`'s information, there exists a strategy σ_W — a
function from observed play history (in this game, from `S` onward) to
`V`'s next legal card — that wins every remaining round against every
adversarial completion. Different worlds may be witnessed by different
strategies. Within a world, σ_W may branch on what opps reveal as play
unfolds.

This is the standard adaptive (single-dummy strategy stealing safe)
formulation `∀W ∃σ_W` — strictly stronger than the pre-2026 fixed-order
definition `∃O ∀W`, which required one permutation `O` to win in every
world. The set inclusion is trivial (a fixed order is a degenerate
adaptive strategy); strictness comes from the standard min-max
swap. There exist 304 states that are caps-obligated under `∀W ∃σ_W`
but not under `∃O ∀W` — typically when `V`'s optimal next play depends
on a discard or follow that hasn't been observed yet (e.g. symmetric
blockers across two suits when opps are void in those suits).

**Legality.** σ_W must always select a card legal under the standard
play rules (follow suit if able; closed-trump face-down rules;
trump-card restrictions; exhausted-trumps). A "strategy" that ever
requires an illegal play in some reachable history is not a valid
witness.

**On opponent strategies.** `τ` ranges over every legal continuation —
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

**On the announced "demonstration line."** When `V` calls caps at the
table, they expose their hand and may state *one* line of play for
clarity. That line is a single trace through some witnessing σ_W — not
a binding commitment. If opps play differently than the demonstration
line anticipates, `V` continues with whatever σ_W (or σ_{W'}, if the
opp play eliminates a world) prescribes. Scrutiny verifies the
*existence* of a covering family `{σ_W}`, not the prescience of any
single trace.

**On the relationship to "deducible certainty."** Adaptive does not
weaken the certainty test. `V` still cannot rely on partner *choice*;
σ_W may only branch on observations of cards actually played. Where
partner's play is forced by the rules (only one legal card), σ_W may
condition on that forced play just as it would on any other legal
move. Where partner has discretion, σ_W must succeed against every
legal partner choice (partner is bound by `τ` for the obligation
test).

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
3. Demonstration line (optional but customary): `V` states one line of
   play they would play out — equivalently, one trace through a
   witnessing strategy under some plausible opp continuation.

The call is **correct** iff `V` is caps-obligated at `S` per §5 (a
covering family `{σ_W}` exists). The demonstration line is a clarity
device, not part of the obligation predicate; opp play during the
called sequence is not constrained to follow the line, and `V` is not
bound to it. Scrutiny adjudicates by exposing all hands and checking
whether some adaptive strategy survives every world consistent with
what `V` could see at `S`, against every legal opp continuation.

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
| **Correct** | `V` is caps-obligated at `t_call` (a covering `{σ_W}` exists per §5) AND policy says on-time. Bonus applies if `r(S*_V) < 7`. |
| **Late** | `S*_V` exists, `V` is caps-obligated at `t_call`, but policy says not on-time. |
| **Wrong/Early** | `V` is not caps-obligated at `t_call` (some `W` admits no winning σ_W against some legal opp continuation). |
| **Missed Late** | No call was made, but `S*_V` exists and the team won all 8 rounds. Treated as Late per [rules.md](rules.md) §C-3(b). |

External-caps outcomes follow the same table against the external
information set.

## 9. Decidability and complexity

Caps obligation is decidable. Under the adaptive `∀W ∃σ_W` formulation:

- `|Worlds(I_V, S)|` is bounded by the multinomial over the unaccounted
  cards. Mid-to-late game, suit-exhaustion typically prunes this to
  fewer than a few thousand worlds.
- For each world `W` independently, the inner question is a 2-player
  perfect-information zero-sum game tree (`V` adaptive, opps
  collectively adversarial). Standard alpha-beta with transposition
  caching solves "does `V` have a winning strategy in `W`?" in
  milliseconds for `|H_V| ≤ 8`. This is equivalent to a per-world
  double-dummy "`V` can sweep" check.
- The outer quantifier collapses to a per-world existence check: caps
  holds iff every consistent world admits its own winning strategy. No
  outer permutation enumeration is required (compare the pre-2026
  fixed-order definition, which forced a `|H_V|!` outer search for a
  single permutation that worked in every world).

The adaptive formulation is therefore *strictly easier* to compute
than the fixed-order one: it removes the outer existential quantifier
over orders entirely. World enumeration remains the only
super-polynomial factor.

**Equivalence reductions** (deferred optimisations, not required for
correctness):

- Worlds that differ only in the assignment of suit-equivalent cards
  (consecutive ranks in the same suit, with no intervening card held
  by anyone else) can be collapsed.
- Within a world, transposition tables across symmetric subgames cut
  the per-world search.

## 10. Related work

Caps is **single-dummy claim adjudication** in the contract-bridge
sense:

- *Laws of Duplicate Bridge*, Law 70 (concession of tricks): doubt
  resolves against the claimer; the claim must succeed against any
  reasonable opposing line. 304's rule is stricter ("any line", not
  "any reasonable line").
- Frank, Basin, Bundy, *"Single-Dummy Solving"*, AAAI 1992 — the
  vanilla algorithm: enumerate consistent deals, double-dummy each,
  intersect winning strategies. This document's predicate is exactly
  the intersection-based vanilla algorithm: caps holds iff every
  world's double-dummy says `V` has a winning strategy. Adaptive (per
  world) is the natural — and computationally simpler — formulation;
  the pre-2026 fixed-order variant added an outer `∃O` that the 2026
  rules revision dropped.
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
| `dd.py` | Per-world double-dummy: does `V` have a winning adaptive strategy in world `W` against all opp strategies? | inner of §5 |
| `caps.py` | Outer ∀-over-worlds quantifier; obligation tracking; timing policy; outcome classification | §5, §6, §7, §8 |

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
