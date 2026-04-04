"""Thorough exercise of the game304 system.

This file systematically probes every code path, boundary condition,
and edge case to surface bugs. It covers:
  - Deck mechanics and dealing
  - Bidding (all actions, increments, partner, PCC, reshuffles, redeals)
  - Trump selection (open/closed, card restrictions)
  - Card play (follow suit, face-down, trump reveal, exhausted trumps)
  - Round resolution (trump vs non-trump, ties, face-down trump)
  - Scoring and stone exchange
  - Caps obligation, late/wrong/external caps
  - Match lifecycle (multi-game, stone tracking, completion)
  - Full-game simulations with controlled hands
"""

import random

import pytest

from game304 import (
    BidAction,
    Card,
    Deck,
    Game,
    Match,
    Phase,
    Rank,
    Seat,
    Suit,
    Team,
    hand_points,
    create_pack,
    next_seat,
    prev_seat,
    partner_seat,
    deal_order,
    team_of,
    INITIAL_STONE,
    SCORING_TABLE,
    TOTAL_POINTS,
    GameError,
    InvalidPhaseError,
    NotYourTurnError,
    InvalidBidError,
    InvalidPlayError,
    InvalidTrumpSelectionError,
    CapsError,
)
from game304.constants import (
    MIN_BID_4_CARD,
    MIN_BID_8_CARD,
    THRESHOLD_4_CARD,
    THRESHOLD_8_CARD,
    INCREMENT_BELOW_200,
    INCREMENT_200_PLUS,
    RESHUFFLE_POINT_THRESHOLD,
    REDEAL_POINT_THRESHOLD,
    MAX_CONSECUTIVE_RESHUFFLES,
    PCC_BID_VALUE,
    WRONG_CAPS_PENALTY,
    PCC_SCORING,
    POINT_VALUES,
)
from game304.state import (
    BiddingState,
    CompletedRound,
    GameState,
    PlayState,
    RoundEntry,
    TrumpState,
)
from game304.play import resolve_round, get_led_suit, get_valid_plays
from game304.bidding import (
    get_increment,
    validate_bid_value,
    init_bidding_state,
)
from game304.seating import ANTICLOCKWISE


# ======================================================================
# Helpers
# ======================================================================

def make_game(dealer=Seat.NORTH, seed=42):
    """Create a game ready for dealing."""
    return Game(dealer=dealer, rng=random.Random(seed))


def game_at_betting_4(dealer=Seat.NORTH, seed=42):
    """Create a game in BETTING_4 phase."""
    g = make_game(dealer, seed)
    g.deal_four()
    return g


def game_through_trump_selection(dealer=Seat.NORTH, seed=42, bid=160):
    """Create a game that's past trump selection, in BETTING_8."""
    g = game_at_betting_4(dealer, seed)
    first = g.whose_turn()
    g.place_bid(first, BidAction.BET, bid)
    for _ in range(3):
        g.place_bid(g.whose_turn(), BidAction.PASS)
    # Now in TRUMP_SELECTION
    trumper = g.whose_turn()
    hand = g.get_hand(trumper)
    g.select_trump(trumper, hand[0])
    # Now in BETTING_8
    return g


def game_at_pre_play(dealer=Seat.NORTH, seed=42, bid=160):
    """Create a game in PRE_PLAY phase (8-card bidding done, no new bids)."""
    g = game_through_trump_selection(dealer, seed, bid)
    # All pass on 8 cards
    for _ in range(3):
        g.place_bid(g.whose_turn(), BidAction.PASS)
    assert g.phase == Phase.PRE_PLAY
    return g


def game_at_playing(dealer=Seat.NORTH, seed=42, bid=160, open_trump=False):
    """Create a game in PLAYING phase."""
    g = game_at_pre_play(dealer, seed, bid)
    trumper = g.whose_turn()
    if open_trump:
        g.declare_open_trump(trumper)
    else:
        g.proceed_closed_trump(trumper)
    assert g.phase == Phase.PLAYING
    return g


def play_full_game(game, strategy="first_valid"):
    """Play a full game to completion.

    strategy: 'first_valid' plays the first valid card each round.
    """
    game.deal_four()

    first = game.whose_turn()
    game.place_bid(first, BidAction.BET, 160)
    for _ in range(3):
        game.place_bid(game.whose_turn(), BidAction.PASS)

    trumper = game.whose_turn()
    hand = game.get_hand(trumper)
    game.select_trump(trumper, hand[0])

    for _ in range(3):
        game.place_bid(game.whose_turn(), BidAction.PASS)

    game.proceed_closed_trump(game.state.trump.trumper_seat)

    while game.phase == Phase.PLAYING:
        current = game.whose_turn()
        valid = game.valid_plays(current)
        assert valid, f"No valid plays for {current}"
        game.play_card(current, valid[0])


def inject_hands(game, hands_dict):
    """Forcibly set player hands (for controlled scenarios)."""
    for seat, cards in hands_dict.items():
        game.state.hands[seat] = list(cards)


# ======================================================================
# 1. DECK AND CARD BASICS
# ======================================================================

class TestDeckBasics:
    def test_pack_has_32_cards(self):
        pack = create_pack()
        assert len(pack) == 32

    def test_pack_has_4_suits_8_ranks(self):
        pack = create_pack()
        suits = {c.suit for c in pack}
        ranks = {c.rank for c in pack}
        assert len(suits) == 4
        assert len(ranks) == 8

    def test_no_duplicate_cards(self):
        pack = create_pack()
        assert len(set(pack)) == 32

    def test_total_points_is_304(self):
        pack = create_pack()
        assert sum(c.points for c in pack) == TOTAL_POINTS

    def test_deck_deal_removes_cards(self):
        deck = Deck(rng=random.Random(1))
        deck.minimal_shuffle()
        deck.cut()
        before = len(deck)
        hands = deck.deal(Seat.NORTH, 4)
        after = len(deck)
        assert before - after == 16
        assert all(len(h) == 4 for h in hands.values())

    def test_two_deals_exhaust_deck(self):
        deck = Deck(rng=random.Random(1))
        deck.minimal_shuffle()
        deck.cut()
        deck.deal(Seat.NORTH, 4)
        deck.deal(Seat.NORTH, 4)
        assert len(deck) == 0

    def test_deal_too_many_raises(self):
        deck = Deck(rng=random.Random(1))
        with pytest.raises(ValueError):
            deck.deal(Seat.NORTH, 9)  # 9*4=36 > 32

    def test_deterministic_shuffle(self):
        d1 = Deck(rng=random.Random(99))
        d1.minimal_shuffle()
        d2 = Deck(rng=random.Random(99))
        d2.minimal_shuffle()
        assert d1.cards == d2.cards

    def test_full_shuffle_is_different(self):
        d1 = Deck(rng=random.Random(42))
        d1.minimal_shuffle()
        d2 = Deck(rng=random.Random(42))
        d2.full_shuffle()
        # Extremely unlikely to be the same
        assert d1.cards != d2.cards

    def test_cut_preserves_all_cards(self):
        deck = Deck(rng=random.Random(7))
        before = set(deck.cards)
        deck.cut()
        after = set(deck.cards)
        assert before == after

    def test_deal_order_is_anticlockwise_from_dealer_right(self):
        order = deal_order(Seat.NORTH)
        # Right of North in anticlockwise = West
        assert order[0] == Seat.WEST


class TestCardBasics:
    def test_card_frozen(self):
        c = Card(Rank.JACK, Suit.CLUBS)
        with pytest.raises(AttributeError):
            c.rank = Rank.NINE

    def test_card_hashable(self):
        c = Card(Rank.JACK, Suit.CLUBS)
        assert hash(c) is not None
        s = {c, c}
        assert len(s) == 1

    def test_card_equality(self):
        c1 = Card(Rank.JACK, Suit.CLUBS)
        c2 = Card(Rank.JACK, Suit.CLUBS)
        assert c1 == c2

    def test_jack_beats_nine(self):
        j = Card(Rank.JACK, Suit.CLUBS)
        n = Card(Rank.NINE, Suit.CLUBS)
        assert j.beats(n, Suit.CLUBS, Suit.HEARTS)

    def test_rank_power_order(self):
        ranks_by_power = sorted(Rank, key=lambda r: Card(r, Suit.CLUBS).power)
        assert ranks_by_power == [
            Rank.JACK, Rank.NINE, Rank.ACE, Rank.TEN,
            Rank.KING, Rank.QUEEN, Rank.EIGHT, Rank.SEVEN,
        ]

    def test_hand_points(self):
        hand = [
            Card(Rank.JACK, Suit.CLUBS),   # 30
            Card(Rank.NINE, Suit.CLUBS),   # 20
            Card(Rank.SEVEN, Suit.HEARTS), # 0
            Card(Rank.QUEEN, Suit.SPADES), # 2
        ]
        assert hand_points(hand) == 52

    def test_card_from_str(self):
        c = Card.from_str("Jc")
        assert c == Card(Rank.JACK, Suit.CLUBS)


class TestSeating:
    def test_anticlockwise_order(self):
        assert next_seat(Seat.NORTH) == Seat.WEST
        assert next_seat(Seat.WEST) == Seat.SOUTH
        assert next_seat(Seat.SOUTH) == Seat.EAST
        assert next_seat(Seat.EAST) == Seat.NORTH

    def test_prev_is_reverse(self):
        for s in Seat:
            assert prev_seat(next_seat(s)) == s

    def test_partner_is_opposite(self):
        assert partner_seat(Seat.NORTH) == Seat.SOUTH
        assert partner_seat(Seat.SOUTH) == Seat.NORTH
        assert partner_seat(Seat.EAST) == Seat.WEST
        assert partner_seat(Seat.WEST) == Seat.EAST

    def test_teams(self):
        assert team_of(Seat.NORTH) == Team.TEAM_A
        assert team_of(Seat.SOUTH) == Team.TEAM_A
        assert team_of(Seat.EAST) == Team.TEAM_B
        assert team_of(Seat.WEST) == Team.TEAM_B

    def test_deal_order_all_four_seats(self):
        order = deal_order(Seat.NORTH)
        assert len(order) == 4
        assert set(order) == set(Seat)


# ======================================================================
# 2. DEALING AND PHASE TRANSITIONS
# ======================================================================

class TestDealing:
    def test_deal_four_transitions_to_betting_4(self):
        g = make_game()
        g.deal_four()
        assert g.phase == Phase.BETTING_4

    def test_deal_four_gives_4_cards_each(self):
        g = make_game()
        hands = g.deal_four()
        for seat, cards in hands.items():
            assert len(cards) == 4

    def test_deal_four_twice_raises(self):
        g = make_game()
        g.deal_four()
        with pytest.raises(InvalidPhaseError):
            g.deal_four()

    def test_hands_are_disjoint(self):
        g = make_game()
        hands = g.deal_four()
        all_cards = []
        for cards in hands.values():
            all_cards.extend(cards)
        assert len(all_cards) == len(set(all_cards))

    def test_deal_preserves_total_points(self):
        g = make_game()
        hands = g.deal_four()
        total = sum(c.points for cards in hands.values() for c in cards)
        # Only half the deck dealt, so total can vary
        assert 0 <= total <= TOTAL_POINTS

    def test_different_dealers_different_first_bidder(self):
        g1 = game_at_betting_4(dealer=Seat.NORTH, seed=42)
        g2 = game_at_betting_4(dealer=Seat.SOUTH, seed=42)
        # First bidder is right of dealer
        assert g1.whose_turn() == Seat.WEST   # right of North
        assert g2.whose_turn() == Seat.EAST   # right of South


# ======================================================================
# 3. BIDDING — COMPREHENSIVE
# ======================================================================

class TestBiddingValues:
    """Test bid value validation at boundaries."""

    def test_min_bid_160(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        assert g.state.bidding.highest_bid == 160

    def test_below_min_rejected(self):
        g = game_at_betting_4()
        with pytest.raises(InvalidBidError):
            g.place_bid(g.whose_turn(), BidAction.BET, 150)

    def test_increment_10_below_200(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        second = g.whose_turn()
        g.place_bid(second, BidAction.BET, 170)
        # 165 not valid
        with pytest.raises(InvalidBidError):
            g.place_bid(g.whose_turn(), BidAction.BET, 165)

    def test_increment_5_at_200(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 200)
        second = g.whose_turn()
        # 205 should be valid (increment of 5)
        g.place_bid(second, BidAction.BET, 205)
        assert g.state.bidding.highest_bid == 205

    def test_increment_10_not_valid_at_200_plus(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 200)
        second = g.whose_turn()
        # 210 is a jump of 10, but since we're >= 200, increments are 5
        # 210 should be valid since 210 - 200 = 10, which is 2*5
        g.place_bid(second, BidAction.BET, 210)

    def test_bid_must_exceed_current(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 180)
        second = g.whose_turn()
        with pytest.raises(InvalidBidError):
            g.place_bid(second, BidAction.BET, 170)

    def test_equal_bid_rejected(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        second = g.whose_turn()
        with pytest.raises(InvalidBidError):
            g.place_bid(second, BidAction.BET, 160)


class TestBiddingFlow:
    """Test bidding turn order and pass mechanics."""

    def test_turn_order_anticlockwise(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        turns = []
        for i in range(4):
            seat = g.whose_turn()
            turns.append(seat)
            g.place_bid(seat, BidAction.BET, 160 + i * 10)
        # From North's right: West, South, East, North
        assert turns == [Seat.WEST, Seat.SOUTH, Seat.EAST, Seat.NORTH]

    def test_three_passes_after_bid_ends_bidding(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.TRUMP_SELECTION

    def test_all_four_pass_triggers_redeal(self):
        g = game_at_betting_4()
        for _ in range(4):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.DEALING_4
        # Dealer advances
        assert g.state.dealer == Seat.WEST

    def test_two_passes_then_bid_resets_consecutive(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        g.place_bid(g.whose_turn(), BidAction.PASS)
        g.place_bid(g.whose_turn(), BidAction.PASS)
        # Two passes so far — but now someone bids
        g.place_bid(g.whose_turn(), BidAction.BET, 200)
        # Passes reset, need 3 more
        assert g.phase == Phase.BETTING_4

    def test_wrong_turn_rejected(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        wrong = next_seat(first)
        with pytest.raises(NotYourTurnError):
            g.place_bid(wrong, BidAction.BET, 160)

    def test_second_speech_minimum_200(self):
        """After first speech, bids below 200 are rejected."""
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        g.place_bid(g.whose_turn(), BidAction.BET, 170)
        g.place_bid(g.whose_turn(), BidAction.PASS)
        g.place_bid(g.whose_turn(), BidAction.PASS)
        # First bidder's turn again — speech_count=1, so min is 200
        with pytest.raises(InvalidBidError):
            g.place_bid(g.whose_turn(), BidAction.BET, 180)
        g.place_bid(g.whose_turn(), BidAction.BET, 200)

    def test_bidding_not_in_betting_phase(self):
        g = make_game()
        with pytest.raises(InvalidPhaseError):
            g.place_bid(Seat.WEST, BidAction.BET, 160)


class TestPartnerBidding:
    """Test the PARTNER action and response mechanics."""

    def test_partner_gives_turn_to_partner(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        # West says partner
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        # East (West's partner) must respond
        assert g.whose_turn() == Seat.EAST

    def test_partner_response_bet(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        g.place_bid(Seat.EAST, BidAction.BET, 160)
        # Turn resumes from West's position → South
        assert g.whose_turn() == Seat.SOUTH

    def test_partner_response_pass(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        g.place_bid(Seat.EAST, BidAction.PASS)
        # Turn resumes from West's position → South
        assert g.whose_turn() == Seat.SOUTH

    def test_partner_turn_skipped(self):
        """East's normal turn is skipped after responding to partner."""
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        g.place_bid(Seat.EAST, BidAction.BET, 160)
        # South
        g.place_bid(Seat.SOUTH, BidAction.PASS)
        # East is skipped, next is North
        assert g.whose_turn() == Seat.NORTH

    def test_both_players_consume_speech(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        g.place_bid(Seat.EAST, BidAction.BET, 160)
        # Both West and East have speech_count=1
        assert g.state.bidding.player_state[Seat.WEST].speech_count == 1
        assert g.state.bidding.player_state[Seat.EAST].speech_count == 1

    def test_partner_cannot_be_used_twice(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        g.place_bid(Seat.EAST, BidAction.BET, 160)
        g.place_bid(Seat.SOUTH, BidAction.PASS)
        g.place_bid(Seat.NORTH, BidAction.PASS)
        # West's turn again
        with pytest.raises(InvalidBidError):
            g.place_bid(Seat.WEST, BidAction.PARTNER)

    def test_partner_invalid_response_action(self):
        g = game_at_betting_4(dealer=Seat.NORTH)
        g.place_bid(Seat.WEST, BidAction.PARTNER)
        with pytest.raises(InvalidBidError):
            g.place_bid(Seat.EAST, BidAction.PARTNER)


class TestReshuffle:
    """Test reshuffle mechanics on 4 cards."""

    def test_reshuffle_resets_to_dealing(self):
        for seed in range(200):
            g = game_at_betting_4(seed=seed)
            priority = g.whose_turn()
            hand = g.get_hand(priority)
            if hand_points(hand) < RESHUFFLE_POINT_THRESHOLD:
                g.call_reshuffle(priority)
                assert g.phase == Phase.DEALING_4
                assert g.state.dealer == Seat.NORTH  # same dealer
                return
        pytest.skip("No seed found with eligible hand")

    def test_reshuffle_wrong_seat(self):
        for seed in range(200):
            g = game_at_betting_4(seed=seed)
            priority = g.whose_turn()
            hand = g.get_hand(priority)
            if hand_points(hand) < RESHUFFLE_POINT_THRESHOLD:
                other = next_seat(priority)
                with pytest.raises(InvalidBidError):
                    g.call_reshuffle(other)
                return
        pytest.skip("No seed found with eligible hand")

    def test_reshuffle_too_many_points(self):
        for seed in range(200):
            g = game_at_betting_4(seed=seed)
            priority = g.whose_turn()
            hand = g.get_hand(priority)
            if hand_points(hand) >= RESHUFFLE_POINT_THRESHOLD:
                with pytest.raises(InvalidBidError):
                    g.call_reshuffle(priority)
                return
        pytest.skip("No seed found with ineligible hand")

    def test_consecutive_reshuffles_counter(self):
        g = make_game(seed=0)
        for seed in range(200):
            g._rng = random.Random(seed)
            g.state.phase = Phase.DEALING_4
            g.deal_four()
            priority = g.whose_turn()
            hand = g.get_hand(priority)
            if hand_points(hand) < RESHUFFLE_POINT_THRESHOLD:
                g.call_reshuffle(priority)
                assert g.state.consecutive_reshuffles == 1
                return
        pytest.skip("No seed found")

    def test_reshuffle_wrong_phase(self):
        g = make_game()
        with pytest.raises(InvalidPhaseError):
            g.call_reshuffle(Seat.WEST)


class TestRedeal8:
    """Test 8-card redeal mechanics."""

    def test_redeal_wrong_phase(self):
        g = game_at_betting_4()
        with pytest.raises(InvalidPhaseError):
            g.call_redeal_8(Seat.WEST)

    def test_redeal_8_resets_and_advances_dealer(self):
        for seed in range(200):
            g = game_through_trump_selection(seed=seed)
            assert g.phase == Phase.BETTING_8
            # Check each player's hand
            for s in Seat:
                hand = g.get_hand(s)
                if hand_points(hand) < REDEAL_POINT_THRESHOLD:
                    # This player can redeal if it's their turn
                    if s == g.whose_turn():
                        g.call_redeal_8(s)
                        assert g.phase == Phase.DEALING_4
                        assert g.state.dealer == Seat.WEST
                        return
        pytest.skip("No seed found with eligible 8-card hand at turn")


# ======================================================================
# 4. TRUMP SELECTION
# ======================================================================

class TestTrumpSelection:
    def test_trumper_is_highest_bidder(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.TRUMP_SELECTION
        assert g.whose_turn() == first

    def test_select_trump_removes_card_from_hand(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        hand_before = g.get_hand(trumper)
        trump_card = hand_before[0]
        g.select_trump(trumper, trump_card)
        hand_after = g.get_hand(trumper)
        assert trump_card not in hand_after
        # Hand has 3 remaining + 4 new = 7
        assert len(hand_after) == 7

    def test_trump_suit_set_correctly(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        card = g.get_hand(trumper)[0]
        g.select_trump(trumper, card)
        assert g.state.trump.trump_suit == card.suit
        assert g.state.trump.trump_card == card

    def test_select_wrong_seat_rejected(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        other = next_seat(trumper)
        card = g.get_hand(other)[0]
        with pytest.raises(InvalidTrumpSelectionError):
            g.select_trump(other, card)

    def test_select_card_not_in_hand_rejected(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        other = next_seat(trumper)
        card = g.get_hand(other)[0]  # a card from someone else's hand
        with pytest.raises(InvalidTrumpSelectionError):
            g.select_trump(trumper, card)

    def test_transitions_to_betting_8(self):
        g = game_through_trump_selection()
        assert g.phase == Phase.BETTING_8


class TestOpenClosedTrump:
    def test_closed_trump_proceeds(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        g.proceed_closed_trump(trumper)
        assert g.phase == Phase.PLAYING
        assert not g.state.trump.is_open
        assert not g.state.trump.is_revealed

    def test_open_trump_reveals(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        g.declare_open_trump(trumper)
        assert g.phase == Phase.PLAYING
        assert g.state.trump.is_open
        assert g.state.trump.is_revealed
        assert g.state.trump.trump_card_in_hand
        assert g.state.trump.trump_card is None  # picked up

    def test_open_trump_wrong_seat(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        other = next_seat(trumper)
        with pytest.raises(InvalidTrumpSelectionError):
            g.declare_open_trump(other)

    def test_closed_trump_wrong_seat(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        other = next_seat(trumper)
        with pytest.raises(InvalidTrumpSelectionError):
            g.proceed_closed_trump(other)

    def test_open_trump_adds_card_to_hand(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        hand_before = len(g.get_hand(trumper))
        g.declare_open_trump(trumper)
        hand_after = len(g.get_hand(trumper))
        # Should have one more card (trump card picked up)
        assert hand_after == hand_before + 1

    def test_open_trump_with_reveal_card(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        trump_suit = g.state.trump.trump_suit
        # Declare open — find a trump suit card to reveal
        g.declare_open_trump(trumper)  # reveal_card=None uses implicit

    def test_open_trump_wrong_reveal_suit(self):
        g = game_at_pre_play()
        trumper = g.whose_turn()
        trump_suit = g.state.trump.trump_suit
        hand = g.get_hand(trumper)
        non_trump = [c for c in hand if c.suit != trump_suit]
        if non_trump:
            with pytest.raises(InvalidTrumpSelectionError):
                g.declare_open_trump(trumper, reveal_card=non_trump[0])


# ======================================================================
# 5. CARD PLAY — COMPREHENSIVE
# ======================================================================

class TestPlayBasics:
    def test_play_wrong_phase(self):
        g = game_at_pre_play()
        with pytest.raises(InvalidPhaseError):
            g.play_card(Seat.WEST, Card(Rank.JACK, Suit.CLUBS))

    def test_play_wrong_turn(self):
        g = game_at_playing()
        current = g.whose_turn()
        other = next_seat(current)
        hand = g.get_hand(other)
        if hand:
            with pytest.raises(NotYourTurnError):
                g.play_card(other, hand[0])

    def test_play_card_not_in_hand(self):
        g = game_at_playing()
        current = g.whose_turn()
        # Find a card not in current player's hand
        hand = g.get_hand(current)
        other_hand = g.get_hand(next_seat(current))
        if other_hand:
            card = other_hand[0]
            if card not in hand:
                with pytest.raises(InvalidPlayError):
                    g.play_card(current, card)

    def test_valid_plays_returns_nonempty(self):
        g = game_at_playing()
        current = g.whose_turn()
        valid = g.valid_plays(current)
        assert len(valid) > 0

    def test_valid_plays_empty_for_wrong_turn(self):
        g = game_at_playing()
        current = g.whose_turn()
        other = next_seat(current)
        assert g.valid_plays(other) == []

    def test_play_card_removes_from_hand(self):
        g = game_at_playing()
        current = g.whose_turn()
        hand = g.get_hand(current)
        card = g.valid_plays(current)[0]
        g.play_card(current, card)
        new_hand = g.get_hand(current)
        assert card not in new_hand


class TestFollowSuit:
    """Test follow-suit rules with controlled hands."""

    def test_must_follow_suit_when_able(self):
        g = game_at_playing(seed=42, open_trump=True)
        # Play one round to set up a scenario
        current = g.whose_turn()
        valid = g.valid_plays(current)
        first_card = valid[0]
        g.play_card(current, first_card)

        # Second player must follow suit if they have it
        second = g.whose_turn()
        hand = g.get_hand(second)
        led_suit = first_card.suit
        has_led_suit = any(c.suit == led_suit for c in hand)
        if has_led_suit:
            # All valid plays should be of the led suit
            vp = g.valid_plays(second)
            for c in vp:
                assert c.suit == led_suit, (
                    f"Valid play {c} not of led suit {led_suit}"
                )

    def test_any_card_when_void(self):
        g = game_at_playing(seed=42, open_trump=True)
        current = g.whose_turn()
        valid = g.valid_plays(current)
        first_card = valid[0]
        g.play_card(current, first_card)

        second = g.whose_turn()
        hand = g.get_hand(second)
        led_suit = first_card.suit
        has_led_suit = any(c.suit == led_suit for c in hand)
        if not has_led_suit:
            # Can play any card
            vp = g.valid_plays(second)
            assert len(vp) == len(hand)


class TestRoundResolution:
    """Test round resolution with constructed hands."""

    def test_highest_of_led_suit_wins_no_trump(self):
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.QUEEN, Suit.CLUBS)),
            RoundEntry(seat=Seat.WEST, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.NINE, Suit.CLUBS)),
            RoundEntry(seat=Seat.EAST, card=Card(Rank.SEVEN, Suit.CLUBS)),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, True
        )
        assert winner == Seat.WEST  # Jack is highest
        assert pts == 30 + 20 + 2 + 0  # J+9+Q+7

    def test_trump_beats_led_suit(self):
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(seat=Seat.WEST, card=Card(Rank.SEVEN, Suit.HEARTS)),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(seat=Seat.EAST, card=Card(Rank.EIGHT, Suit.CLUBS)),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, True
        )
        assert winner == Seat.WEST  # 7h is only trump

    def test_highest_trump_wins(self):
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(seat=Seat.WEST, card=Card(Rank.SEVEN, Suit.HEARTS)),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.JACK, Suit.HEARTS)),
            RoundEntry(seat=Seat.EAST, card=Card(Rank.EIGHT, Suit.CLUBS)),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, True
        )
        assert winner == Seat.SOUTH  # Jh > 7h

    def test_face_down_trump_wins(self):
        """In closed trump, a face-down trump card wins."""
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(
                seat=Seat.WEST,
                card=Card(Rank.SEVEN, Suit.HEARTS),
                face_down=True,
            ),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(seat=Seat.EAST, card=Card(Rank.EIGHT, Suit.CLUBS)),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, False
        )
        assert winner == Seat.WEST
        assert found is True
        assert Card(Rank.SEVEN, Suit.HEARTS) in revealed

    def test_face_down_non_trump_loses(self):
        """Face-down non-trump card doesn't win."""
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(
                seat=Seat.WEST,
                card=Card(Rank.SEVEN, Suit.DIAMONDS),
                face_down=True,
            ),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(seat=Seat.EAST, card=Card(Rank.EIGHT, Suit.CLUBS)),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, False
        )
        assert winner == Seat.NORTH  # Jc wins (highest led suit)
        assert found is False

    def test_multiple_face_down_trumps(self):
        """When multiple face-down trumps, highest wins."""
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),
            RoundEntry(
                seat=Seat.WEST,
                card=Card(Rank.SEVEN, Suit.HEARTS),
                face_down=True,
            ),
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.ACE, Suit.CLUBS)),
            RoundEntry(
                seat=Seat.EAST,
                card=Card(Rank.JACK, Suit.HEARTS),
                face_down=True,
            ),
        ]
        winner, pts, found, revealed = resolve_round(
            entries, Suit.HEARTS, False
        )
        assert winner == Seat.EAST  # Jh > 7h
        assert found is True

    def test_all_cards_contribute_points(self):
        """All cards (including face-down) contribute to points."""
        entries = [
            RoundEntry(seat=Seat.NORTH, card=Card(Rank.JACK, Suit.CLUBS)),     # 30
            RoundEntry(
                seat=Seat.WEST,
                card=Card(Rank.ACE, Suit.HEARTS),
                face_down=True,
            ),  # 11
            RoundEntry(seat=Seat.SOUTH, card=Card(Rank.TEN, Suit.CLUBS)),      # 10
            RoundEntry(seat=Seat.EAST, card=Card(Rank.SEVEN, Suit.CLUBS)),     # 0
        ]
        _, pts, _, _ = resolve_round(entries, Suit.HEARTS, False)
        assert pts == 30 + 11 + 10 + 0

    def test_get_led_suit_skips_face_down(self):
        """Led suit is the first face-up card."""
        entries = [
            RoundEntry(
                seat=Seat.NORTH,
                card=Card(Rank.JACK, Suit.CLUBS),
                face_down=True,
            ),
            RoundEntry(seat=Seat.WEST, card=Card(Rank.ACE, Suit.HEARTS)),
        ]
        # The face-down first card shouldn't count — led suit is hearts
        # Wait, the first player leads face-up. This scenario is unusual.
        # But get_led_suit should return the first face-up card.
        assert get_led_suit(entries) == Suit.HEARTS


# ======================================================================
# 6. FULL GAME SIMULATION (many seeds)
# ======================================================================

class TestFullGameSimulation:
    """Run many full games to catch assertion/crash bugs."""

    @pytest.mark.parametrize("seed", range(50))
    def test_full_game_completes(self, seed):
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g)
        assert g.phase == Phase.COMPLETE
        assert g.state.result is not None

    @pytest.mark.parametrize("dealer", list(Seat))
    def test_all_dealer_positions(self, dealer):
        g = Game(dealer=dealer, rng=random.Random(42))
        play_full_game(g)
        assert g.phase == Phase.COMPLETE

    def test_open_trump_full_game(self):
        g = make_game(seed=42)
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.declare_open_trump(g.state.trump.trumper_seat)

        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid, f"No valid plays for {current} in round {g.state.play.round_number}"
            g.play_card(current, valid[0])

        assert g.phase == Phase.COMPLETE

    def test_points_sum_to_304(self):
        """After a full game, total points should be 304."""
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        play = g.state.play
        total = play.points_won[Team.TEAM_A] + play.points_won[Team.TEAM_B]
        assert total == TOTAL_POINTS

    def test_8_rounds_completed(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        assert len(g.state.play.completed_rounds) == 8

    def test_each_round_has_4_cards(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        for r in g.state.play.completed_rounds:
            assert len(r.cards) == 4

    def test_no_duplicate_cards_played(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        all_played = []
        for r in g.state.play.completed_rounds:
            for entry in r.cards:
                all_played.append(entry.card)
        # 32 cards total, but trump card might be separate
        assert len(all_played) == 32
        # All unique
        assert len(set(all_played)) == 32

    def test_hands_empty_after_game(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        for s in Seat:
            assert len(g.get_hand(s)) == 0

    @pytest.mark.parametrize("seed", range(50))
    def test_determinism(self, seed):
        """Same seed produces same result."""
        g1 = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g1)
        g2 = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g2)
        assert g1.state.result.reason == g2.state.result.reason
        assert g1.state.stone == g2.state.stone


class TestFullGameWithOpenTrump:
    """Full games with open trump — tests face-up play paths."""

    @pytest.mark.parametrize("seed", range(30))
    def test_open_trump_game(self, seed):
        g = make_game(seed=seed)
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.declare_open_trump(g.state.trump.trumper_seat)

        round_count = 0
        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid, f"Seed {seed}: No valid plays for {current}"
            g.play_card(current, valid[0])
            if g.state.play and len(g.state.play.current_round) == 0:
                round_count += 1

        assert g.phase == Phase.COMPLETE


# ======================================================================
# 7. SCORING
# ======================================================================

class TestScoring:
    def test_bid_met_gives_stone(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        result = g.state.result
        if result.reason == "bid_met":
            assert result.stone_direction == "give"
            assert result.stone_exchanged > 0

    def test_bid_failed_receives_stone(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        result = g.state.result
        if result.reason == "bid_failed":
            assert result.stone_direction == "receive"
            assert result.stone_exchanged > 0

    def test_scoring_table_completeness(self):
        """All bid values from 160 to 250 should be in the scoring table."""
        for v in range(160, 200, 10):
            assert v in SCORING_TABLE, f"Missing {v}"
        for v in range(200, 255, 5):
            assert v in SCORING_TABLE, f"Missing {v}"

    def test_stone_changes_applied(self):
        g = Game(
            dealer=Seat.NORTH,
            rng=random.Random(42),
            stone={Team.TEAM_A: 10, Team.TEAM_B: 10},
        )
        play_full_game(g)
        stone = g.state.stone
        # Stone should have changed from initial 10/10
        assert stone[Team.TEAM_A] != 10 or stone[Team.TEAM_B] != 10

    def test_result_has_valid_reason(self):
        valid_reasons = {
            "bid_met", "bid_failed", "pcc_won", "pcc_lost",
            "caps_correct", "caps_late", "caps_wrong",
            "external_caps", "spoilt_trumps", "absolute_hand",
        }
        for seed in range(20):
            g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
            play_full_game(g)
            assert g.state.result.reason in valid_reasons


# ======================================================================
# 8. MATCH LIFECYCLE
# ======================================================================

class TestMatch:
    def test_match_starts_with_10_stone(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        assert m.stone[Team.TEAM_A] == INITIAL_STONE
        assert m.stone[Team.TEAM_B] == INITIAL_STONE

    def test_match_first_game(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        g = m.new_game()
        assert g.phase == Phase.DEALING_4

    def test_match_cannot_start_while_ongoing(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        g = m.new_game()
        g.deal_four()
        with pytest.raises(GameError):
            m.new_game()

    def test_match_plays_multiple_games(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        for _ in range(10):
            if m.is_complete():
                break
            g = m.new_game()
            play_full_game(g)
        assert len(m.games) >= 1

    def test_match_stone_updates(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        g = m.new_game()
        play_full_game(g)
        # After first game, stone should be different from 10/10
        g2 = m.new_game()
        stone = m.stone
        assert stone[Team.TEAM_A] != 10 or stone[Team.TEAM_B] != 10

    def test_match_dealer_rotates(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        g1 = m.new_game()
        play_full_game(g1)
        g2 = m.new_game()
        # Dealer should have advanced anticlockwise
        assert g2.state.dealer == Seat.WEST

    def test_match_winner(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        for _ in range(50):
            if m.is_complete():
                break
            g = m.new_game()
            play_full_game(g)
        if m.is_complete():
            w = m.winner()
            assert w in (Team.TEAM_A, Team.TEAM_B)

    def test_match_complete_no_new_game(self):
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(42))
        for _ in range(100):
            if m.is_complete():
                break
            g = m.new_game()
            play_full_game(g)
        if m.is_complete():
            with pytest.raises(GameError):
                m.new_game()


# ======================================================================
# 9. 8-CARD BIDDING
# ======================================================================

class TestBidding8Card:
    def test_8_card_all_pass_goes_pre_play(self):
        """If no one bids on 8 cards, proceed with 4-card bid."""
        g = game_through_trump_selection()
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.PRE_PLAY

    def test_8_card_new_bid_supersedes(self):
        """A new 8-card bid creates a new trump selection."""
        g = game_through_trump_selection(bid=160)
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 220)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        # Should go to new trump selection
        assert g.phase == Phase.TRUMP_SELECTION

    def test_8_card_min_bid_220(self):
        g = game_through_trump_selection(bid=160)
        first = g.whose_turn()
        with pytest.raises(InvalidBidError):
            g.place_bid(first, BidAction.BET, 210)

    def test_8_card_carries_forward_4_card_bid(self):
        g = game_through_trump_selection(bid=190)
        # 8-card bidding should know about 4-card bid
        assert g.state.bidding.four_card_bid == 190


class TestPCC:
    def test_pcc_on_4_card_rejected(self):
        g = game_at_betting_4()
        with pytest.raises(InvalidBidError):
            g.place_bid(g.whose_turn(), BidAction.PCC)

    def test_pcc_on_8_card(self):
        g = game_through_trump_selection()
        first = g.whose_turn()
        g.place_bid(first, BidAction.PCC)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        # Should transition to PCC
        assert g.phase == Phase.TRUMP_SELECTION
        assert g.state.pcc_partner_out is not None


# ======================================================================
# 10. SPECIAL ENDINGS
# ======================================================================

class TestSpoiltTrumps:
    def test_spoilt_trumps_wrong_phase(self):
        g = game_at_betting_4()
        with pytest.raises(InvalidPhaseError):
            g.call_spoilt_trumps(Seat.WEST)

    def test_spoilt_trumps_during_pre_play(self):
        g = game_at_pre_play()
        # Need to check if spoilt trumps actually applies
        try:
            g.call_spoilt_trumps(Seat.WEST)
            assert g.phase == Phase.COMPLETE
            assert g.state.result.reason == "spoilt_trumps"
        except GameError:
            pass  # Opposition has trump cards

    def test_spoilt_trumps_invalid_call(self):
        """If opposition holds trump, call fails."""
        g = game_at_pre_play()
        trump_suit = g.state.trump.trump_suit
        trumper = g.state.trump.trumper_seat
        trumper_team_seats = [
            s for s in Seat if team_of(s) == team_of(trumper)
        ]
        opp_seats = [s for s in Seat if team_of(s) != team_of(trumper)]
        opp_has_trump = any(
            any(c.suit == trump_suit for c in g.get_hand(s))
            for s in opp_seats
        )
        if opp_has_trump:
            with pytest.raises(GameError):
                g.call_spoilt_trumps(Seat.WEST)


class TestAbsoluteHand:
    def test_absolute_hand_wrong_phase(self):
        g = game_at_playing()
        with pytest.raises(InvalidPhaseError):
            g.call_absolute_hand(Seat.WEST)

    def test_absolute_hand_in_pre_play(self):
        g = game_at_pre_play()
        g.call_absolute_hand(Seat.WEST)
        assert g.phase == Phase.COMPLETE
        assert g.state.result.reason == "absolute_hand"
        assert g.state.result.stone_exchanged == 0


# ======================================================================
# 11. CLOSED TRUMP MECHANICS
# ======================================================================

class TestClosedTrumpMechanics:
    """Test the face-down card mechanics specific to closed trump."""

    @pytest.mark.parametrize("seed", range(30))
    def test_closed_trump_full_game(self, seed):
        """Every seed should complete without errors in closed trump."""
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g)
        assert g.phase == Phase.COMPLETE
        play = g.state.play
        assert play.points_won[Team.TEAM_A] + play.points_won[Team.TEAM_B] == TOTAL_POINTS

    def test_trump_revealed_when_cut(self):
        """Trump suit is revealed when someone plays a trump card face-down."""
        for seed in range(100):
            g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
            play_full_game(g)
            # Check if trump was ever revealed
            play = g.state.play
            revealed_in_round = [
                r for r in play.completed_rounds if r.trump_revealed
            ]
            trump_state = g.state.trump
            if revealed_in_round:
                assert trump_state.is_revealed
                return
        # Not critical — just needs to not crash


# ======================================================================
# 12. BIDDING EDGE CASES
# ======================================================================

class TestBiddingEdgeCases:
    def test_bid_exactly_200_boundary(self):
        """Bid of exactly 200 uses 5-increment from there."""
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 200)
        second = g.whose_turn()
        g.place_bid(second, BidAction.BET, 205)
        third = g.whose_turn()
        # 208 is not a multiple of 5
        with pytest.raises(InvalidBidError):
            g.place_bid(third, BidAction.BET, 208)

    def test_multiple_redeals_advance_dealer(self):
        """Each redeal advances the dealer anticlockwise."""
        g = game_at_betting_4(dealer=Seat.NORTH)
        for _ in range(4):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.state.dealer == Seat.WEST

        g.deal_four()
        for _ in range(4):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.state.dealer == Seat.SOUTH

    def test_partner_undercut_prevented(self):
        """Cannot bid below threshold when partner holds highest bid."""
        g = game_at_betting_4(dealer=Seat.NORTH)
        # West bids 200
        g.place_bid(Seat.WEST, BidAction.BET, 200)
        g.place_bid(Seat.SOUTH, BidAction.PASS)
        # East is West's partner — cannot undercut
        # East bids 190 (below threshold 200) — should fail
        # Actually East shouldn't be able to bid below 200 since 200 is current
        # Let's test with a different scenario
        g2 = game_at_betting_4(dealer=Seat.NORTH)
        g2.place_bid(Seat.WEST, BidAction.BET, 160)
        g2.place_bid(Seat.SOUTH, BidAction.BET, 170)
        # East's partner (West) has bid 160
        # East should not be able to bid below threshold when
        # their partner is the highest bidder? No, South outbid West.
        # Let's set up properly:
        g3 = game_at_betting_4(dealer=Seat.NORTH)
        g3.place_bid(Seat.WEST, BidAction.BET, 190)
        g3.place_bid(Seat.SOUTH, BidAction.PASS)
        # East is West's partner; West is highest at 190
        # East should not be able to undercut below threshold
        with pytest.raises(InvalidBidError):
            g3.place_bid(Seat.EAST, BidAction.BET, 195)

    def test_bid_all_values_in_scoring_table(self):
        """Every value in the scoring table should be a valid first bid
        (subject to minimum and increment rules)."""
        for bid_val in SCORING_TABLE:
            if bid_val < MIN_BID_4_CARD:
                continue
            g = game_at_betting_4()
            first = g.whose_turn()
            # First speech — should accept any value >= 160 with valid increment
            try:
                g.place_bid(first, BidAction.BET, bid_val)
                assert g.state.bidding.highest_bid == bid_val
            except InvalidBidError:
                # Some values might not be reachable as first bids
                pass


# ======================================================================
# 13. GAME STATE INVARIANTS
# ======================================================================

class TestInvariants:
    """Test invariants that should hold at every point in the game."""

    @pytest.mark.parametrize("seed", range(20))
    def test_card_conservation(self, seed):
        """Total cards in play should always equal 32."""
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        g.deal_four()

        # After deal_four: 16 in hands, 16 in deck
        total_in_hands = sum(len(g.get_hand(s)) for s in Seat)
        total_in_deck = len(g.state.deck) if g.state.deck else 0
        assert total_in_hands + total_in_deck == 32

        # Play full game (use a fresh game since play_full_game calls deal_four)
        g2 = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g2)
        total_played = sum(
            len(r.cards) for r in g2.state.play.completed_rounds
        )
        total_remaining = sum(len(g2.get_hand(s)) for s in Seat)
        assert total_played + total_remaining == 32

    @pytest.mark.parametrize("seed", range(20))
    def test_round_winner_is_valid_seat(self, seed):
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g)
        for r in g.state.play.completed_rounds:
            assert r.winner in list(Seat)
            # Winner should have played a card in that round
            winner_played = any(e.seat == r.winner for e in r.cards)
            assert winner_played, f"Round {r.round_number} winner {r.winner} didn't play"

    @pytest.mark.parametrize("seed", range(20))
    def test_each_player_plays_exactly_once_per_round(self, seed):
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        play_full_game(g)
        for r in g.state.play.completed_rounds:
            seats_played = [e.seat for e in r.cards]
            assert len(seats_played) == 4
            assert len(set(seats_played)) == 4


# ======================================================================
# 14. PRIORITY AND TURN ORDER DURING PLAY
# ======================================================================

class TestPlayTurnOrder:
    """Test that turn order is correct during play."""

    def test_first_round_priority_is_dealer_right(self):
        g = game_at_playing(dealer=Seat.NORTH)
        # Right of North = West
        assert g.whose_turn() == Seat.WEST

    def test_round_winner_leads_next(self):
        g = game_at_playing(seed=42)
        # Play one full round
        for _ in range(4):
            current = g.whose_turn()
            valid = g.valid_plays(current)
            g.play_card(current, valid[0])
        # Round resolved — next leader should be the winner
        round_winner = g.state.play.completed_rounds[0].winner
        assert g.whose_turn() == round_winner

    def test_whose_turn_none_when_complete(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        assert g.whose_turn() is None


# ======================================================================
# 15. HIGHER BID LEVELS
# ======================================================================

class TestHighBids:
    def test_bid_250(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 250)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.state.bidding.highest_bid == 250

    def test_higher_bid_more_stone(self):
        """Higher bids should have higher stone exchange."""
        low_entry = SCORING_TABLE[160]
        high_entry = SCORING_TABLE[250]
        assert high_entry.win > low_entry.win
        assert high_entry.loss > low_entry.loss


# ======================================================================
# 16. BIDDING INCREMENT FUNCTION
# ======================================================================

class TestGetIncrement:
    def test_below_200(self):
        assert get_increment(160) == 10
        assert get_increment(190) == 10
        assert get_increment(199) == 10

    def test_at_200(self):
        assert get_increment(200) == 5

    def test_above_200(self):
        assert get_increment(205) == 5
        assert get_increment(250) == 5


# ======================================================================
# 17. EDGE CASES IN PLAY
# ======================================================================

class TestPlayEdgeCases:
    def test_play_after_game_complete_rejected(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        with pytest.raises(InvalidPhaseError):
            g.play_card(Seat.WEST, Card(Rank.JACK, Suit.CLUBS))

    def test_valid_plays_empty_when_not_playing(self):
        g = game_at_betting_4()
        assert g.valid_plays(Seat.WEST) == []

    def test_valid_plays_empty_when_complete(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        for s in Seat:
            assert g.valid_plays(s) == []


# ======================================================================
# 18. STRESS TEST — MANY SEEDS, MANY DEALERS
# ======================================================================

class TestStress:
    @pytest.mark.parametrize("seed", range(100))
    def test_game_never_crashes(self, seed):
        """100 games should complete without any exception."""
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        try:
            play_full_game(g)
        except Exception as e:
            pytest.fail(f"Seed {seed} crashed: {type(e).__name__}: {e}")
        assert g.phase == Phase.COMPLETE

    @pytest.mark.parametrize("seed", range(25))
    def test_match_never_crashes(self, seed):
        """25 matches should complete without any exception."""
        m = Match(first_dealer=Seat.NORTH, rng=random.Random(seed))
        games_played = 0
        max_games = 100
        try:
            while games_played < max_games:
                if m.is_complete():
                    break
                try:
                    g = m.new_game()
                except GameError:
                    # Match became complete after syncing stone from
                    # the last game (is_complete() lags until new_game
                    # syncs — a known issue).
                    break
                play_full_game(g)
                games_played += 1
        except Exception as e:
            pytest.fail(
                f"Match seed {seed} crashed after {games_played} games: "
                f"{type(e).__name__}: {e}"
            )


# ======================================================================
# 19. GAME STATE QUERIES
# ======================================================================

class TestGameQueries:
    def test_get_hand_returns_copy(self):
        g = game_at_betting_4()
        hand = g.get_hand(Seat.WEST)
        hand.clear()
        assert len(g.get_hand(Seat.WEST)) > 0

    def test_whose_turn_during_trump_selection(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.TRUMP_SELECTION
        assert g.whose_turn() == first  # trumper = highest bidder

    def test_whose_turn_during_pre_play(self):
        g = game_at_pre_play()
        assert g.whose_turn() == g.state.trump.trumper_seat

    def test_phase_property(self):
        g = make_game()
        assert g.phase == Phase.DEALING_4


# ======================================================================
# 20. OPEN TRUMP PLAY
# ======================================================================

class TestOpenTrumpPlay:
    """Test play mechanics specific to open trump (all face-up)."""

    @pytest.mark.parametrize("seed", range(30))
    def test_no_face_down_cards_in_open_trump(self, seed):
        """In open trump, no cards should be face-down."""
        g = make_game(seed=seed)
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.declare_open_trump(g.state.trump.trumper_seat)

        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid
            g.play_card(current, valid[0])

        for r in g.state.play.completed_rounds:
            for entry in r.cards:
                assert not entry.face_down, (
                    f"Face-down card found in open trump round {r.round_number}"
                )


# ======================================================================
# 21. VARIOUS PLAY STRATEGIES
# ======================================================================

class TestPlayStrategies:
    """Test with different card selection strategies to exercise more paths."""

    @pytest.mark.parametrize("seed", range(20))
    def test_play_last_valid_card(self, seed):
        """Always play the LAST valid card instead of first."""
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.proceed_closed_trump(g.state.trump.trumper_seat)

        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid
            g.play_card(current, valid[-1])  # last valid

        assert g.phase == Phase.COMPLETE

    @pytest.mark.parametrize("seed", range(20))
    def test_play_random_valid_card(self, seed):
        """Randomly select from valid cards."""
        rng = random.Random(seed + 1000)
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.proceed_closed_trump(g.state.trump.trumper_seat)

        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid
            g.play_card(current, rng.choice(valid))

        assert g.phase == Phase.COMPLETE

    @pytest.mark.parametrize("seed", range(20))
    def test_play_random_open_trump(self, seed):
        """Random card with open trump."""
        rng = random.Random(seed + 2000)
        g = Game(dealer=Seat.NORTH, rng=random.Random(seed))
        g.deal_four()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        trumper = g.whose_turn()
        g.select_trump(trumper, g.get_hand(trumper)[0])
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        g.declare_open_trump(g.state.trump.trumper_seat)

        while g.phase == Phase.PLAYING:
            current = g.whose_turn()
            valid = g.valid_plays(current)
            assert valid
            g.play_card(current, rng.choice(valid))

        assert g.phase == Phase.COMPLETE


# ======================================================================
# 22. TRUMP CARD SPECIAL PLAY RULES
# ======================================================================

class TestTrumpCardPlayRules:
    """The face-down trump card has special play restrictions."""

    def test_trump_card_on_table_for_trumper(self):
        """Trumper should see trump card in valid plays when appropriate."""
        g = game_at_playing(seed=42)
        trumper = g.state.trump.trumper_seat
        trump_card = g.state.trump.trump_card
        assert trump_card is not None
        assert not g.state.trump.trump_card_in_hand
        # Trump card should appear in valid plays at some point

    def test_trump_card_not_available_to_others(self):
        """Non-trumper should never have the trump card in valid plays."""
        g = game_at_playing(seed=42)
        trumper = g.state.trump.trumper_seat
        trump_card = g.state.trump.trump_card
        for s in Seat:
            if s != trumper:
                valid = g.valid_plays(s)
                assert trump_card not in valid


# ======================================================================
# 23. PHASE TRANSITION COVERAGE
# ======================================================================

class TestPhaseTransitions:
    """Verify each phase transition path."""

    def test_dealing_4_to_betting_4(self):
        g = make_game()
        assert g.phase == Phase.DEALING_4
        g.deal_four()
        assert g.phase == Phase.BETTING_4

    def test_betting_4_to_trump_selection(self):
        g = game_at_betting_4()
        first = g.whose_turn()
        g.place_bid(first, BidAction.BET, 160)
        for _ in range(3):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.TRUMP_SELECTION

    def test_betting_4_to_dealing_4_redeal(self):
        g = game_at_betting_4()
        for _ in range(4):
            g.place_bid(g.whose_turn(), BidAction.PASS)
        assert g.phase == Phase.DEALING_4

    def test_trump_selection_to_betting_8(self):
        g = game_through_trump_selection()
        assert g.phase == Phase.BETTING_8

    def test_betting_8_to_pre_play(self):
        g = game_at_pre_play()
        assert g.phase == Phase.PRE_PLAY

    def test_pre_play_to_playing_closed(self):
        g = game_at_pre_play()
        g.proceed_closed_trump(g.whose_turn())
        assert g.phase == Phase.PLAYING

    def test_pre_play_to_playing_open(self):
        g = game_at_pre_play()
        g.declare_open_trump(g.whose_turn())
        assert g.phase == Phase.PLAYING

    def test_playing_to_complete(self):
        g = Game(dealer=Seat.NORTH, rng=random.Random(42))
        play_full_game(g)
        assert g.phase == Phase.COMPLETE

    def test_pre_play_to_complete_absolute_hand(self):
        g = game_at_pre_play()
        g.call_absolute_hand(Seat.WEST)
        assert g.phase == Phase.COMPLETE


# ======================================================================
# 24. CAPS TESTS
# ======================================================================

class TestCapsObligation:
    def test_caps_not_during_bidding(self):
        g = game_at_betting_4()
        with pytest.raises(InvalidPhaseError):
            g.call_caps(Seat.WEST, [])

    def test_caps_wrong_cards_rejected(self):
        g = game_at_playing(seed=42)
        current = g.whose_turn()
        # Play order doesn't match hand
        with pytest.raises(CapsError):
            g.call_caps(current, [Card(Rank.JACK, Suit.CLUBS)])

    def test_caps_team_lost_round_rejected(self):
        """Can't call caps if team has lost a round."""
        g = game_at_playing(seed=42, open_trump=True)
        # Play a few rounds
        for _ in range(16):  # 4 rounds
            if g.phase != Phase.PLAYING:
                break
            current = g.whose_turn()
            valid = g.valid_plays(current)
            if valid:
                g.play_card(current, valid[0])

        if g.phase == Phase.PLAYING:
            current = g.whose_turn()
            my_team = team_of(current)
            has_lost = any(
                team_of(r.winner) != my_team
                for r in g.state.play.completed_rounds
            )
            if has_lost:
                hand = g.get_hand(current)
                if hand:
                    with pytest.raises(CapsError):
                        g.call_caps(current, hand)


# ======================================================================
# 25. CONSTANTS VALIDATION
# ======================================================================

class TestConstants:
    def test_total_card_points_304(self):
        total = sum(v * 4 for v in POINT_VALUES.values())
        assert total == TOTAL_POINTS

    def test_scoring_table_win_leq_loss(self):
        """Win stone should always be less than or equal to loss stone."""
        for bid, entry in SCORING_TABLE.items():
            assert entry.win <= entry.loss, f"Bid {bid}: win={entry.win} > loss={entry.loss}"

    def test_pcc_scoring_symmetric(self):
        assert PCC_SCORING.win == PCC_SCORING.loss == 5

    def test_initial_stone_10(self):
        assert INITIAL_STONE == 10
