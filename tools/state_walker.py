"""Walk the state graph of a 304 play phase, step-by-step.

Designed for **manual** verification: prints a human-readable state
dump after every action so you can read through and check the engine
against the invariants in ``docs/play_invariants.md``. Can also be
imported and used programmatically — ``walk_play()`` is a generator.

Usage:
    # Auto-walk, dump every state (default policy: first valid play)
    python tools/state_walker.py --seed 42

    # Interactive: choose which valid play to make at each turn
    python tools/state_walker.py --seed 42 --step

    # Random play instead of first-valid
    python tools/state_walker.py --seed 42 --policy random

    # Quiet — show only invariant failures and the final result
    python tools/state_walker.py --seed 42 --quiet

The ``--scenario`` flag selects how the game is set up. Currently
``simple`` (WEST bids 160, all pass, closed trump). Add new scenarios
by extending ``SCENARIOS``.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from typing import Callable, Generator, Iterable

# Allow running from the repo root without installing the package
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from game304 import (  # noqa: E402
    BidAction,
    Card,
    Game,
    Phase,
    Seat,
    Team,
)
from game304.deck import create_pack  # noqa: E402
from game304.seating import next_seat, partner_seat, team_of  # noqa: E402
from game304.types import Suit  # noqa: E402


# ---------------------------------------------------------------------------
# Color & glyph helpers
# ---------------------------------------------------------------------------


# Module-level toggle. The CLI driver sets this from --color/--no-color or
# auto-detects via stdout.isatty().
USE_COLOR: bool = True

SUIT_GLYPH: dict[Suit, str] = {
    Suit.CLUBS: "♣",     # ♣
    Suit.DIAMONDS: "♦",  # ♦
    Suit.HEARTS: "♥",    # ♥
    Suit.SPADES: "♠",    # ♠
}

# Per-suit colors. Hearts and diamonds are red (traditional). Clubs are
# green and spades are bright blue, so all four suits are distinguishable
# at a glance — handy when scanning a row of cards.
SUIT_COLOR: dict[Suit, str] = {
    Suit.CLUBS: "32",      # green
    Suit.DIAMONDS: "31",   # red
    Suit.HEARTS: "31",     # red
    Suit.SPADES: "94",     # bright blue
}


def _ansi(text: str, *codes: str) -> str:
    if not USE_COLOR or not codes:
        return text
    return f"\x1b[{';'.join(codes)}m{text}\x1b[0m"


def _bold(text: str) -> str:
    return _ansi(text, "1")


def _dim(text: str) -> str:
    return _ansi(text, "2")


def _red(text: str) -> str:
    return _ansi(text, "31")


def _green(text: str) -> str:
    return _ansi(text, "32")


def _yellow(text: str) -> str:
    return _ansi(text, "33")


def _cyan(text: str) -> str:
    return _ansi(text, "36")


def _magenta(text: str) -> str:
    return _ansi(text, "35")


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def _fmt_card(
    card: Card,
    *,
    trump_suit: Suit | None = None,
    face_down: bool = False,
    width: int = 0,
) -> str:
    """Render a card as ``rank + suit-glyph``, colored by suit.

    Trump-suit cards are bolded. Face-down cards are dimmed (their identity
    is shown in the walker for verification — in real play they would be
    hidden, but the walker exists to verify engine behaviour).
    """
    rank = card.rank.value
    glyph = SUIT_GLYPH[card.suit]
    text = f"{rank}{glyph}"
    visible_width = len(text)  # one column per char in monospace fonts
    if width > visible_width:
        text = " " * (width - visible_width) + text

    codes: list[str] = []
    if face_down:
        codes.append("2")  # dim
    codes.append(SUIT_COLOR[card.suit])
    if trump_suit is not None and card.suit == trump_suit and not face_down:
        codes.append("1")  # bold for trump
    return _ansi(text, *codes)


def _fmt_cards(cards: Iterable[Card], *, trump_suit: Suit | None = None) -> str:
    return "[" + " ".join(_fmt_card(c, trump_suit=trump_suit) for c in cards) + "]"


def _fmt_seat(seat: Seat, *, current: bool = False, trumper: bool = False) -> str:
    text = seat.value
    if current and trumper:
        return _ansi(text, "1", "36")  # bold cyan
    if current:
        return _bold(text)
    if trumper:
        return _cyan(text)
    return text


def _fmt_round_entry(entry, trump_suit: Suit | None) -> str:
    face = "down" if entry.face_down else " up "
    if entry.face_down and entry.revealed:
        face_txt = _yellow(f"({face})") + " R"
    elif entry.face_down:
        face_txt = _dim(f"({face})") + "  "
    else:
        face_txt = f"({face})  "
    card_str = _fmt_card(
        entry.card, trump_suit=trump_suit, face_down=entry.face_down, width=3,
    )
    seat_str = entry.seat.value
    return f"{seat_str:5s} {card_str} {face_txt}"


def _suit_label(suit: Suit) -> str:
    return _ansi(SUIT_GLYPH[suit], SUIT_COLOR[suit], "1")


def format_state(g: Game, *, original_folded: Card | None = None) -> str:
    """Return a multi-line human-readable rendering of the game state."""
    s = g.state
    lines: list[str] = []
    lines.append(_dim("=" * 72))
    pcc_str = s.pcc_partner_out.value if s.pcc_partner_out else "no"
    lines.append(
        _bold(f"PHASE: {s.phase.value}")
        + f"    DEALER: {_bold(s.dealer.value)}"
        + f"    PCC: {pcc_str}"
    )
    lines.append(_dim("=" * 72))

    # Trump
    t = s.trump
    if t.trump_suit:
        if t.is_open:
            mode = _green("OPEN")
        elif t.is_revealed:
            mode = _yellow("CLOSED, revealed")
        else:
            mode = _dim("CLOSED, not revealed")
        if t.trump_card:
            folded = _fmt_card(t.trump_card, trump_suit=t.trump_suit)
        else:
            folded = _dim("(played)")
        in_hand = _dim(" (in trumper's hand)") if t.trump_card_in_hand else ""
        trumper_str = _cyan(t.trumper_seat.value) if t.trumper_seat else "-"
        lines.append(
            f"trump: {_suit_label(t.trump_suit)} ({mode})    "
            f"trumper: {trumper_str}    "
            f"folded: {folded}{in_hand}"
        )

    # Play state
    p = s.play
    if p:
        turn_seat = p.current_turn
        priority_seat = p.priority
        priority_str = (
            _bold(priority_seat.value) if priority_seat else "-"
        )
        turn_str = _bold(turn_seat.value) if turn_seat else "-"
        lines.append(
            f"round: {_bold(str(p.round_number))}/8    "
            f"priority: {priority_str}    "
            f"turn: {turn_str}    "
            f"points: A={p.points_won[Team.TEAM_A]} / B={p.points_won[Team.TEAM_B]}"
        )

    # Hands
    lines.append("")
    lines.append(_bold("hands:"))
    current_turn = p.current_turn if p else None
    for seat in (Seat.NORTH, Seat.WEST, Seat.SOUTH, Seat.EAST):
        hand = list(s.hands.get(seat, []))
        is_trumper = t.trumper_seat == seat
        is_pcc_out = s.pcc_partner_out == seat
        is_turn = seat == current_turn
        tag = []
        if is_trumper:
            tag.append(_cyan("TRUMPER"))
        if is_pcc_out:
            tag.append(_dim("PCC-OUT"))
        tagstr = f" [{', '.join(tag)}]" if tag else ""
        sorted_hand = sorted(hand, key=lambda c: (c.suit.value, c.power))
        seat_label = _fmt_seat(seat, current=is_turn, trumper=is_trumper)
        marker = _yellow("→") if is_turn else " "
        lines.append(
            f"  {marker} {seat_label:5s} ({len(hand)}){tagstr}: "
            f"{_fmt_cards(sorted_hand, trump_suit=t.trump_suit)}"
        )

    # Current round
    if p and p.current_round:
        lines.append("")
        lines.append(_bold("current round (in progress):"))
        for entry in p.current_round:
            lines.append(f"  {_fmt_round_entry(entry, t.trump_suit)}")
        led_face_up = next((e for e in p.current_round if not e.face_down), None)
        if led_face_up:
            lines.append(f"  led suit: {_suit_label(led_face_up.card.suit)}")

    # Completed rounds — last 2 only, to keep output compact
    if p and p.completed_rounds:
        lines.append("")
        recent = p.completed_rounds[-2:]
        lines.append(
            _bold(f"completed rounds (last {len(recent)} of {len(p.completed_rounds)}):")
        )
        for r in recent:
            head = (
                f"  R{r.round_number}: winner={_bold(r.winner.value)}, "
                f"pts={r.points_won}"
            )
            if r.trump_revealed:
                head += _yellow("  [trump revealed here]")
            lines.append(head)
            for entry in r.cards:
                lines.append(f"    {_fmt_round_entry(entry, t.trump_suit)}")

    # Stone & result
    lines.append("")
    lines.append(
        f"stone: A={s.stone[Team.TEAM_A]} / B={s.stone[Team.TEAM_B]}"
    )
    if s.result:
        lines.append(_bold(f"result: {s.result.description}"))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Invariant checks
# ---------------------------------------------------------------------------


def _all_played_entries(g: Game):
    p = g.state.play
    if p is None:
        return []
    out = []
    for r in p.completed_rounds:
        out.extend(r.cards)
    out.extend(p.current_round)
    return out


def check_card_conservation(g: Game) -> str | None:
    """S1 — every card in exactly one location, total = 32, no dupes."""
    locations: list[Card] = []
    for hand in g.state.hands.values():
        locations.extend(hand)
    if g.state.trump.trump_card is not None:
        locations.append(g.state.trump.trump_card)
    locations.extend(e.card for e in _all_played_entries(g))
    expected = set(create_pack())
    actual = set(locations)
    if len(locations) != 32:
        return f"card count is {len(locations)}, expected 32"
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        return f"set mismatch: missing={missing} extra={extra}"
    if len(actual) != len(locations):
        # Duplicates
        seen, dupes = set(), set()
        for c in locations:
            if c in seen:
                dupes.add(c)
            seen.add(c)
        return f"duplicate cards: {dupes}"
    return None


def check_hand_sizes(g: Game) -> str | None:
    """S2 — hand size formula (during PLAYING) and empty-hand at terminal."""
    p = g.state.play
    if p is None:
        return None
    if g.phase != Phase.PLAYING:
        # Post-play: every active seat's hand should be empty;
        # PCC-out seat keeps its frozen 8 cards.
        for seat, hand in g.state.hands.items():
            if g.state.pcc_partner_out == seat:
                if len(hand) != 8:
                    return f"post-play PCC-out {seat.value} has {len(hand)} (expected 8)"
            else:
                if len(hand) != 0:
                    return f"post-play {seat.value} has {len(hand)} (expected 0)"
        return None
    r = p.round_number
    played_seats = {e.seat for e in p.current_round}
    for seat, hand in g.state.hands.items():
        if g.state.pcc_partner_out == seat:
            if len(hand) != 8:
                return f"PCC-out seat {seat.value} has {len(hand)} cards (expected 8)"
            continue
        played_now = 1 if seat in played_seats else 0
        on_table = (
            seat == g.state.trump.trumper_seat
            and g.state.trump.trump_card is not None
            and not g.state.trump.trump_card_in_hand
        )
        expected = (9 - r) - played_now
        actual = len(hand) + (1 if on_table else 0)
        if actual != expected:
            return (
                f"{seat.value}: hand+folded={actual}, expected {expected} "
                f"(r={r}, played_now={played_now}, on_table={on_table})"
            )
    return None


def check_round_structure(g: Game) -> str | None:
    """S3 — round bounds and completed-round counts."""
    p = g.state.play
    if p is None:
        return None
    if not (1 <= p.round_number <= 8):
        return f"round_number {p.round_number} out of [1, 8]"
    expected_per_round = 3 if g.state.pcc_partner_out else 4
    if not (0 <= len(p.current_round) <= expected_per_round):
        return f"current_round size {len(p.current_round)} out of [0, {expected_per_round}]"
    if len(p.completed_rounds) != p.round_number - 1 and g.phase == Phase.PLAYING:
        return (
            f"completed_rounds count {len(p.completed_rounds)} != "
            f"round_number-1 ({p.round_number - 1})"
        )
    for r in p.completed_rounds:
        if len(r.cards) != expected_per_round:
            return f"R{r.round_number} has {len(r.cards)} cards, expected {expected_per_round}"
    return None


def check_priority_turn(g: Game) -> str | None:
    """S4 — current_turn matches expected anticlockwise position."""
    p = g.state.play
    if p is None or g.phase != Phase.PLAYING:
        return None
    if p.priority is None or p.current_turn is None:
        return "priority or current_turn is None during PLAYING"
    if not p.current_round:
        if p.current_turn != p.priority:
            return f"k=0 but current_turn ({p.current_turn.value}) != priority ({p.priority.value})"
        return None
    last_seat = p.current_round[-1].seat
    expected = next_seat(last_seat)
    if g.state.pcc_partner_out == expected:
        expected = next_seat(expected)
    if p.current_turn != expected:
        return f"current_turn={p.current_turn.value}, expected {expected.value}"
    return None


def check_pcc_frozen(g: Game, frozen_hand: list[Card] | None) -> str | None:
    """S11 — PCC-out seat hand is frozen and never appears in plays."""
    pcc = g.state.pcc_partner_out
    if pcc is None:
        return None
    if frozen_hand is None:
        return None
    actual = sorted(g.state.hands.get(pcc, []), key=str)
    expected = sorted(frozen_hand, key=str)
    if actual != expected:
        return f"PCC-out seat {pcc.value} hand changed"
    for entry in _all_played_entries(g):
        if entry.seat == pcc:
            return f"PCC-out seat {pcc.value} appears in a round"
    return None


def check_points_sum(g: Game) -> str | None:
    """S9 — points sum equals total of cards in completed rounds."""
    p = g.state.play
    if p is None:
        return None
    completed_total = sum(
        sum(e.card.points for e in r.cards) for r in p.completed_rounds
    )
    points_total = p.points_won[Team.TEAM_A] + p.points_won[Team.TEAM_B]
    if completed_total != points_total:
        return f"points_won sum {points_total} != completed-round total {completed_total}"
    return None


def check_trumper_face_down_legality(g: Game, original_folded: Card | None) -> str | None:
    """S8 — trumper's face-down plays are folded-trump-card or non-trump suit."""
    t = g.state.trump
    if t.trumper_seat is None or t.trump_suit is None:
        return None
    for entry in _all_played_entries(g):
        if entry.seat != t.trumper_seat:
            continue
        if not entry.face_down:
            continue
        if entry.card.suit != t.trump_suit:
            continue  # non-trump face-down (minus) — fine
        # Face-down trump-suit by trumper — must be the originally-folded card
        if original_folded is None:
            # Unknown — skip (caller didn't provide)
            continue
        if entry.card != original_folded:
            return (
                f"trumper folded an in-hand trump {entry.card} "
                f"in R{ -1 if False else ''}"  # placeholder; we don't track round here
            )
    return None


def check_trump_state_consistency(g: Game) -> str | None:
    """S6 — exactly one of the three trump configurations holds.

    Allows a transient mid-round state: the trumper has played the
    folded trump card as a face-down cut to the in-progress round, but
    the round has not yet resolved. ``trump_card`` is None and
    ``is_revealed`` is still False until round resolution flips it.
    """
    t = g.state.trump
    if t.trump_suit is None and t.trumper_seat is None:
        return None  # trump not set yet
    if t.trump_suit is None or t.trumper_seat is None:
        return "trump_suit/trumper_seat partially set"
    if t.is_open and not t.is_revealed:
        return "is_open but not is_revealed"
    if t.is_open and not t.trump_card_in_hand and t.trump_card is not None:
        return "is_open but folded trump still on table"
    if t.trump_card_in_hand and t.trump_card is not None:
        return "trump_card_in_hand=True but trump_card is not None (should be cleared)"

    # Closed pre-reveal AND trump_card is None: legitimate iff the
    # folded trump card was just played as a cut to the in-progress round.
    if not t.is_revealed and not t.is_open and t.trump_card is None:
        p = g.state.play
        cut_in_progress = (
            p is not None
            and any(
                e.seat == t.trumper_seat
                and e.face_down
                and e.card.suit == t.trump_suit
                for e in p.current_round
            )
        )
        if not cut_in_progress:
            return "Closed pre-reveal but folded trump card is None"
    return None


def all_invariants(
    g: Game,
    *,
    original_folded: Card | None = None,
    frozen_pcc_hand: list[Card] | None = None,
) -> list[tuple[str, str | None]]:
    """Run every invariant; return [(name, failure_msg or None)]."""
    return [
        ("S1 card conservation", check_card_conservation(g)),
        ("S2 hand sizes", check_hand_sizes(g)),
        ("S3 round structure", check_round_structure(g)),
        ("S4 priority/turn", check_priority_turn(g)),
        ("S6 trump state", check_trump_state_consistency(g)),
        ("S8 trumper face-down", check_trumper_face_down_legality(g, original_folded)),
        ("S9 points sum", check_points_sum(g)),
        ("S11 PCC frozen", check_pcc_frozen(g, frozen_pcc_hand)),
    ]


def format_invariants(results: list[tuple[str, str | None]]) -> str:
    fails = [(n, m) for n, m in results if m is not None]
    total = len(results)
    if not fails:
        return _green(f"invariants: {total}/{total} PASS")
    passed = total - len(fails)
    out = [
        _bold(_red(f"invariants: {passed}/{total} PASS, {len(fails)} FAIL"))
    ]
    for name, msg in fails:
        out.append(_red(f"  ✗ {name}: {msg}"))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Scenarios — set up a Game ready to enter the play phase
# ---------------------------------------------------------------------------


def build_scenario_simple(seed: int) -> Game:
    """Simple scenario: WEST bids 160, others pass, closed trump."""
    g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
    g.deal_four()
    g.place_bid(Seat.WEST, BidAction.BET, 160)
    for s in (Seat.SOUTH, Seat.EAST, Seat.NORTH):
        g.place_bid(s, BidAction.PASS)
    # Trumper picks first card in hand as trump
    g.select_trump(Seat.WEST, g.get_hand(Seat.WEST)[0])
    for s in (Seat.WEST, Seat.SOUTH, Seat.EAST, Seat.NORTH):
        g.place_bid(s, BidAction.PASS)
    g.proceed_closed_trump(Seat.WEST)
    return g


def build_scenario_open(seed: int) -> Game:
    """Open Trump scenario: WEST bids 160, others pass, declares Open Trump."""
    g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
    g.deal_four()
    g.place_bid(Seat.WEST, BidAction.BET, 160)
    for s in (Seat.SOUTH, Seat.EAST, Seat.NORTH):
        g.place_bid(s, BidAction.PASS)
    g.select_trump(Seat.WEST, g.get_hand(Seat.WEST)[0])
    for s in (Seat.WEST, Seat.SOUTH, Seat.EAST, Seat.NORTH):
        g.place_bid(s, BidAction.PASS)
    g.declare_open_trump(Seat.WEST)
    return g


SCENARIOS: dict[str, Callable[[int], Game]] = {
    "simple": build_scenario_simple,
    "open": build_scenario_open,
}


# ---------------------------------------------------------------------------
# Walker (importable generator)
# ---------------------------------------------------------------------------


Policy = Callable[[Game, Seat, list[Card]], Card]


def policy_first(_g: Game, _seat: Seat, valid: list[Card]) -> Card:
    return valid[0]


def policy_random(rng: random.Random) -> Policy:
    def _p(_g: Game, _seat: Seat, valid: list[Card]) -> Card:
        return rng.choice(valid)
    return _p


def _ptk_select(seat: Seat, valid: list[Card], trump_suit: Suit | None) -> Card:
    """Click-or-arrow-key selection of a card via prompt_toolkit.

    Mouse clicks select the card. Arrow keys + Enter also work. Esc
    cancels and returns the first valid card (the default). The card
    list is rendered with ANSI color via ``prompt_toolkit.ANSI``, so the
    same suit colors as the rest of the walker show up in the dialog.
    """
    from prompt_toolkit.shortcuts import radiolist_dialog
    from prompt_toolkit.formatted_text import ANSI

    values = [
        (card, ANSI(_fmt_card(card, trump_suit=trump_suit)))
        for card in valid
    ]
    result = radiolist_dialog(
        title=f"{seat.value}'s turn",
        text="Pick a card  (click, or ↑↓ + Enter — Esc = default)",
        values=values,
        default=valid[0],
    ).run()
    return result if result is not None else valid[0]


def policy_interactive(g: Game, seat: Seat, valid: list[Card]) -> Card:
    """Interactive prompt — click a card, arrow-key + Enter, or Esc for default.

    Falls back to text entry if ``prompt_toolkit`` is not available.
    """
    trump_suit = g.state.trump.trump_suit
    print(
        f"\n{_bold('>>>')} {_bold(seat.value)}'s turn. Valid plays: "
        f"{_fmt_cards(valid, trump_suit=trump_suit)}"
    )
    try:
        chosen = _ptk_select(seat, valid, trump_suit)
        print(_dim(f"    chose {_fmt_card(chosen, trump_suit=trump_suit)}"))
        return chosen
    except (ImportError, ModuleNotFoundError):
        pass

    # Fallback: text entry
    while True:
        s = input("    pick a card (Enter = first valid): ").strip()
        if s == "":
            return valid[0]
        try:
            c = Card.from_str(s)
        except ValueError:
            print(_red(f"    cannot parse {s!r}; try again"))
            continue
        if c not in valid:
            print(_red(f"    {s} is not a valid play; try again"))
            continue
        return c


def walk_play(
    g: Game,
    policy: Policy = policy_first,
) -> Generator[dict, None, None]:
    """Yield a dict for every play step until the game leaves PLAYING.

    Each yielded dict contains:
        - ``before``: snapshot string of state before the action
        - ``seat``: who acted
        - ``card``: card played
        - ``valid``: full list of valid plays at the time
        - ``completed_round``: the resolved CompletedRound, or None
        - ``after``: snapshot string of state after the action
    """
    while g.phase == Phase.PLAYING:
        seat = g.whose_turn()
        valid = g.valid_plays(seat)
        if not valid:
            yield {"error": f"empty valid_plays for {seat.value}"}
            return
        before = format_state(g)
        chosen = policy(g, seat, valid)
        completed = g.play_card(seat, chosen)
        after = format_state(g)
        yield {
            "before": before,
            "seat": seat,
            "card": chosen,
            "valid": valid,
            "completed_round": completed,
            "after": after,
        }


# ---------------------------------------------------------------------------
# CLI driver
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--scenario", choices=list(SCENARIOS), default="simple",
    )
    parser.add_argument(
        "--policy", choices=("first", "random"), default="first",
        help="how to choose among valid plays (ignored if --step)",
    )
    parser.add_argument(
        "--step", action="store_true",
        help="interactive: prompt for each play",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="suppress per-step state dumps; show only invariant failures",
    )
    color_group = parser.add_mutually_exclusive_group()
    color_group.add_argument(
        "--color", action="store_true", default=None,
        help="force ANSI color output (default: auto-detect TTY)",
    )
    color_group.add_argument(
        "--no-color", action="store_true",
        help="disable ANSI color output",
    )
    args = parser.parse_args()

    # Resolve color preference
    global USE_COLOR
    if args.no_color:
        USE_COLOR = False
    elif args.color:
        USE_COLOR = True
    else:
        USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None

    g = SCENARIOS[args.scenario](args.seed)

    # Snapshot the originally-folded trump card (for S8 invariant check)
    original_folded = g.state.trump.trump_card
    # Snapshot PCC-out hand if any (for S11 invariant check)
    frozen_pcc = (
        list(g.state.hands.get(g.state.pcc_partner_out, []))
        if g.state.pcc_partner_out
        else None
    )

    print(_bold(_magenta("INITIAL STATE")))
    print(format_state(g, original_folded=original_folded))
    results = all_invariants(
        g, original_folded=original_folded, frozen_pcc_hand=frozen_pcc,
    )
    print()
    print(format_invariants(results))

    if args.step:
        policy: Policy = policy_interactive
    elif args.policy == "random":
        policy = policy_random(random.Random(args.seed))
    else:
        policy = policy_first

    step_no = 0
    for step in walk_play(g, policy):
        step_no += 1
        if "error" in step:
            print(f"\n!!! ERROR at step {step_no}: {step['error']}")
            return 2

        seat = step["seat"]
        card = step["card"]
        completed = step["completed_round"]

        print()
        card_str = _fmt_card(card, trump_suit=g.state.trump.trump_suit)
        print(_magenta(f"--- step {step_no}: {seat.value} plays ") + card_str + _magenta(" ---"))
        if completed:
            tag = _yellow("  [trump revealed]") if completed.trump_revealed else ""
            print(
                f"    "
                + _green(
                    f"R{completed.round_number} resolved: "
                    f"winner={completed.winner.value}, points={completed.points_won}"
                )
                + tag
            )
        if not args.quiet:
            print(step["after"])
        results = all_invariants(
            g, original_folded=original_folded, frozen_pcc_hand=frozen_pcc,
        )
        if any(m for _, m in results):
            print()
            print(format_invariants(results))
            print(_dim("    (continuing despite invariant failure — read state above)"))
        elif not args.quiet:
            print()
            print(format_invariants(results))

    print()
    print(_dim("=" * 72))
    print(_bold(_magenta("GAME COMPLETE")))
    print(_dim("=" * 72))
    if g.state.result:
        print(_bold(f"result: {g.state.result.description}"))
    print(f"stone : A={g.state.stone[Team.TEAM_A]} / B={g.state.stone[Team.TEAM_B]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
