"""Simple deterministic bot for the 304 card game.

The :class:`Bot` class implements minimal heuristics suitable for an
opponent that follows the rules but does not strategise. It is
designed to be subclassed: a future ``StrongBot`` could plug a
double-dummy solver into :meth:`Bot.choose_play`, or richer bidding
heuristics into :meth:`Bot.choose_bid`, without touching call sites.

Heuristics
----------
- :meth:`choose_bid` — always pass. Simple bots never bid.
- :meth:`choose_trump` — longest suit, highest-power card. Used only
  if the bot somehow becomes the trumper (shouldn't happen with
  always-pass bidding, but the method is implemented for safety so
  the engine doesn't deadlock if the rules ever route a bid to a bot).
- :meth:`choose_play` — if a led suit exists and the bot can follow,
  play the highest-power card of that suit; otherwise (leading or
  unable to follow), play the lowest-power valid card.
- :meth:`choose_pre_play` — always Closed Trump.
- Caps / spoilt trumps / absolute hand / redeals / pass-ons: not
  invoked. The bot defers these to the engine and human players.

Orchestration
-------------
:func:`auto_play_bots` advances a :class:`Game` by performing every
bot action until it's a human's turn (or the game ends). The caller
is responsible for the initial ``deal_four`` — subsequent dealing is
handled inside the engine by ``select_trump``.
"""

from __future__ import annotations

from collections import Counter

from game304.card import Card
from game304.game import Game
from game304.types import BidAction, Phase, Seat, Suit


class Bot:
    """Simple deterministic bot for 304.

    One instance per bot-occupied seat. Stateless across actions —
    every decision is a function of the current ``Game`` state.

    Args:
        seat: The seat this bot occupies.
        name: Human-readable name (for logs / UI). Defaults to
            ``f"Bot ({seat.value})"``.
    """

    def __init__(self, seat: Seat, name: str | None = None) -> None:
        self.seat = seat
        self.name = name or f"Bot ({seat.value})"

    # ------------------------------------------------------------------
    # Decision functions
    # ------------------------------------------------------------------

    def choose_bid(self, game: Game) -> tuple[BidAction, int]:
        """Return the action and (for ``BET``) the value to bid.

        Simple bots always pass.
        """
        del game
        return (BidAction.PASS, 0)

    def choose_trump(self, game: Game) -> Card:
        """Pick the highest-power card from the bot's longest suit.

        Tie-break: count, then suit value (deterministic).
        """
        hand = game.get_hand(self.seat)
        if not hand:
            raise ValueError(
                f"choose_trump called with empty hand for {self.seat.value}"
            )
        suit_counts: Counter[Suit] = Counter(c.suit for c in hand)
        target_suit = max(
            suit_counts, key=lambda s: (suit_counts[s], s.value),
        )
        suit_cards = [c for c in hand if c.suit == target_suit]
        # Lower power index = stronger card.
        return min(suit_cards, key=lambda c: c.power)

    def choose_pre_play(self, game: Game) -> str:
        """Return ``'open'`` or ``'closed'``. Always closed for simple bots."""
        del game
        return "closed"

    def choose_play(self, game: Game) -> Card:
        """Pick a card to play during the play phase.

        Heuristic:
        - If there's a led suit and the bot has a valid card of that
          suit, play the highest-power one.
        - Otherwise (leading, or cannot follow), play the lowest-power
          valid card.

        Validity is determined by :meth:`Game.valid_plays`, which
        already filters for follow-suit / exhausted-trumps / trumper
        restrictions, so the bot never picks an illegal card.
        """
        valid = game.valid_plays(self.seat)
        if not valid:
            raise ValueError(
                f"choose_play called with no valid plays for {self.seat.value}"
            )

        led_suit = _led_suit_from_game(game)
        if led_suit is not None:
            matching = [c for c in valid if c.suit == led_suit]
            if matching:
                return min(matching, key=lambda c: c.power)

        return max(valid, key=lambda c: c.power)


def _led_suit_from_game(game: Game) -> Suit | None:
    """Return the led suit for the in-progress round, or ``None``.

    The led suit is the suit of the first face-up card played. In
    closed trump, face-down cards don't reveal their suit; the bot
    only sees what's public.
    """
    play = game.state.play
    if play is None:
        return None
    for entry in play.current_round:
        if not entry.face_down and entry.card is not None:
            return entry.card.suit
    return None


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def auto_play_bots(game: Game, bots: dict[Seat, Bot]) -> int:
    """Advance ``game`` by playing every bot turn until a human acts.

    Walks the phase machine: applies the appropriate bot decision in
    each phase (bid, trump, pre-play choice, card play), stopping when
    the seat to act is *not* in ``bots`` or the game completes.

    The caller is responsible for the *initial* ``deal_four`` for a
    new game — that's a one-shot setup, not part of any seat's turn.
    Within ``auto_play_bots`` we don't deal; the engine's
    ``select_trump`` handles dealing the second 4 cards internally.

    Args:
        game: The active game (mutated in place).
        bots: Mapping from bot-occupied seats to ``Bot`` instances.

    Returns:
        The number of bot actions performed.

    Raises:
        RuntimeError: If the loop fails to terminate within a safe
            guard (indicates an engine bug).
    """
    actions = 0
    guard = 200
    while guard > 0:
        guard -= 1
        phase = game.phase

        if phase in (Phase.COMPLETE, Phase.SCRUTINY):
            return actions

        # During DEALING_4 (e.g. just after a pass-on reset), deal so
        # bidding can proceed. There's no per-seat turn yet.
        if phase == Phase.DEALING_4:
            game.deal_four()
            actions += 1
            continue

        # DEALING_8 shouldn't normally appear here (select_trump deals
        # internally) but handle defensively if a caller routes through
        # this helper after a Phase.DEALING_8 transition.
        if phase == Phase.DEALING_8:
            game.deal_eight()
            actions += 1
            continue

        turn_seat = game.whose_turn()
        if turn_seat is None:
            return actions
        if turn_seat not in bots:
            return actions  # human's turn

        bot = bots[turn_seat]
        if phase in (Phase.BETTING_4, Phase.BETTING_8):
            action, value = bot.choose_bid(game)
            game.place_bid(turn_seat, action, value)
        elif phase == Phase.TRUMP_SELECTION:
            card = bot.choose_trump(game)
            game.select_trump(turn_seat, card)
        elif phase == Phase.PRE_PLAY:
            choice = bot.choose_pre_play(game)
            if choice == "open":
                game.declare_open_trump(turn_seat)
            else:
                game.proceed_closed_trump(turn_seat)
        elif phase == Phase.PLAYING:
            card = bot.choose_play(game)
            game.play_card(turn_seat, card)
        else:
            return actions

        actions += 1

    raise RuntimeError("auto_play_bots: guard limit exceeded")
