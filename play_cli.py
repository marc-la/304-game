#!/usr/bin/env python3
"""Interactive terminal UI for playing 304.

Run: python play_cli.py

You control all 4 seats (or let the computer play some).
Useful for manually testing the game engine and finding bugs.
"""

import os
import random
import sys

from game304 import (
    BidAction,
    Card,
    Game,
    Match,
    Phase,
    Rank,
    Seat,
    Suit,
    Team,
    hand_points,
    next_seat,
    partner_seat,
    team_of,
)


# -- Display helpers -------------------------------------------------------

SUIT_SYMBOLS = {
    Suit.CLUBS: "\u2663",
    Suit.DIAMONDS: "\u2666",
    Suit.HEARTS: "\u2665",
    Suit.SPADES: "\u2660",
}

SUIT_COLORS = {
    Suit.CLUBS: "\033[37m",     # white
    Suit.DIAMONDS: "\033[91m",  # red
    Suit.HEARTS: "\033[91m",    # red
    Suit.SPADES: "\033[37m",    # white
}

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
RED = "\033[91m"
MAGENTA = "\033[95m"


def card_str(card, highlight=False):
    color = SUIT_COLORS.get(card.suit, "")
    sym = SUIT_SYMBOLS.get(card.suit, card.suit.value)
    prefix = BOLD if highlight else ""
    return f"{prefix}{color}{card.rank.value}{sym}{RESET}"


def hand_str(cards, numbered=False, highlight_cards=None):
    if not cards:
        return f"{DIM}(empty){RESET}"
    parts = []
    for i, c in enumerate(cards):
        hl = highlight_cards and c in highlight_cards
        s = card_str(c, highlight=hl)
        if numbered:
            s = f"{DIM}{i + 1}){RESET}{s}"
        parts.append(s)
    return "  ".join(parts)


def seat_label(seat):
    team = team_of(seat)
    color = CYAN if team == Team.TEAM_A else YELLOW
    return f"{color}{seat.value.capitalize()}{RESET}"


def phase_label(phase):
    labels = {
        Phase.DEALING_4: "Deal (4 cards)",
        Phase.BETTING_4: "Bidding (4 cards)",
        Phase.TRUMP_SELECTION: "Trump Selection",
        Phase.DEALING_8: "Deal (8 cards)",
        Phase.BETTING_8: "Bidding (8 cards)",
        Phase.PRE_PLAY: "Open or Closed Trump",
        Phase.PLAYING: "Playing",
        Phase.SCRUTINY: "Scrutiny",
        Phase.COMPLETE: "Game Over",
    }
    return labels.get(phase, phase.value)


def clear():
    os.system("cls" if os.name == "nt" else "clear")


def divider(char="\u2500", width=60):
    return f"{DIM}{char * width}{RESET}"


# -- State display ----------------------------------------------------------

def show_table(game, reveal_all=False):
    """Print the current game state."""
    state = game.state
    trump = state.trump
    play = state.play

    print()
    print(f"  {BOLD}Phase:{RESET} {phase_label(game.phase)}")
    print(f"  {BOLD}Dealer:{RESET} {seat_label(state.dealer)}")

    if trump.trumper_seat:
        trump_info = f"{seat_label(trump.trumper_seat)}"
        if trump.trump_suit and (trump.is_revealed or trump.is_open or reveal_all):
            sym = SUIT_SYMBOLS[trump.trump_suit]
            trump_info += f"  suit={BOLD}{sym}{RESET}"
        elif trump.trump_suit:
            trump_info += f"  suit={DIM}hidden{RESET}"
        if trump.is_open:
            trump_info += f"  {GREEN}OPEN{RESET}"
        elif trump.is_revealed:
            trump_info += f"  {YELLOW}REVEALED{RESET}"
        else:
            trump_info += f"  {DIM}closed{RESET}"
        if trump.trump_card and not trump.trump_card_in_hand:
            trump_info += f"  card on table: {card_str(trump.trump_card) if reveal_all else f'{DIM}[face-down]{RESET}'}"
        print(f"  {BOLD}Trump:{RESET} {trump_info}")

    # Stone
    print(f"  {BOLD}Stone:{RESET} Team A({CYAN}N/S{RESET})={state.stone[Team.TEAM_A]}  "
          f"Team B({YELLOW}E/W{RESET})={state.stone[Team.TEAM_B]}")

    if play:
        print(f"  {BOLD}Round:{RESET} {play.round_number}/8  "
              f"Points: A={play.points_won[Team.TEAM_A]}  B={play.points_won[Team.TEAM_B]}")

    # Bidding info
    if game.phase in (Phase.BETTING_4, Phase.BETTING_8) and state.bidding:
        bid = state.bidding
        if bid.highest_bid > 0:
            print(f"  {BOLD}Current bid:{RESET} {bid.highest_bid} by {seat_label(bid.highest_bidder)}")
        else:
            print(f"  {BOLD}Current bid:{RESET} {DIM}none{RESET}")

    print(divider())

    # Hands
    for seat in [Seat.NORTH, Seat.WEST, Seat.SOUTH, Seat.EAST]:
        hand = game.get_hand(seat)
        pts = hand_points(hand)
        marker = ""
        if game.whose_turn() == seat:
            marker = f"  {BOLD}{GREEN}<< YOUR TURN{RESET}"
        if state.pcc_partner_out == seat:
            marker = f"  {DIM}(sitting out - PCC){RESET}"
        print(f"  {seat_label(seat):>20}  {hand_str(hand)}"
              f"  {DIM}({pts}pts){RESET}{marker}")

    # Current round cards
    if play and play.current_round:
        print(divider())
        print(f"  {BOLD}Table:{RESET}")
        for entry in play.current_round:
            fd = f" {DIM}[face-down]{RESET}" if entry.face_down else ""
            rev = f" {MAGENTA}(revealed){RESET}" if entry.revealed else ""
            print(f"    {seat_label(entry.seat)}: {card_str(entry.card)}{fd}{rev}")

    # Last completed round
    if play and play.completed_rounds:
        last = play.completed_rounds[-1]
        print(divider())
        print(f"  {BOLD}Last round (R{last.round_number}):{RESET}  "
              f"Winner: {seat_label(last.winner)}  Points: {last.points_won}")
        for entry in last.cards:
            fd = f" {DIM}[face-down]{RESET}" if entry.face_down else ""
            rev = f" {MAGENTA}(trump!){RESET}" if entry.revealed else ""
            print(f"    {seat_label(entry.seat)}: {card_str(entry.card)}{fd}{rev}")

    print(divider())
    print()


def show_result(game):
    """Print the game result."""
    result = game.state.result
    if result is None:
        return
    print()
    print(f"  {BOLD}{'=' * 40}{RESET}")
    print(f"  {BOLD}GAME OVER{RESET}")
    print(f"  {result.description}")
    if result.winner_team:
        color = CYAN if result.winner_team == Team.TEAM_A else YELLOW
        print(f"  Winner: {color}{result.winner_team.value}{RESET}")
    print(f"  Stone: A={game.state.stone[Team.TEAM_A]}  B={game.state.stone[Team.TEAM_B]}")
    print(f"  {BOLD}{'=' * 40}{RESET}")
    print()

    # Show all rounds summary
    play = game.state.play
    if play:
        print(f"  {BOLD}Round Summary:{RESET}")
        for r in play.completed_rounds:
            cards = "  ".join(
                f"{seat_label(e.seat)}:{card_str(e.card)}"
                + (" [fd]" if e.face_down else "")
                for e in r.cards
            )
            print(f"    R{r.round_number}: {cards}  -> {seat_label(r.winner)} ({r.points_won}pts)")
        print()


# -- Input helpers ----------------------------------------------------------

def prompt(msg, valid=None):
    while True:
        try:
            val = input(f"  {BOLD}>{RESET} {msg}: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)
        if valid is None or val in valid:
            return val
        print(f"    {RED}Invalid. Choose from: {', '.join(valid)}{RESET}")


def prompt_int(msg, low=None, high=None):
    while True:
        try:
            val = input(f"  {BOLD}>{RESET} {msg}: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)
        try:
            n = int(val)
            if (low is not None and n < low) or (high is not None and n > high):
                print(f"    {RED}Must be between {low} and {high}{RESET}")
                continue
            return n
        except ValueError:
            print(f"    {RED}Enter a number{RESET}")


def pick_card(cards, msg="Pick a card"):
    print(f"  {hand_str(cards, numbered=True)}")
    idx = prompt_int(f"{msg} (1-{len(cards)})", 1, len(cards))
    return cards[idx - 1]


# -- AI player --------------------------------------------------------------

def ai_bid(game, seat):
    """Simple AI bidding strategy."""
    hand = game.get_hand(seat)
    pts = hand_points(hand)
    bidding = game.state.bidding

    if bidding.pending_partner and seat == bidding.pending_partner.partner_seat:
        # Responding to partner
        if pts >= 30:
            return BidAction.BET, max(160, bidding.highest_bid + 10)
        return BidAction.PASS, 0

    if bidding.highest_bid == 0:
        if pts >= 25:
            return BidAction.BET, 160
    return BidAction.PASS, 0


def ai_play(game, seat):
    """Simple AI play strategy — pick first valid card."""
    valid = game.valid_plays(seat)
    if not valid:
        return None
    return valid[0]


# -- Game loop --------------------------------------------------------------

def run_game(game, human_seats, auto_play_speed=0):
    """Run a single game interactively."""

    # Deal
    if game.phase == Phase.DEALING_4:
        game.deal_four()
        show_table(game)

    # Main loop
    while game.phase != Phase.COMPLETE:
        current = game.whose_turn()
        if current is None:
            break

        is_human = current in human_seats

        # -- BIDDING --
        if game.phase in (Phase.BETTING_4, Phase.BETTING_8):
            if is_human:
                show_table(game)
                print(f"  {seat_label(current)}'s turn to bid.")
                hand = game.get_hand(current)
                pts = hand_points(hand)
                print(f"  Hand ({pts}pts): {hand_str(hand)}")

                bidding = game.state.bidding
                pending = bidding.pending_partner and current == bidding.pending_partner.partner_seat
                if pending:
                    print(f"  {MAGENTA}Your partner asked you to bid!{RESET}")

                options = ["bet", "pass"]
                if not pending:
                    options.append("partner")
                    if game.phase == Phase.BETTING_8:
                        options.append("pcc")
                    # Reshuffle / redeal
                    if game.phase == Phase.BETTING_4 and pts < 15:
                        options.append("reshuffle")
                    if game.phase == Phase.BETTING_8 and pts < 25:
                        options.append("redeal")

                print(f"  Options: {', '.join(options)}")
                choice = prompt("Action", options)

                if choice == "bet":
                    val = prompt_int("Bid value")
                    try:
                        game.place_bid(current, BidAction.BET, val)
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "pass":
                    game.place_bid(current, BidAction.PASS)
                elif choice == "partner":
                    try:
                        game.place_bid(current, BidAction.PARTNER)
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "pcc":
                    try:
                        game.place_bid(current, BidAction.PCC)
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "reshuffle":
                    try:
                        game.call_reshuffle(current)
                        print(f"  {YELLOW}Reshuffle! Same dealer re-deals.{RESET}")
                        game.deal_four()
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "redeal":
                    try:
                        game.call_redeal_8(current)
                        print(f"  {YELLOW}Redeal! Dealer advances.{RESET}")
                        game.deal_four()
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
            else:
                action, val = ai_bid(game, current)
                try:
                    game.place_bid(current, action, val)
                    if action == BidAction.BET:
                        print(f"  {DIM}{seat_label(current)} bids {val}{RESET}")
                    else:
                        print(f"  {DIM}{seat_label(current)} passes{RESET}")
                except Exception:
                    game.place_bid(current, BidAction.PASS)
                    print(f"  {DIM}{seat_label(current)} passes{RESET}")

        # -- TRUMP SELECTION --
        elif game.phase == Phase.TRUMP_SELECTION:
            if is_human:
                show_table(game)
                hand = game.get_hand(current)
                print(f"  {seat_label(current)}: Select your trump card.")
                card = pick_card(hand, "Trump card")
                try:
                    game.select_trump(current, card)
                    print(f"  {GREEN}Trump set: {card_str(card)} (suit hidden){RESET}")
                except Exception as e:
                    print(f"    {RED}{e}{RESET}")
                    continue
            else:
                hand = game.get_hand(current)
                game.select_trump(current, hand[0])
                print(f"  {DIM}{seat_label(current)} selects trump{RESET}")

        # -- PRE-PLAY (open/closed) --
        elif game.phase == Phase.PRE_PLAY:
            if is_human:
                show_table(game)
                print(f"  {seat_label(current)}: Choose trump mode.")
                hand = game.get_hand(current)
                print(f"  Full hand: {hand_str(hand)}")
                options = ["open", "closed", "absolute"]
                # Spoilt trumps callable by anyone
                options.append("spoilt")
                print(f"  Options: {', '.join(options)}")
                choice = prompt("Mode", options)

                if choice == "open":
                    try:
                        game.declare_open_trump(current)
                        print(f"  {GREEN}Open Trump declared!{RESET}")
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "closed":
                    try:
                        game.proceed_closed_trump(current)
                        print(f"  {GREEN}Closed Trump — card stays face-down.{RESET}")
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "absolute":
                    try:
                        game.call_absolute_hand(current)
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
                elif choice == "spoilt":
                    try:
                        game.call_spoilt_trumps(current)
                    except Exception as e:
                        print(f"    {RED}{e}{RESET}")
                        continue
            else:
                game.proceed_closed_trump(current)
                print(f"  {DIM}{seat_label(current)} proceeds with closed trump{RESET}")

        # -- PLAYING --
        elif game.phase == Phase.PLAYING:
            if is_human:
                show_table(game)
                valid = game.valid_plays(current)
                hand = game.get_hand(current)
                print(f"  {seat_label(current)}'s turn to play.")
                print(f"  Hand: {hand_str(hand)}")
                print(f"  Valid: {hand_str(valid, numbered=True)}")

                # Extra options
                extra = []
                extra.append("spoilt")
                extra.append("caps")

                card = None
                choice_str = prompt(
                    f"Card (1-{len(valid)}) or [{'/'.join(extra)}]",
                )
                if choice_str in extra:
                    if choice_str == "spoilt":
                        try:
                            game.call_spoilt_trumps(current)
                        except Exception as e:
                            print(f"    {RED}{e}{RESET}")
                        continue
                    elif choice_str == "caps":
                        print(f"  {MAGENTA}Caps: put down all cards in order.{RESET}")
                        remaining = list(hand)
                        order = []
                        while remaining:
                            c = pick_card(remaining, f"Card {len(order)+1}")
                            order.append(c)
                            remaining.remove(c)
                        try:
                            game.call_caps(current, order)
                        except Exception as e:
                            print(f"    {RED}{e}{RESET}")
                        continue
                else:
                    try:
                        idx = int(choice_str) - 1
                        if 0 <= idx < len(valid):
                            card = valid[idx]
                        else:
                            print(f"    {RED}Invalid choice{RESET}")
                            continue
                    except ValueError:
                        print(f"    {RED}Enter a number or command{RESET}")
                        continue

                try:
                    result = game.play_card(current, card)
                    if result:
                        print(f"  {GREEN}Round {result.round_number} complete! "
                              f"Winner: {seat_label(result.winner)} "
                              f"({result.points_won}pts){RESET}")
                        if result.trump_revealed:
                            trump = game.state.trump
                            sym = SUIT_SYMBOLS.get(trump.trump_suit, "?")
                            print(f"  {MAGENTA}Trump revealed: {sym}!{RESET}")
                except Exception as e:
                    print(f"    {RED}{e}{RESET}")
                    continue
            else:
                card = ai_play(game, current)
                if card is None:
                    print(f"  {RED}AI has no valid plays!{RESET}")
                    break
                result = game.play_card(current, card)
                print(f"  {DIM}{seat_label(current)} plays {card_str(card)}{RESET}")
                if result:
                    print(f"  {DIM}  -> {seat_label(result.winner)} wins R{result.round_number} "
                          f"({result.points_won}pts){RESET}")
                    if result.trump_revealed:
                        sym = SUIT_SYMBOLS.get(game.state.trump.trump_suit, "?")
                        print(f"  {DIM}  -> Trump revealed: {sym}!{RESET}")

        else:
            break

    # Game over
    show_table(game)
    show_result(game)


def main():
    print()
    print(f"  {BOLD}{'=' * 50}{RESET}")
    print(f"  {BOLD}       304 CARD GAME — Terminal UI{RESET}")
    print(f"  {BOLD}{'=' * 50}{RESET}")
    print()
    print(f"  Teams: {CYAN}A = North + South{RESET}   {YELLOW}B = East + West{RESET}")
    print(f"  Play goes anticlockwise: N -> W -> S -> E")
    print()

    # Choose mode
    print(f"  Modes:")
    print(f"    1) Play all 4 seats (full control)")
    print(f"    2) Play as Team A (N+S), AI plays Team B (E+W)")
    print(f"    3) Play as one seat, AI plays the rest")
    print(f"    4) Watch AI vs AI")
    print()
    mode = prompt("Mode (1-4)", ["1", "2", "3", "4"])

    human_seats = set()
    if mode == "1":
        human_seats = set(Seat)
    elif mode == "2":
        human_seats = {Seat.NORTH, Seat.SOUTH}
    elif mode == "3":
        seat_choice = prompt("Which seat? (n/w/s/e)", ["n", "w", "s", "e"])
        seat_map = {"n": Seat.NORTH, "w": Seat.WEST, "s": Seat.SOUTH, "e": Seat.EAST}
        human_seats = {seat_map[seat_choice]}
    elif mode == "4":
        human_seats = set()

    seed_str = prompt("Seed (or 'r' for random)", None)
    if seed_str.lower() == "r" or seed_str == "":
        seed = random.randint(0, 999999)
    else:
        try:
            seed = int(seed_str)
        except ValueError:
            seed = random.randint(0, 999999)

    print(f"  {DIM}Seed: {seed}{RESET}")
    print()

    play_type = prompt("Single game or match? (g/m)", ["g", "m"])

    if play_type == "g":
        game = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        run_game(game, human_seats)
    else:
        match = Match(first_dealer=Seat.NORTH, rng=random.Random(seed))
        game_num = 0
        while not match.is_complete():
            game_num += 1
            print(f"\n  {BOLD}--- Game {game_num} ---{RESET}")
            print(f"  Stone: A={match.stone[Team.TEAM_A]}  B={match.stone[Team.TEAM_B]}")
            game = match.new_game()
            run_game(game, human_seats)
            cont = prompt("Continue? (y/n)", ["y", "n"])
            if cont == "n":
                break
        if match.is_complete():
            winner = match.winner()
            color = CYAN if winner == Team.TEAM_A else YELLOW
            print(f"\n  {BOLD}MATCH COMPLETE! Winner: {color}{winner.value}{RESET}")
            print(f"  Games played: {len(match.games) + 1}")


if __name__ == "__main__":
    main()
