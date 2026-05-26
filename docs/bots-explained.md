---
title: 304 Bots, Explained
purpose: A plain-English introduction to the eight 304 bots, written for 304 players (not programmers). Companion to the technical docs at docs/bots/.
audience: anyone curious how the puzzle-generation and tournament bots actually "think"
---

# Why we have bots at all

The 304dle puzzles you play aren't hand-written. They're produced by simulation: four computer players sit down and play 304 against each other thousands of times, and any game where one team sweeps all 8 rounds becomes a candidate puzzle. The strongest one of the four players is the one whose *caps moment* gets curated into the puzzle you eventually see.

So the quality of 304dle puzzles depends directly on **how strong the bots are**. A weak bot will sweep a round-table only when the hand is overwhelmingly strong — boring puzzles. A strong bot will sweep on subtler hands where the caps moment requires real deduction — interesting puzzles. We need a range of bots, from "embarrassing" to "near-master," for two reasons:

1. **Puzzle calibration.** We can grade a puzzle's difficulty by which bots could and couldn't have called caps from its starting position.
2. **Benchmark.** We need a strong bot to be the puzzle generator. The way to *know* a bot is strong is to pit it against weaker bots and watch it win consistently. That's the tournament.

Every bot here plays *deterministically*: give it the same situation twice, it makes the same choice. That's important — it means puzzles are reproducible, ratings are stable, and there's no "I got unlucky" excuse for the bot.

---

# The eight bots, as player archetypes

Each bot has a name, a play style, and (where it's been measured) an ELO rating. ELO is the same number system used in chess: higher is stronger, and every ~100 points of difference roughly means the higher-rated player wins about 64% of games head-to-head. We anchor the scale at 1500.

## B0 — Random ("The Toddler")

**ELO ~1336.**

Plays a legal card chosen by coin-flip. Doesn't think about winning the trick, doesn't track what's been played, doesn't even prefer keeping high cards. The only rule it knows is *follow suit if you can*; everything else is noise.

Why include it? It's the floor. If a "smarter" bot can't reliably beat a random player, that's a problem we want to know about. Random anchors the scale.

## B1 — High-Low ("The Beginner Who's Played a Few Hands")

**ELO ~1515.**

A small step up: it actually tries to win the trick when it can.

- If it can play a card that wins the in-progress trick *as it stands*, it plays the cheapest such card.
- If it can't win, it drops its lowest-points card.

That's it. It doesn't remember what's been played, doesn't read its partner, doesn't preserve stars for later. But it captures the most basic instinct — "take the trick if you can; throw rubbish if you can't" — and that's enough to crush a random player.

## B2 — Memo High-Low ("The Casual Player Who Watches the Cards")

**ELO ~1500.**

Same play style as B1, but now it remembers what's already been played. Two extra abilities fall out of that memory:

- It won't waste a J leading when the suit is exhausted and the J would have walked away later anyway.
- It won't waste a star (J / 9 / A) to sluff to partner when a lower card achieves the same thing.

Surprisingly close to B1 in rating, despite the memory upgrade. The reason: most of the value in card-memory is realized through *combined* deduction (matching memory against opponents' voids), and B2 doesn't do that yet — see B4 for that.

## B3 — Heuristic ("The Competent Intermediate")

**ELO ~1510.**

Now we have real strategy. B3 has a bunch of hand-tuned rules learned from watching strong 304 play:

- **Star-spend thresholds**: don't play a J on a trick worth less than 18 points (the J alone is 30); don't play a 9 unless the trick has ≥10 points on it; don't play an A unless ≥8. Below the threshold, sluff something cheaper instead.
- **Partner-aware sluffing**: if my partner is already winning the trick, throw my lowest card — and prefer to keep stars even within ties.
- **Cut when rich**: if I can't follow the led suit, I'm holding 2+ trumps, and the trick is worth ≥10 points, cut with a small trump.
- **Lead longest non-trump**: when I'm leading, lead from my longest non-trump suit with a low card, forcing opponents to spend their stars to win cheap tricks.

This is roughly the level of a serious player who's been at the table for a few months. It's the original engine bot from earlier work; the new bot zoo wraps it as B3 for backwards comparison.

## B4 — InfoSet 1-Ply ("The Reader of the Hand")

**ELO ~1567.**

First bot that actually reasons about *what opponents probably hold*. It builds an "information set" — formally, the set of possible hands consistent with everything that's been played so far. Then it samples up to 32 possible worlds from that set, simulates this one trick under each, and picks the play whose average outcome is best across the sample.

What does "average outcome" mean? Just: how many points does my team gain or lose on this trick? Win the trick → +points. Lose it → −points.

This is the first bot that benefits from opponents being *void in suits*. If I can deduce that east has no diamonds left, I can play diamonds with confidence knowing east can't cut. B4 gets that for free from its sampling — worlds where east has a diamond get rejected, leaving only the worlds that match the public record.

The downside: B4 only thinks one trick ahead. It doesn't consider that winning *this* trick might cost it the next two.

## B5 — CSP Search ("The Caps-Aware Tactician")

**ELO ~1572.**

Two upgrades over B4:

1. **Two tricks ahead instead of one.** Same sampled-worlds reasoning, but it considers the consequences of who-wins-the-current-trick on the next trick too.
2. **Caps awareness.** B5 knows about caps. If it's playing the trumper position and caps is *currently obligated* from this state, it plays the engine's witness-line first card — the canonical play that walks the rest of the hand into a guaranteed sweep. This is essentially perfect play once caps is on the table.

The "CSP" in the name refers to a Constraint Satisfaction Problem solver — the way the engine figures out whether caps is callable involves treating opponent hands as constrained variables and exhaustively checking that a winning strategy exists in every consistent world.

B5 is the strongest bot currently in the tournament rotation (B6 and B7 exist but are too slow to include — see below).

## B6 — DDS Monte Carlo ("The Bridge Expert")

**Speed: ~10–30 seconds per move at the opening.** ELO not yet measured at tournament scale because it would take many hours.

This is the bot inspired by computer bridge. The technique is called *Perfect-Information Monte Carlo* (or PIMC) and it works like this:

1. Sample several "what could the deal possibly be?" worlds from the information set.
2. For each sampled world, pretend you can see *everyone's* cards (this is the "double dummy" assumption — DDS = Double Dummy Solver).
3. With full visibility, solve the rest of the game optimally — what's the best my team can score from here?
4. Average across the sampled worlds. Pick the candidate play with the highest average.

This is how serious bridge programs play. It's strong: in principle, B6 should beat B5 in head-to-head play because it sees deeper. In practice we haven't confirmed this because B6 is too slow to run a meaningful tournament.

Slow why? At the opening of an 8-card-per-seat game, the "full game tree" has hundreds of millions of nodes. Even with shortcuts, evaluating a single move means doing this expensive search for every candidate card under every sampled world.

## B7 — Bridge-Derived ("The B6 Variant Inspired by GIB")

**Speed: ~5–15 seconds per move at the opening.**

Same algorithm as B6 with one twist borrowed from the Ginsberg's-Intelligent-Bridge (GIB) work in the early 2000s: instead of evaluating all candidate moves against the *same* set of sampled worlds, B7 samples fresh worlds for each candidate move. The idea is that the world sample shouldn't be biased toward one move's strengths.

In practice this trades B6's transposition-cache reuse (which speeds up evaluating multiple moves against one world) for sample diversity (which reduces evaluation bias). Whether it's stronger than B6 is unclear without measurement.

---

# The current leaderboard

After a short tournament with 10 games per pairing (the production tournament defaults to B0..B5; B6 and B7 are excluded by speed):

| Rank | Bot | Rating | Speed (per move at opening) |
|---|---|---|---|
| 1 | CSP Search (B5) | ~1572 | 30–80 ms |
| 2 | InfoSet 1-Ply (B4) | ~1567 | 5–15 ms |
| 3 | High-Low (B1) | ~1515 | ~50 µs |
| 4 | Heuristic (B3) | ~1510 | ~150 µs |
| 5 | Memo High-Low (B2) | ~1500 | ~100 µs |
| 6 | Random (B0) | ~1336 | ~10 µs |

The ratings are still noisy at this sample size (the confidence interval is about ±37 points) so the B1/B2/B3 cluster could easily reorder with more games.

What's interesting:

- **The big jump from B0 to B1.** Just "try to win the trick" is worth ~180 ELO over random.
- **The small cluster B1/B2/B3.** These three rule-based bots are all within ~15 points of each other. The hand-tuned heuristics in B3 don't help nearly as much as you'd expect — there's a "ceiling" for what you can do without info-set reasoning.
- **The jump to B4.** Once a bot starts reading opponent voids and exhaustions, it gains ~50–60 ELO. This is the first big payoff of *thinking about what opponents might hold*.
- **B5 barely beats B4.** The two-tricks-ahead upgrade is small; the caps-awareness override matters mostly at the very end of a sweep, not in the middle of the game.

---

# How the bots are used

There are two places these bots show up:

### 1. The tournament (`tools/bots/elo/`)

The bots play round-robin against each other, every pairing playing many games. Each game is one full 8-round 304 with a fixed bid of 160 (no bidding phase — see [tournament protocol details](bot-speed-handoff.md)). The trumper-seat rotates across games so each team trumps half the time. Ratings are computed using Glicko-2 (the modern descendant of ELO; same intuition, but tracks uncertainty too).

This is the *open trump* tournament — every game is played face-up. There is no closed-trump tournament yet; the closed-trump-bot in `tools/curator/` is used only for puzzle generation, not for benchmarking.

### 2. Puzzle generation (`tools/puzzles/`)

When generating 304dle puzzles, four copies of one bot play many games against each other with rules-faithful shuffling between games (the slap-shuffle that real 304 uses, not a uniform-random shuffle). Most games go nowhere — neither side sweeps. The interesting ones are the sweep games, where one team takes all 8 rounds. For each sweep, we compute *when* that team's information set first guaranteed the sweep — that's the caps moment, and that's the puzzle.

The bot doing the playing matters here: stronger bots produce more interesting puzzles because they exploit subtler caps opportunities. The current closed-trump puzzle pipeline uses the heuristic closed-trump-bot (the closed-trump version of B3). Upgrading this to a closed-trump version of B5 or B6 is an open project — see [`docs/bot-speed-handoff.md`](bot-speed-handoff.md) and the closed-trump audit notes.

---

# Why don't we just use the strongest bot for everything?

Because B6 takes ~10 seconds per move and there are 32 moves per game and we need thousands of games per puzzle batch. That's hours per puzzle.

The pragmatic ladder is:

- **Quick puzzle batches**: use B3 (sub-millisecond per move). Quality is OK; lots of puzzles.
- **Tournament rankings**: use B0..B5 (all finish a 50-game tournament in minutes).
- **High-quality puzzle batches**: use B5 if you have ~10 minutes per puzzle to spare.
- **Reference strongest play**: use B6 if you have all night.

The work to make B6 fast enough for tournaments is ongoing — there's a [separate handoff doc](bot-speed-handoff.md) tracking it.

---

# Glossary

- **ELO / Glicko-2**: number system for ranking players. Higher = stronger. 100 points = roughly 64% win rate head-to-head.
- **Information set**: in any imperfect-information game, this is the set of possible "true states of the world" that look identical from one player's perspective. In 304, your information set is everything you can deduce from your own hand plus the cards that have been played.
- **PIMC / DDS / Double Dummy**: techniques borrowed from computer bridge. "Double dummy" means "imagine all four hands are face-up"; "PIMC" means "sample several plausible deals, double-dummy each, average the results."
- **Witness line**: in a caps-callable position, the specific sequence of plays that demonstrates the sweep. Not the only winning line, but one that works in every world consistent with the information set.
- **Sluff**: throw a low card you don't care about, usually because you can't win the trick or your partner is winning it.
- **Cut**: play a trump card when you can't follow the led suit, attempting to win the trick by trump-power.
- **Star** (cards): J, 9, A — the three highest-value cards in any suit (30, 20, 11 points respectively). The other cards are worth ≤10.
- **Heuristic**: a hand-tuned rule of thumb. Cheap to evaluate, not provably optimal, but usually pretty good.
- **Sample**: a single "what if the hidden cards were dealt this way?" hypothesis, drawn from the set of all hypotheses consistent with what you know.

---

# Where to read more

- [`docs/bots/`](bots/) — the auto-generated per-bot technical pages with strengths, limitations, big-O complexity, and (when available) measured ratings and head-to-head tables.
- [`docs/bot-speed-handoff.md`](bot-speed-handoff.md) — the engineering plan to make B6 fast enough to actually use.
- [`engine/bots/`](../engine/bots/) — the source code if you want to see exactly what each bot does.
