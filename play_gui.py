#!/usr/bin/env python3
"""GUI for testing the game304 engine.

Run:  python play_gui.py

Zero dependencies beyond Python stdlib (tkinter).
Controls all 4 seats so you can exercise every code path.
"""

import random
import tkinter as tk
import tkinter.font as tkfont
from tkinter import scrolledtext

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

# -- Detect available fonts ---------------------------------------------------

def _pick_font(candidates, fallback="TkDefaultFont"):
    """Return the first font family from candidates that exists on the system."""
    available = set(tkfont.families())
    for c in candidates:
        if c in available:
            return c
    return fallback


# -- Constants ----------------------------------------------------------------

# Text labels for suits (ASCII fallback if Unicode doesn't render)
SUIT_LABEL = {Suit.CLUBS: "C", Suit.DIAMONDS: "D",
              Suit.HEARTS: "H", Suit.SPADES: "S"}
SUIT_COLOR = {Suit.CLUBS: "#1a1a1a", Suit.DIAMONDS: "#cc0000",
              Suit.HEARTS: "#cc0000", Suit.SPADES: "#1a1a1a"}

TEAM_A_COLOR = "#1a6fb5"   # blue-ish
TEAM_B_COLOR = "#b5841a"   # amber

BG           = "#eeeee4"
STATUS_BG    = "#ddddd4"
TABLE_BG     = "#267342"
TABLE_CENTER = "#1e5c35"
CARD_BG      = "#ffffff"
CARD_BORDER  = "#888888"
CARD_FD_BG   = "#bbc8bb"   # face-down card background
ACTIVE_BG    = "#c8ecd0"
LOG_BG       = "#fafaf5"


def _init_fonts(root):
    """Build font dict after Tk root exists (so tkfont.families() works)."""
    ui_family   = _pick_font(["DejaVu Sans", "Noto Sans", "Liberation Sans",
                               "Segoe UI", "Helvetica"])
    mono_family = _pick_font(["DejaVu Sans Mono", "Noto Sans Mono",
                               "Liberation Mono", "Consolas", "Courier"])
    return {
        "ui":        (ui_family, 13),
        "ui_bold":   (ui_family, 13, "bold"),
        "ui_big":    (ui_family, 15, "bold"),
        "status":    (ui_family, 12),
        "card":      (mono_family, 16, "bold"),
        "card_sm":   (mono_family, 13),
        "card_tbl":  (mono_family, 14, "bold"),
        "log":       (mono_family, 11),
        "seat":      (ui_family, 14, "bold"),
        "seat_sm":   (ui_family, 12),
        "info":      (ui_family, 11),
        "trick_hdr": (ui_family, 12, "bold"),
    }


# Helpers

def card_text(card):
    return f"{card.rank.value}{SUIT_LABEL[card.suit]}"


def card_color(card):
    return SUIT_COLOR[card.suit]


def seat_name(seat):
    return seat.value.capitalize()


def team_color(seat):
    return TEAM_A_COLOR if team_of(seat) == Team.TEAM_A else TEAM_B_COLOR


def phase_text(phase):
    return {
        Phase.DEALING_4: "Deal (4 cards)",
        Phase.BETTING_4: "Bidding (4 cards)",
        Phase.TRUMP_SELECTION: "Trump Selection",
        Phase.DEALING_8: "Deal (8 cards)",
        Phase.BETTING_8: "Bidding (8 cards)",
        Phase.PRE_PLAY: "Open / Closed Trump",
        Phase.PLAYING: "Play",
        Phase.SCRUTINY: "Scrutiny",
        Phase.COMPLETE: "Game Over",
    }.get(phase, phase.value)


def suit_text(suit):
    """Short label for a suit."""
    return {Suit.CLUBS: "Clubs", Suit.DIAMONDS: "Diamonds",
            Suit.HEARTS: "Hearts", Suit.SPADES: "Spades"}.get(suit, "?")


# -- Trick Canvas: spatial card layout ----------------------------------------

# Offsets from canvas center for each seat's played card (x, y)
TRICK_OFFSETS = {
    Seat.NORTH: (0, -44),
    Seat.SOUTH: (0,  44),
    Seat.WEST:  (-60, 0),
    Seat.EAST:  ( 60, 0),
}

CARD_W = 52   # card rectangle width
CARD_H = 36   # card rectangle height


class TrickCanvas(tk.Canvas):
    """Canvas that draws played cards spatially around the center."""

    def __init__(self, parent, fonts, **kw):
        kw.setdefault("bg", TABLE_CENTER)
        kw.setdefault("highlightthickness", 0)
        super().__init__(parent, **kw)
        self.fonts = fonts
        self._items = []

    def draw_trick(self, entries, title="", last_winner=None):
        """Draw cards on the canvas.

        entries: list of RoundEntry (or similar with .seat, .card, .face_down)
        title:   header text ("Round 3", "Last: R2 -> North")
        """
        self.delete("all")
        w = self.winfo_width() or 220
        h = self.winfo_height() or 180
        cx, cy = w // 2, h // 2

        # Title
        if title:
            self.create_text(cx, 14, text=title, font=self.fonts["trick_hdr"],
                             fill="#c0d8c0", anchor="n")

        if not entries:
            return

        # Draw each card, first card is lowest layer
        for i, entry in enumerate(entries):
            ox, oy = TRICK_OFFSETS.get(entry.seat, (0, 0))
            x = cx + ox
            y = cy + oy

            if entry.face_down:
                bg = CARD_FD_BG
                fg = "#555555"
                txt = "??"
            else:
                bg = CARD_BG
                fg = card_color(entry.card)
                txt = card_text(entry.card)

            # Card border — highlight winner
            border = "#ffcc00" if (last_winner and entry.seat == last_winner) else CARD_BORDER

            # Rounded rect (approximate with rectangle)
            self.create_rectangle(x - CARD_W // 2, y - CARD_H // 2,
                                  x + CARD_W // 2, y + CARD_H // 2,
                                  fill=bg, outline=border, width=2)
            self.create_text(x, y - 2, text=txt, font=self.fonts["card_tbl"],
                             fill=fg)

            # Seat initial below the card value
            seat_initial = seat_name(entry.seat)[0]
            self.create_text(x, y + 12, text=seat_initial,
                             font=self.fonts["info"], fill="#666")

    def draw_empty(self, text=""):
        self.delete("all")
        if text:
            w = self.winfo_width() or 220
            h = self.winfo_height() or 180
            self.create_text(w // 2, h // 2, text=text,
                             font=self.fonts["info"], fill="#88aa88")


# -- Main GUI ----------------------------------------------------------------

class GameGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("304 Card Game — Test UI")
        self.configure(bg=BG)
        self.geometry("1100x820")
        self.minsize(960, 740)

        self.fonts = _init_fonts(self)

        self.game = None
        self.match = None
        self._seed = 42
        self._caps_order = []
        self._caps_active = False
        self._caps_seat = None

        self._build_ui()
        self._new_game()

    # ---- UI construction ---------------------------------------------------

    def _build_ui(self):
        F = self.fonts

        # ---- Top control bar ----
        ctrl = tk.Frame(self, bg=BG, pady=6)
        ctrl.pack(fill="x", padx=12)

        tk.Label(ctrl, text="Seed:", font=F["ui"], bg=BG).pack(side="left")
        self._seed_var = tk.StringVar(value="42")
        tk.Entry(ctrl, textvariable=self._seed_var, width=8,
                 font=F["ui"]).pack(side="left", padx=(4, 12))

        tk.Button(ctrl, text="New Game", font=F["ui_bold"],
                  command=self._new_game, padx=10).pack(side="left", padx=4)
        tk.Button(ctrl, text="New Match", font=F["ui_bold"],
                  command=self._new_match, padx=10).pack(side="left", padx=4)

        # ---- Status bar ----
        self._status_frame = tk.Frame(self, bg=STATUS_BG, pady=6, padx=12)
        self._status_frame.pack(fill="x", padx=12, pady=(0, 4))
        self._status_labels = {}
        for key in ["phase", "dealer", "turn", "bid", "trump", "stone",
                     "round", "points"]:
            lbl = tk.Label(self._status_frame, text="", font=F["status"],
                           bg=STATUS_BG, anchor="w")
            lbl.pack(side="left", padx=(0, 18))
            self._status_labels[key] = lbl

        # ---- Main area ----
        main = tk.Frame(self, bg=BG)
        main.pack(fill="both", expand=True, padx=12, pady=(0, 4))
        main.grid_rowconfigure(0, weight=1)
        main.grid_columnconfigure(0, weight=1)

        # ---- Table ----
        table = tk.Frame(main, bg=TABLE_BG, bd=2, relief="sunken")
        table.pack(fill="both", expand=True, pady=(0, 6))
        for i in range(3):
            table.grid_rowconfigure(i, weight=1)
            table.grid_columnconfigure(i, weight=1)
        self._table_frame = table

        # Hand frames per seat
        self._hand_frames = {}
        self._hand_labels = {}
        self._card_containers = {}

        positions = {
            Seat.NORTH: (0, 1),
            Seat.WEST:  (1, 0),
            Seat.EAST:  (1, 2),
            Seat.SOUTH: (2, 1),
        }
        for seat, (r, c) in positions.items():
            frame = tk.Frame(table, bg=TABLE_BG, padx=8, pady=6)
            frame.grid(row=r, column=c, sticky="nsew")

            name_lbl = tk.Label(frame, text=seat_name(seat), font=F["seat"],
                                fg=team_color(seat), bg=TABLE_BG)
            name_lbl.pack()

            info_lbl = tk.Label(frame, text="", font=F["info"],
                                fg="#aaccaa", bg=TABLE_BG)
            info_lbl.pack()

            cards_frame = tk.Frame(frame, bg=TABLE_BG)
            cards_frame.pack(pady=(4, 0))

            self._hand_frames[seat] = frame
            self._hand_labels[seat] = (name_lbl, info_lbl)
            self._card_containers[seat] = cards_frame

        # Center: trick canvas
        self._trick_canvas = TrickCanvas(table, self.fonts,
                                         width=220, height=180)
        self._trick_canvas.grid(row=1, column=1, sticky="nsew",
                                padx=10, pady=10)

        # ---- Bottom row: actions + log ----
        bottom = tk.Frame(main, bg=BG)
        bottom.pack(fill="x")
        bottom.grid_columnconfigure(1, weight=1)

        # Actions panel
        actions_outer = tk.LabelFrame(bottom, text=" Actions ",
                                      font=F["ui_bold"], bg=BG,
                                      padx=10, pady=6)
        actions_outer.grid(row=0, column=0, sticky="nsew", padx=(0, 6))

        self._action_frame = tk.Frame(actions_outer, bg=BG)
        self._action_frame.pack(fill="both")

        # Bid row
        self._bid_frame = tk.Frame(self._action_frame, bg=BG)
        self._bid_var = tk.StringVar(value="160")
        tk.Label(self._bid_frame, text="Bid:", font=F["ui"], bg=BG
                 ).grid(row=0, column=0)
        self._bid_spin = tk.Spinbox(
            self._bid_frame, from_=160, to=304, increment=5,
            textvariable=self._bid_var, width=5, font=F["ui"])
        self._bid_spin.grid(row=0, column=1, padx=4)
        tk.Button(self._bid_frame, text="Place Bid", font=F["ui"],
                  command=self._do_bid, padx=6).grid(row=0, column=2, padx=2)

        # Button container
        self._btn_frame = tk.Frame(self._action_frame, bg=BG)
        self._buttons = {}
        btn_defs = [
            ("pass",      "Pass",          self._do_pass),
            ("partner",   "Partner",       self._do_partner),
            ("pcc",       "PCC",           self._do_pcc),
            ("reshuffle", "Reshuffle",     self._do_reshuffle),
            ("redeal",    "Redeal (8)",    self._do_redeal),
            ("open",      "Open Trump",    self._do_open_trump),
            ("closed",    "Closed Trump",  self._do_closed_trump),
            ("absolute",  "Absolute Hand", self._do_absolute),
            ("spoilt",    "Spoilt Trumps", self._do_spoilt),
            ("caps",      "Call Caps",     self._do_caps_start),
            ("deal",      "Deal",          self._do_deal),
            ("next_game", "Next Game",     self._do_next_game),
        ]
        for key, text, cmd in btn_defs:
            btn = tk.Button(self._btn_frame, text=text, font=F["ui"],
                            command=cmd, width=16, pady=2)
            self._buttons[key] = btn

        # Caps order panel
        self._caps_frame = tk.Frame(self._action_frame, bg=BG)
        self._caps_label = tk.Label(self._caps_frame, text="", font=F["ui"],
                                    bg=BG, wraplength=240, justify="left")
        self._caps_label.pack(pady=(4, 4))
        caps_btns = tk.Frame(self._caps_frame, bg=BG)
        caps_btns.pack()
        tk.Button(caps_btns, text="Confirm Caps", font=F["ui"],
                  command=self._do_caps_confirm, padx=6).pack(side="left", padx=4)
        tk.Button(caps_btns, text="Cancel", font=F["ui"],
                  command=self._do_caps_cancel, padx=6).pack(side="left", padx=4)

        # Error label
        self._error_var = tk.StringVar()
        self._error_label = tk.Label(
            actions_outer, textvariable=self._error_var,
            font=F["ui"], fg="#cc0000", bg=BG, wraplength=280,
            justify="left", anchor="w")
        self._error_label.pack(fill="x", pady=(6, 0))

        # Log panel
        log_outer = tk.LabelFrame(bottom, text=" Log ", font=F["ui_bold"],
                                  bg=BG, padx=6, pady=6)
        log_outer.grid(row=0, column=1, sticky="nsew")

        self._log = scrolledtext.ScrolledText(
            log_outer, font=F["log"], height=10, width=55,
            state="disabled", wrap="word", bg=LOG_BG)
        self._log.pack(fill="both", expand=True)

    # ---- Game management ---------------------------------------------------

    def _get_seed(self):
        try:
            return int(self._seed_var.get())
        except ValueError:
            return random.randint(0, 999999)

    def _new_game(self):
        self._seed = self._get_seed()
        self.game = Game(dealer=Seat.NORTH, rng=random.Random(self._seed))
        self.match = None
        self._caps_reset()
        self._log_clear()
        self._log_add(f"--- New Game (seed={self._seed}) ---")
        self._refresh()

    def _new_match(self):
        self._seed = self._get_seed()
        self.match = Match(first_dealer=Seat.NORTH,
                           rng=random.Random(self._seed))
        self.game = self.match.new_game()
        self._caps_reset()
        self._log_clear()
        self._log_add(f"--- New Match (seed={self._seed}) ---")
        self._log_add("Game 1")
        self._refresh()

    def _do_next_game(self):
        if self.match is None:
            return
        if self.match.is_complete():
            w = self.match.winner()
            self._log_add(f"Match complete! Winner: {w.value}")
            self._show_error("Match is complete.")
            return
        try:
            self.game = self.match.new_game()
            n = len(self.match.games) + 1
            self._log_add(f"--- Game {n} ---")
            self._caps_reset()
            self._refresh()
        except Exception as e:
            self._show_error(str(e))

    # ---- Actions -----------------------------------------------------------

    def _do_deal(self):
        try:
            self.game.deal_four()
            self._log_add("Cards dealt (4 each)")
            self._clear_error()
            self._refresh()
        except Exception as e:
            self._show_error(str(e))

    def _do_bid(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            val = int(self._bid_var.get())
            self.game.place_bid(seat, BidAction.BET, val)
            self._log_add(f"{seat_name(seat)} bids {val}")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_pass(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.place_bid(seat, BidAction.PASS)
            self._log_add(f"{seat_name(seat)} passes")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_partner(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.place_bid(seat, BidAction.PARTNER)
            p = partner_seat(seat)
            self._log_add(f"{seat_name(seat)} says 'Partner' -> {seat_name(p)}")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_pcc(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.place_bid(seat, BidAction.PCC)
            self._log_add(f"{seat_name(seat)} calls PCC!")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_reshuffle(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.call_reshuffle(seat)
            self._log_add(f"{seat_name(seat)} calls reshuffle")
            self.game.deal_four()
            self._log_add("Re-dealt (same dealer)")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_redeal(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.call_redeal_8(seat)
            self._log_add(f"{seat_name(seat)} calls 8-card redeal")
            self.game.deal_four()
            self._log_add(f"Re-dealt (dealer: {seat_name(self.game.state.dealer)})")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_open_trump(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.declare_open_trump(seat)
            s = suit_text(self.game.state.trump.trump_suit)
            self._log_add(f"{seat_name(seat)} declares Open Trump ({s})")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_closed_trump(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.proceed_closed_trump(seat)
            self._log_add(f"{seat_name(seat)} proceeds Closed Trump")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_absolute(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        try:
            self.game.call_absolute_hand(seat)
            self._log_add(f"{seat_name(seat)} declares Absolute Hand")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _do_spoilt(self):
        seat = self.game.whose_turn()
        if seat is None:
            seat = Seat.NORTH
        try:
            self.game.call_spoilt_trumps(seat)
            self._log_add(f"{seat_name(seat)} calls Spoilt Trumps")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _play_card(self, seat, card):
        """Called when a card button is clicked."""
        if self._caps_active:
            self._caps_order.append(card)
            remaining = [c for c in self.game.get_hand(seat)
                         if c not in self._caps_order]
            if not remaining:
                self._caps_label.config(
                    text="Order: " + ", ".join(card_text(c) for c in self._caps_order)
                    + "\nAll cards selected. Confirm?")
            else:
                self._caps_label.config(
                    text="Order: " + ", ".join(card_text(c) for c in self._caps_order)
                    + f"\nPick next ({len(remaining)} left)")
            self._refresh_hands()
            return

        try:
            result = self.game.play_card(seat, card)
            self._log_add(f"{seat_name(seat)} plays {card_text(card)}")
            self._clear_error()
            if result:
                extras = ""
                if result.trump_revealed:
                    s = suit_text(self.game.state.trump.trump_suit)
                    extras = f" [Trump revealed: {s}]"
                self._log_add(
                    f"  R{result.round_number} -> {seat_name(result.winner)} "
                    f"wins ({result.points_won}pts){extras}")
            if self.game.phase == Phase.COMPLETE:
                self._show_result()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    def _select_trump_card(self, seat, card):
        try:
            self.game.select_trump(seat, card)
            self._log_add(f"{seat_name(seat)} selects trump ({card_text(card)})")
            self._clear_error()
        except Exception as e:
            self._show_error(str(e))
        self._refresh()

    # Caps helpers
    def _caps_reset(self):
        self._caps_active = False
        self._caps_seat = None
        self._caps_order = []

    def _do_caps_start(self):
        seat = self.game.whose_turn()
        if seat is None:
            return
        self._caps_active = True
        self._caps_seat = seat
        self._caps_order = []
        self._caps_label.config(
            text=f"{seat_name(seat)}: Click cards in the order you will play them")
        self._refresh()

    def _do_caps_confirm(self):
        if not self._caps_active:
            return
        seat = self._caps_seat
        try:
            self.game.call_caps(seat, self._caps_order)
            self._log_add(f"{seat_name(seat)} calls Caps!")
            self._clear_error()
            if self.game.phase == Phase.COMPLETE:
                self._show_result()
        except Exception as e:
            self._show_error(str(e))
        self._caps_reset()
        self._refresh()

    def _do_caps_cancel(self):
        self._caps_reset()
        self._refresh()

    # ---- Display refresh ---------------------------------------------------

    def _refresh(self):
        if self.game is None:
            return
        self._refresh_status()
        self._refresh_hands()
        self._refresh_trick()
        self._refresh_actions()

    def _refresh_status(self):
        state = self.game.state
        trump = state.trump
        bidding = state.bidding
        F = self.fonts

        self._status_labels["phase"].config(
            text=f"Phase: {phase_text(self.game.phase)}")
        self._status_labels["dealer"].config(
            text=f"Dealer: {seat_name(state.dealer)}")

        turn = self.game.whose_turn()
        turn_text = seat_name(turn) if turn else "--"
        self._status_labels["turn"].config(text=f"Turn: {turn_text}")

        if bidding and bidding.highest_bid > 0:
            self._status_labels["bid"].config(
                text=f"Bid: {bidding.highest_bid} ({seat_name(bidding.highest_bidder)})")
        else:
            self._status_labels["bid"].config(text="Bid: --")

        trump_txt = "--"
        if trump.trumper_seat:
            trump_txt = seat_name(trump.trumper_seat)
            if trump.is_open:
                trump_txt += f" {suit_text(trump.trump_suit)} OPEN"
            elif trump.is_revealed:
                trump_txt += f" {suit_text(trump.trump_suit)} (revealed)"
            elif trump.trump_suit:
                trump_txt += " (hidden)"
        self._status_labels["trump"].config(text=f"Trump: {trump_txt}")

        self._status_labels["stone"].config(
            text=f"Stone: A={state.stone[Team.TEAM_A]}  B={state.stone[Team.TEAM_B]}")

        play = state.play
        if play:
            self._status_labels["round"].config(
                text=f"Round: {play.round_number}/8")
            self._status_labels["points"].config(
                text=f"Pts: A={play.points_won[Team.TEAM_A]}  "
                     f"B={play.points_won[Team.TEAM_B]}")
        else:
            self._status_labels["round"].config(text="")
            self._status_labels["points"].config(text="")

    def _refresh_hands(self):
        turn = self.game.whose_turn()
        phase = self.game.phase
        state = self.game.state
        F = self.fonts
        valid_cards = set()

        if phase == Phase.PLAYING and turn:
            valid_cards = set(self.game.valid_plays(turn))

        for seat in Seat:
            name_lbl, info_lbl = self._hand_labels[seat]
            cards_frame = self._card_containers[seat]
            hand = self.game.get_hand(seat)
            pts = hand_points(hand)
            is_active = (seat == turn)

            # Seat label
            arrow = "  <<" if is_active else ""
            name_lbl.config(
                text=f"{seat_name(seat)}{arrow}",
                fg="#ffffff" if is_active else team_color(seat),
                font=F["seat"] if not is_active else F["seat"])

            # Info
            pcc_out = " (OUT)" if state.pcc_partner_out == seat else ""
            team_lbl = "A" if team_of(seat) == Team.TEAM_A else "B"
            if hand:
                info_lbl.config(text=f"Team {team_lbl} | {pts}pts{pcc_out}")
            else:
                info_lbl.config(text=f"Team {team_lbl}{pcc_out}")

            # Clear old cards
            for w in cards_frame.winfo_children():
                w.destroy()

            # Build card widgets
            for card in hand:
                is_clickable = False
                if is_active and phase == Phase.PLAYING:
                    is_clickable = card in valid_cards
                elif is_active and phase == Phase.TRUMP_SELECTION:
                    is_clickable = True

                if self._caps_active:
                    is_clickable = (seat == self._caps_seat
                                    and card not in self._caps_order)

                txt = card_text(card)
                fg = card_color(card)

                if is_clickable:
                    if phase == Phase.TRUMP_SELECTION:
                        cmd = lambda s=seat, c=card: self._select_trump_card(s, c)
                    else:
                        cmd = lambda s=seat, c=card: self._play_card(s, c)
                    w = tk.Button(cards_frame, text=txt, font=F["card"],
                                 fg=fg, bg=CARD_BG, activebackground=ACTIVE_BG,
                                 relief="raised", bd=2, padx=6, pady=4,
                                 command=cmd, cursor="hand2")
                else:
                    w = tk.Label(cards_frame, text=txt, font=F["card_sm"],
                                fg=fg, bg=TABLE_BG, padx=4, pady=4)

                w.pack(side="left", padx=2)

            # Trump card indicator for trumper
            if (seat == state.trump.trumper_seat
                    and state.trump.trump_card is not None
                    and not state.trump.trump_card_in_hand):
                tc = state.trump.trump_card
                lbl = tk.Label(cards_frame,
                               text=f"[{card_text(tc)}]",
                               font=F["card_sm"], fg="#779977",
                               bg=TABLE_BG, padx=4)
                lbl.pack(side="left", padx=2)

    def _refresh_trick(self):
        play = self.game.state.play
        canvas = self._trick_canvas

        if play is None:
            canvas.draw_empty()
            return

        current = play.current_round
        if current:
            canvas.draw_trick(current, title=f"Round {play.round_number}")
        elif play.completed_rounds:
            last = play.completed_rounds[-1]
            title = (f"Last: R{last.round_number} -> "
                     f"{seat_name(last.winner)} ({last.points_won}pts)")
            canvas.draw_trick(last.cards, title=title,
                              last_winner=last.winner)
        else:
            canvas.draw_empty(text=f"Round {play.round_number}")

    def _refresh_actions(self):
        phase = self.game.phase
        turn = self.game.whose_turn()
        state = self.game.state

        # Hide everything
        self._bid_frame.pack_forget()
        self._btn_frame.pack_forget()
        self._caps_frame.pack_forget()
        for btn in self._buttons.values():
            btn.pack_forget()

        if self._caps_active:
            self._caps_frame.pack(fill="x", pady=4)
            return

        if phase == Phase.DEALING_4:
            self._btn_frame.pack(fill="x", pady=4)
            self._buttons["deal"].pack(fill="x", pady=2)
            return

        if phase in (Phase.BETTING_4, Phase.BETTING_8):
            self._bid_frame.pack(fill="x", pady=4)
            self._btn_frame.pack(fill="x", pady=4)
            self._buttons["pass"].pack(fill="x", pady=2)

            pending = (state.bidding and state.bidding.pending_partner
                       and turn == state.bidding.pending_partner.partner_seat)
            if not pending:
                self._buttons["partner"].pack(fill="x", pady=2)

            if phase == Phase.BETTING_8:
                self._buttons["pcc"].pack(fill="x", pady=2)

            if turn and phase == Phase.BETTING_4:
                hand = self.game.get_hand(turn)
                if hand_points(hand) < 15:
                    self._buttons["reshuffle"].pack(fill="x", pady=2)
            if turn and phase == Phase.BETTING_8:
                hand = self.game.get_hand(turn)
                if hand_points(hand) < 25:
                    self._buttons["redeal"].pack(fill="x", pady=2)
            return

        if phase == Phase.TRUMP_SELECTION:
            return

        if phase == Phase.PRE_PLAY:
            self._btn_frame.pack(fill="x", pady=4)
            self._buttons["open"].pack(fill="x", pady=2)
            self._buttons["closed"].pack(fill="x", pady=2)
            self._buttons["absolute"].pack(fill="x", pady=2)
            self._buttons["spoilt"].pack(fill="x", pady=2)
            return

        if phase == Phase.PLAYING:
            self._btn_frame.pack(fill="x", pady=4)
            self._buttons["spoilt"].pack(fill="x", pady=2)
            self._buttons["caps"].pack(fill="x", pady=2)
            return

        if phase == Phase.COMPLETE:
            self._btn_frame.pack(fill="x", pady=4)
            if self.match:
                self._buttons["next_game"].pack(fill="x", pady=2)
            self._buttons["deal"].pack(fill="x", pady=2)
            return

    # ---- Result display ----------------------------------------------------

    def _show_result(self):
        result = self.game.state.result
        if result is None:
            return
        self._log_add("=" * 44)
        self._log_add(f"RESULT: {result.description}")
        if result.winner_team:
            self._log_add(f"Winner: {result.winner_team.value}")
        self._log_add(
            f"Stone: A={self.game.state.stone[Team.TEAM_A]}  "
            f"B={self.game.state.stone[Team.TEAM_B]}")

        play = self.game.state.play
        if play:
            self._log_add("Round summary:")
            for r in play.completed_rounds:
                cards = " ".join(
                    f"{seat_name(e.seat)[0]}:{card_text(e.card)}"
                    + ("[fd]" if e.face_down else "")
                    for e in r.cards
                )
                self._log_add(
                    f"  R{r.round_number}: {cards} -> "
                    f"{seat_name(r.winner)} ({r.points_won})")
        self._log_add("=" * 44)

    # ---- Error / log -------------------------------------------------------

    def _show_error(self, msg):
        self._error_var.set(f"Error: {msg}")

    def _clear_error(self):
        self._error_var.set("")

    def _log_add(self, text):
        self._log.config(state="normal")
        self._log.insert("end", text + "\n")
        self._log.see("end")
        self._log.config(state="disabled")

    def _log_clear(self):
        self._log.config(state="normal")
        self._log.delete("1.0", "end")
        self._log.config(state="disabled")


if __name__ == "__main__":
    app = GameGUI()
    app.mainloop()
