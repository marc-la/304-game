---
title: 304 — Soul & Constitution
status: living document
purpose: bind every implementation decision for 304 and 304dle to the psychological, cultural, and tempo-based texture that makes the game alive.
---

> *"What is missing from my 304 game and 304dle application is soul."*

This document exists because the rules of 304 are a husk. They describe what cards do; they do not describe what *playing* 304 feels like. Anyone implementing a 304 product — engine, AI, daily puzzle, replay tool — must first internalize this constitution. **Where a design decision is consistent with the rules but inconsistent with the soul, the soul wins.**

This is not a description of 304. It is the **psychological, cultural, and tempo-based contract** that any 304 artifact must honor.

---

## I. The Heart

304 is psychological warfare disguised as a trick-taking game. The cards are real, the suits matter, the tricks score — but the *game* is happening in the gap between what each player sees, what they let on, and what they bet. To play 304 well is to:

- read four people simultaneously (your partner, two opponents, yourself),
- compress that reading into a single integer bid,
- defend or attack that bid for 8 cards,
- and live with the result — psychologically — for the rest of the session, sometimes the rest of the year.

The soul of 304 is not the trump suit. It is the **bluff–deduction–tempo–memory–compass–grace** stack stretched over a Tamil-South-Asian table tradition that survived a civil war, a migration, and a UWA dormitory.

---

## II. Origin & Cultural Texture

304 was taught to Marc by **V2 (Vithusayan)**, a Tamil Sri Lankan friend whose family plays it at family gatherings — though *not* with the rigour the friend group has built around it. The game is believed to have been played by Tamil freedom fighters during the Sri Lankan civil war. V2's family fled the country a few generations ago partly because of that conflict.

This matters constitutionally:

- 304 is a **living immigrant tradition**, not a museum artifact. Implementations should feel inherited and current, not ethnographic.
- The friend-group's version is a **codification** of a casual family game into a tournament-grade ruleset, complete with stone, punishments, and (notoriously) whiteboard notation.
- Aggression, pride, and what Marc calls *"traditional Tamil masculine ideals"* are part of the texture. The game **semi-rewards hubris** — strongmanning the opposition is a real and viable strategy until it isn't. Do not sanitize this.

The defining cultural moment: **the UWA Reid library whiteboard.** The friend group invented their own *"304 notation"* in whiteboard markers — squiggles for wins, losses, caps, bets, bettors, penalties — and played 3 revolutions over 9 hours. By sundown, looking at the board, Marc thought:

> *"Nobody other than us in this university would understand what is on this whiteboard."*

That whiteboard is the cultural seed of 304dle.

---

## III. Foundational Principles

These bind every implementation decision.

### 1. Information asymmetry is the fuel.
What is hidden, what is leaked, and what is deduced — this is the entire skill axis. Anything that flattens information (showing all hands, "helpful" prompts, elimination-style affordances) destroys the game. The **possible-worlds counter** in 304dle exists to *visualize the asymmetry without removing it.*

### 2. Tempo is meaning.
Fast play means certain play. Slow play means burden. A bot that places cards at uniform delay has no voice. Tempo is the **only legal speech act** between partners — and the most legible signal to opponents. Implementations that ignore tempo strip out the majority of the game.

### 3. The compass is the language of mastery.
After 7 years, the friend group has internalised a hand-class → bid *tendency* so worn-in that *deviation* from it is what feels brave or stupid (see §V). Any 304 product should respect and surface this compass and let it develop — not try to teach an idealised "correct" 304. The compass is descriptive habit, not prescription.

### 4. The game is ruthless. Grace is invented.
Base 304 is brutal: −2 for losing a bid vs. +1 for winning, hubris rewarded, no floor on hand misery. The **<25 reshuffle rule** is a *house rule of grace* — Marc and friends explicitly invented it because base 304 was too cruel. **Implementations must not paper over this.** When 304dle stings, it is supposed to. When it forgives, it forgives *deliberately*, the way a house rule does.

### 5. Cards have provenance.
The **4-petal flower** (each card placed straight from the player's perspective) preserves who played what within a trick. The **two neat stacks** of round-piles preserve the entire game's history, so any hand can be reconstructed afterward. Provenance is not decoration — it is how scrutiny, blame, and learning operate post-hand.

### 6. Caps is the apex puzzle.
The single hardest cognitive moment in 304 is correctly calling caps mid-hand against a partial information set spanning multiple suits. *Even masters struggle here.* **304dle exists to extract this moment into a daily ritual.** Everything else in 304dle is scaffolding for the caps call.

### 7. Soul over interpretation.
When this constitution conflicts with a literal reading of the rules, the constitution wins. Anyone implementing should write what is *interesting*, not what is *minimally consistent with the rules.*

---

## IV. The Texture

Each subsection captures *what makes 304 alive* in that dimension and *what that means for design.*

### IV.1 The Feel of a Hand

You pick up the first 4. **Hangover from the previous round colors everything** — a recent argument, a lambasting, a bad call still echoes. If your hand is below 15 and reshuffle is available, there is a small joy in **throwing it down and watching the table sigh** (because someone else had a strong hand they will now lose). If you are first, or your partner is first, it is *"like white in chess"* — a small structural edge.

A strong hand brings **anticipation, not relief.** Questions cascade: *What does my partner have? What do the opposition have? Why are they fidgeting / feigning disinterest / hurrying the deal so they don't have to play their awful hand?* **Concealment is its own labor.** Hiding that you have nothing is sometimes harder than hiding that you have everything.

> **Design implication.** First impressions of a hand — by player, by bot — must be unreadable from the surface. Bots should have idle micro-behaviors (fidgeting, hurrying, slow-placing) that are partly tells, partly noise. The player should *feel surveilled.*

### IV.2 Veteran vs. Novice

A veteran has seen most of the 32C4 first-quartets that exist. Reading a hand is *workflow*, not analysis. The compass fires before the conscious mind. The novice is fogged: *"is A higher or lower than 9?"* — burdened by ruleset, with no strategy yet. A little bit of fog over the game; bets are less dialed in.

> **Design implication.** 304dle should *develop* the compass, not teach it. Daily exposure to canonical hand-class → action mappings is how the compass gets built. The puzzle's structure should reward pattern recognition that compounds over time.

### IV.3 Alive vs. Dead Hands

- **Alive:** lots of jacks, strong trumping support.
- **Dead on arrival:** four-way split in the first 4 cards, no support, 30–40 points (above reshuffle floor but powerless), *"a sad state of affairs"* — concealing that you have nothing is tough.

> **Design implication.** 304dle puzzle hands should be *alive by construction* — caps-callable, support present. Dead hands are a real-game phenomenon but not a puzzle phenomenon.

### IV.4 The Bidding Drama

Reasons to escalate a bid:
- **Bluff** — strongmanning weaker opponents.
- **Rage** — grievance from a previous round where someone underbet.
- **Intimidation** — believing your partner is strong, bullying for territory.
- **Commitment** — *"I have the best 4 cards, I have to go 100."*
- **Mechanical compass** — see §V.

Socially, **overbidding** is either a sign of dominance or evidence the previous bidder underplayed — *"like an arms race"*, except in some hands there is no arms race at all (no bids). **Passing a strong hand** is a gamble: hope your partner has support, fish for stone given, but risk the reshuffle.

The iconic bad bid: a player stares at their hand for a long time, deliberates publicly, and makes the *risky honest, risky 250, or once-in-a-blue-moon risky PCC.* **Their fate is already sealed in the opposition's hands long before their bet.** Devastation arrives, but the lasting damage is the post-game *"what were you thinking?!"* — the partner's lambasting, *"you should know better, that was an overbet."*

There are **psychological cycles.** Winning streaks raise average bets. Recent big losses cause conservative retreat — underbetting, less rigorous info-set tracking, more fog. Mood and history are state.

> **Design implication.** In 304dle the bid is implicit — assume someone bet, the position is set up just before the first card is played. But the *feeling* of post-game scrutiny should be encoded in the loss state: redeal of the same hand is the *"what were you thinking?"* loop, asking you to confront the same problem until you solve it.

### IV.5 The Trump Reveal

The reveal moment matters because it is **anticipation crystallized.** Suspicions are confirmed or denied. A weak trumper is about to be destroyed. An opposition that has pried trump out previously discovers their power has evaporated. The reveal cuts many ways. Some have *tried cutting and missed*; that, too, is a moment.

**Open Trump** changes less than one might think. It is mostly a signal that the opposition is *about to be destroyed* — open trump tends to be called when one side has already locked in dominance.

> **Design implication.** The reveal in 304dle should have weight — animation, timing, a beat. Not a flat state change.

### IV.6 Partnership: The Silent Conversation

Explicit communication is **forbidden.** What remains is the repertoire of permissible non-words:

- *Lead choice* (which suit, which card)
- *Discard order*
- *Tempo of pull, deliberation, place* — every micro-second is a sentence
- *Where you look* (an obvious stare can ask for a play)
- *How you flick the trump card on a cut*
- *The mannerisms players accumulate as personal tells*

Misreading a partner's signal *exacerbates self-doubt* — *"how skillful am I really?"* — the cognitive cost is not just the trick lost.

**Trust is built across sessions, not within a hand.** Winning streaks, brilliant plays, accumulated form.

> **Design implication.** Bot partners and opponents in 304dle must communicate via tempo, lead choice, and (where animated) micro-mannerisms. Even in solo play, the table should feel populated by readable people, not anonymous opponents. Poker-library-style placement animations are a viable starting point.

### IV.7 Memory & the Information Set

32 cards is **not enumerable** by a human in real time. Each player adopts a partial scheme:

- **Top 4 of each suit** (A, K, Q, J) account for ~92% of points (71/76). Many players track only these.
- **Trump count** — number of trump cards still out.
- **Per-pile point count** — to know whether a minused card matters.

A game can be **decided by a single minused card**, and the loser may not know until the very end. A tracking player will *signal* their win out of courtesy — rather than ride out the suspense.

**Reading your own hand discreetly is itself a skill.** Visible reactions to your cards are a tell that reshapes everyone else's bidding. Poker face.

The hand "solves itself" when the situation collapses to *all trump, high of suit*, etc. — the master sees this earlier than the rest of the table.

> **Design implication.** The **possible-worlds counter** in 304dle is the formal, machine-tractable expression of this exact cognitive labor. As cards are played, the counter ticks down. The player must call caps when the counter has *converged enough* to justify the call. **This is the fundamental loop.**

### IV.8 Risk Archetypes & The Action Line

There are **risk takers** and **conservatives.** Currently the meta favors the conservative because of the **+1 / −2 asymmetry**: risk-taking teams lose more on average. But over a 10-stone bracket, luck dominates — sometimes a strong hand persists for one team for 1–2 rounds with no counterplay.

The line between bravery and stupidity is the **internalised compass** (§V) — not a written rule, but a tendency the group has drifted toward over years. Falling below it is stupid roughly **2/3 of the time.**

> **Design implication.** 304dle scoring (where any exists) should respect this asymmetry — calling caps wrong should hurt more than calling caps right rewards. Tension comes from this gradient.

### IV.9 Tempo & Ritual

**Shuffle.** 2 slap shuffles (1–3 acceptable). Pull-from-middle, slap-on-top.
**Cut.** Offered to the left player. *Tap = no cut.*
**Deal.** Anticlockwise from the dealer's right, in batches of 4.
**Bid timing.** Players bet on first 4. If they accept their position, they pick up the second 4.
**Call-out quirk.** Players are so deep in thought they often forget to bid; you have to **say their name** to provoke them. This is part of the social rhythm — and a funny quirk worth preserving in spirit.

**Tempo within a hand:**
- *Speed up:* certain plays, sticky 9s (pulled by opposition jacks), useless hands, disinterest.
- *Slow down:* critical decisions, large unknowns, large decision spaces (e.g. opposition leading early-game), and **caps calls** — always nail-biting, always slow.

**Between hands:** scoring (sometimes in a book, sometimes in stone), banter, scrutiny of who lost it, re-litigation of plays. The two neat stacks of round-piles are maintained throughout the game so the whole hand can be **reconstructed.** (The friend group used to alternate-stack to prevent mixing; they have since moved past that — two stacks suffice.)

> **Design implication.** 304dle must encode tempo as a first-class behavior, not a cosmetic delay. Bots should fast-place certainty and slow-place difficulty. The deal animation should batch-of-4 in correct direction. The previous round should *linger* on the table to be re-read.

### IV.10 Mastery & Elegance

The master is **predictable to their partner and unpredictable to the opposition.** The beginner asks *"what went again?"* — the master never has to.

Elegant play looks **effortless and intentional.** A jack minused on a random round, later revealed to be calculated. Each card placed with reason. The same card played without that intent is *materially equivalent but not elegant* — and over many plays, will not be consistent.

> **Design implication.** 304dle should reward elegance — a successful caps call from a well-tracked info set should *feel* like the kind of play that gets retold. The animation, the moment of claim, the reveal of the remaining hand — should give the player a **"that was beautiful"** beat.

### IV.11 The Sting of Loss

- **Loss by luck**, averaged over 3 hours: bad. Blame attaches anyway. Tiredness, off-day excuses surface.
- **Loss by inattention**: drags partner down, partner *resents you for eternity.*
- **Wrong caps call**: shame comparable to *blundering a piece in chess.*
- **Lost high bet (250, PCC) by overreach**: painful — *unless* it was a bet-or-die suicide-run situation, in which case forgiven.

Hubris is **semi-rewarded.** The aggro-strongman line works until it doesn't. The inflection from rewarded confidence to punished overbet is one of 304's defining arcs.

> **Design implication.** 304dle's loss state must sting *appropriately to cause.* Wrong-caps loss should feel like blundering a piece. Random unlucky loss (if any) should feel different — and probably shouldn't exist in a well-curated puzzle stream at all.

### IV.12 Iconic Moments (the canon)

The shared mythology of the friend group:

- **The whiteboard** at UWA Reid library. 9 hours, 3 revolutions, *"304 notation"* in squiggles. Sundown realization that nobody else on campus could read it.
- **The suicide run.** Opposition is at 1 stone to give. They must give and bet aggressively, or die. *A flourish of risky gambles.* One of the game's purest emotional shapes.
- **The risky honest / risky 250 / once-in-a-blue-moon risky PCC** that *should not have been made.*
- **The clean PCC.** Pure-luck PCC feels *dirty but necessary.* Tactical PCC, or one earned by an opposition blunder, feels deserved — *fitting for 5 stone.*
- **The minused card** that decides a 3-hour revolution in its closing seconds.

These are the canon. Any 304 product should be aware of them and aspire to *generate* moments like them.

---

## V. The Compass (Internalised Tendency)

The compass is **not a rulebook** and not a solemn guide. It is the **internalised tendency** the friend group has drifted toward over 7 years of play — a hand-class → bid mapping so worn-in that it fires before conscious thought. Deviation from it is what *feels* brave or stupid, but the compass itself is descriptive of habit, not prescriptive of correctness.

The sketch below is **non-prescriptive and non-exhaustive** — a partial cross-section of the compass, not its full surface.

| Hand class | Tendency |
|---|---|
| 3 trump + J on 4 | 60 / 70 |
| 4 trump + J | higher |
| Strong 4 trump + J | 100 |
| 2 constraints on 8 (e.g. 5 trump + J + 2 constraints) | honest |
| 1 constraint | 250 (sometimes PCC) |
| J9A suited / J9A10 suited | 100 |

**Felt as wrong / off-key:** 90, honest 15–20.

**Adjustment:** *"1 extra round"* — the tendency shifts depending on whether you or your partner is first.

This is not a universal 304 truth — it is **this group's compass, built over 7 years of play.** Other tables drift toward different compasses. The point is that *every serious 304 group internalises one*, and respect for the local compass is what separates serious play from hobbyist play.

> **Design implication.** 304dle puzzle generation should respect plausible compass-shaped setups. Hands should look like ones a compass-tuned player would recognise as worth playing — without enforcing the compass as a "correct answer."

---

## VI. The 304dle Translation

This is where the constitution does its hardest work. Solo play strips out partnership, bidding, opposition, table feel. The question is not *"how do we faithfully simulate 304?"* It is *"which souls survive the cut, which die, and which must be **replaced** with single-player analogues that capture the feel?"*

### VI.1 What 304dle Strips

- **Bidding.** No bid is taken. The puzzle assumes a bid was already placed and the position is set up just before the first card is played.
- **Partnership social fabric.** Your partner sits across, but they cannot lambaste you, scrutinize you, or build trust with you over sessions.
- **Opposition mind games.** No human opponent is fidgeting at you across the table.
- **Stone economy.** Abstracted away.

These are *real losses.* Do not pretend otherwise. Do not invent fake partner banter to compensate.

#### VI.1.1 Bidding & Trumper-Choice Are Curatorial Decisions, Not Live Mechanics

Two collapses worth naming explicitly, since they have no live representation in the puzzle:

1. **No bidding phase.** Real 304 has 4-card and 8-card bidding rounds where the trumper is *won* through a contested speech sequence. 304dle skips this entirely — the puzzle starts at "first card about to be played." The drama of *"can I bet 100 here? will partner support me? is east bluffing?"* is replaced by the drama of the puzzle itself (curated to be hard-callable).

2. **Trumper identity is fixed by the curator, not by the player.** In current v1 the trumper is *always south*. This is a deliberate simplification — the player always knows their seat and their role. Future curated puzzles may vary the trumper seat as a difficulty/scenario knob (e.g., "you are partner; trumper is north; deduce caps as a non-trumper"), but until that lands, south-is-trumper is the constant.

3. **Trump suit and trump card are also curatorial.** They come from the curator's world-fuzzing pipeline, not from a heuristic at deal time. The legacy `dealForSeed` heuristic (longest-suit, alphabetical tie-break) exists only as a fallback for the year-file generator — for curated puzzles the trump is selected to make the puzzle interesting.

The visible UI must reflect these collapses *honestly*:

- The trump chip shows *"Your Trump ♠"* — naming both the suit and the trumper-of-record (south). It does NOT show a separate "folded card" image, because no fold occurs in our model: the trump card stays in south's hand (`trumpCardInHand: true`). Showing a folded-card icon would be a polite lie about a mechanic that doesn't fire.
- The trump card itself is gold-bordered in south's hand — that is the honest visual cue: *"this is the card whose suit defines trump, and yes, you can still play it."*
- When the curator generalises trumper-seat in a future v2, the chip should expand to *"Trumper: West ♠"* (or similar) so the player always knows who holds the bid and what suit they committed.

### VI.2 What 304dle Preserves

- **Tempo.** Bots play with tempo — fast on certainty, slow on burden. This is the *single most important* preserved behavior.
- **The 4-petal flower.** Cards are placed straight from each player's perspective so provenance within a trick is preserved.
- **Round-pile build-up.** As tricks are won, the round piles grow on each side. Visible state.
- **Last-round lingering.** The previous trick remains visible long enough to be re-read — you can recall what just went.
- **The information set as the central mental object.** The **possible-worlds counter** is the visible spine of the puzzle. It ticks down with each card played.
- **Caps as the apex.** The whole puzzle is structured around correctly calling caps.
- **The pressure-to-call.** As the worlds counter narrows and the hand dwindles, the player feels *"I need to call caps now."* This is the central tension.
- **Spatial layout.** Partner across, opposition left/right. The table.
- **Curated-but-realistic deal.** Initial deal animates in batches of 4, then the trumper folds a card with a quick animation. Seamless, not a drag.

### VI.3 What 304dle Replaces

- **Partnership silence → bot tells, animated card placement, tempo.** The bots' tempo and (where possible) their card-placement style become the *only* speech act on the table.
- **Bidding drama → curated starting positions.** Every position is constructed so that *the cap is callable* — *"when, not if."* This replaces the bid's drama with the puzzle's drama.
- **Loss sting → redeal of the same hand.** A failed run does not get a friendly *"try again with a new puzzle."* It gets the **same hand again.** You don't escape it; you confront it. This is the constitutional analogue of post-game scrutiny.
- **Opponents' physicality → poker-library-style placement animations** (slow place, quick snap, hesitation, etc.) where bots have personality through tempo alone.

### VI.4 The Single-Player Virtue

> **Fast deduction under tempo.**

Not leisurely puzzles. Not chess problems. The puzzle is a **3–5 minute pressurized deductive sprint** with the following texture:

- The player watches their hand dwindle as cards are laid.
- The possible-worlds counter ticks down with each play.
- Bots place at the tempo of real 304 (sticky 9s fast, freighted plays slow).
- The player must call caps **at the right moment** — not too early (insufficient information, guessing); not too late (window closed).
- A timer measures total time spent.
- A wrong call → redeal the same starting position.

**Rewarded:** fast pattern recognition, info-set tracking, tactful timing.
**Punished:** guessing, drift, brute-forcing.
**Forbidden:** any UI affordance that lets the player solve it by elimination-of-options without remembering. The cognitive labor must remain *theirs.*

A **good caps call** is one where the player needed to remember **many components** of the information set across multiple suits. A puzzle that can be solved by tracking only one suit is too easy — that is, in fact, the difficulty knob.

The puzzle should **rush the player without explicitly rushing them.** No countdown bars. No "hurry up!" copy. Tempo and the worlds counter do that work, the way a real table does.

### VI.5 The Forbidden List

304dle must NEVER become:

1. **A casual card game.** It is a daily ritual, not a pastime.
2. **A tutorial.** No hand-holding hints, no "did you forget about the J of hearts?" prompts.
3. **Skinned poker.** Tempo and tells are borrowed; the genre is not.
4. **A retelling of the rules.** The rules live in `site/rules.html` (player-facing) and `apps/304dle/` (interactive UX) — see [`.claude/directory.md`](directory.md). This file is the soul.
5. **Sanitized.** Base 304 is ruthless. House rules introduce grace deliberately. Grace is a *choice*, not a default.
6. **Impatient in the wrong way.** It must rush the player *without explicitly rushing them.*
7. **Generic deduction.** It is specifically *304-shaped* deduction — trump, suits, partnership-line plays, caps. A general-purpose card-puzzle engine will lose the soul.

---

## VII. How to Use This Document

### For Claude (and any future implementer)

Before any 304 / 304dle feature, ask:

1. **Tempo:** does the feature respect tempo as meaning, or flatten it?
2. **Provenance:** are cards / piles / signals traceable in the way they are at a real table?
3. **Tension:** does it build pressure toward the caps call, or release it prematurely?
4. **Ruthlessness vs. grace:** if it softens 304, is the softening a deliberate house-rule choice, or accidental?
5. **Information set:** does it preserve the player's cognitive labor, or shortcut it?
6. **Cultural respect:** does it treat 304 as a living tradition (V2 / Tamil / immigrant), or as an exoticized artifact?
7. **Interestingness:** is this *interesting*, or merely *minimally consistent with the rules?*

If a feature fails any of these, redesign or reject.

### For Marc

When making implementation choices, default to the answer that has **more tension, more psychological texture, more respect for the compass, and more soul** — even when the rule-mechanical answer is shorter.

---

> *"Nobody other than us in this university would understand what is on this whiteboard."*
> — UWA Reid Library, sundown.
