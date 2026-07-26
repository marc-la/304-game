---
title: 304 — A real double-dummy solver (transposition tables)
status: OPEN (2026-07-26). Unblocks full-depth verification; no user-visible change.
owns: engine/dd.ts
blocks: nothing (but makes caps-par-authority's validation much stronger)
---

# Goal

Make per-world double-dummy solving fast enough to verify caps claims at
seven cards a hand. Today five cards is comfortable and seven does not
terminate.

# State of play

`engine/dd.ts` has two solvers: `orderSweepsWorld` (the caller's order is
fixed, only opponents branch) and `worldSweepsAdaptive` (the caller
chooses adaptively; every other seat, partner included, is adversarial).
Both got equivalence-class pruning this session — same-suit cards in one
hand with nothing still in play between them are strategically identical,
so only one representative is searched. That is what made five-card
positions tractable at all.

It is not enough. A seven-round position branches roughly `(7^3)^7`
before pruning, and the search explores everything whenever the caller
keeps winning. Concretely: `npm run puzzles:verify -- --date 2026-08-02
--round 1` does not finish, so the player's claim that caps holds from
round 1 there remains unverified. It was confirmed only from round 3.

# Recommended approach

Add a transposition table keyed on a canonical position: the four hands,
the leader, the cards on the table, and rounds remaining. Boolean
"caller sweeps from here" is a pure function of that, so caching is
sound. Suit symmetry is *not* available in a trump game, but rank
compression is: within a position, ranks that are no longer distinguishable
(all cards between two ranks already played) can be renumbered, which
collapses many positions onto one key.

Second lever: move ordering. For the adversary, try ruffs and higher
cards of the led suit first — those are what refute a sweep, and finding
a refutation early prunes the whole branch. For the caller, try drawing
trumps first.

Alternatives considered: porting a published DDS (large, C-shaped, and
the repo has a no-new-deps posture for the engine); Monte-Carlo sampling
instead of exact solving (unsound for a claim about *every* world, which
is the entire point).

# Validation gate

- `npm run puzzles:verify -- --date 2026-08-02 --round 1` terminates and
  returns a verdict. Any verdict — the point is that seven cards is
  reachable.
- Existing engine tests unchanged and green (149 in `engine/`).
- Spot-check: solver answers on five-card positions must be *identical*
  before and after. A transposition bug silently changes results, so
  diff a few hundred positions old-vs-new rather than trusting the suite.

# Hard constraints

- Pure TypeScript, no new dependencies, no DOM.
- `engine/` must stay free of app concerns.
- The adaptive solver's quantifier structure is load-bearing: caller
  existential, **all three** other seats universal. Partner is not an
  ally here (`caps_formalism.md` §257–262).

# Reading list

- `engine/dd.ts` — `solveCaps`, `worldSweepsAdaptive`, `reduceEquivalent`.
- `engine/play.ts` — `legalPlays`, `roundWinner`, `roundTurnOrder`.
- `tools/puzzles/verify-caps.ts` — the consumer.
