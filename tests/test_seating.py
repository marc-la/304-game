"""Tests for seat navigation helpers."""

from game304 import Seat, Team, deal_order, next_seat, partner_seat, prev_seat, team_of
from game304.seating import cutter_seat, same_team


class TestNextSeat:
    def test_anticlockwise_order(self):
        assert next_seat(Seat.NORTH) == Seat.WEST
        assert next_seat(Seat.WEST) == Seat.SOUTH
        assert next_seat(Seat.SOUTH) == Seat.EAST
        assert next_seat(Seat.EAST) == Seat.NORTH

    def test_full_cycle(self):
        seat = Seat.NORTH
        visited = []
        for _ in range(4):
            visited.append(seat)
            seat = next_seat(seat)
        assert visited == [Seat.NORTH, Seat.WEST, Seat.SOUTH, Seat.EAST]
        assert seat == Seat.NORTH


class TestPrevSeat:
    def test_clockwise_order(self):
        assert prev_seat(Seat.NORTH) == Seat.EAST
        assert prev_seat(Seat.EAST) == Seat.SOUTH

    def test_prev_is_inverse_of_next(self):
        for seat in Seat:
            assert prev_seat(next_seat(seat)) == seat


class TestPartnerSeat:
    def test_partners(self):
        assert partner_seat(Seat.NORTH) == Seat.SOUTH
        assert partner_seat(Seat.SOUTH) == Seat.NORTH
        assert partner_seat(Seat.EAST) == Seat.WEST
        assert partner_seat(Seat.WEST) == Seat.EAST

    def test_partner_is_involution(self):
        for seat in Seat:
            assert partner_seat(partner_seat(seat)) == seat


class TestTeamOf:
    def test_teams(self):
        assert team_of(Seat.NORTH) == Team.TEAM_A
        assert team_of(Seat.SOUTH) == Team.TEAM_A
        assert team_of(Seat.EAST) == Team.TEAM_B
        assert team_of(Seat.WEST) == Team.TEAM_B


class TestSameTeam:
    def test_same_team(self):
        assert same_team(Seat.NORTH, Seat.SOUTH)
        assert same_team(Seat.EAST, Seat.WEST)
        assert not same_team(Seat.NORTH, Seat.EAST)


class TestDealOrder:
    def test_deal_order_north_dealer(self):
        order = deal_order(Seat.NORTH)
        assert order == [Seat.WEST, Seat.SOUTH, Seat.EAST, Seat.NORTH]

    def test_deal_order_starts_right_of_dealer(self):
        for dealer in Seat:
            order = deal_order(dealer)
            assert order[0] == next_seat(dealer)
            assert len(order) == 4


class TestCutterSeat:
    def test_cutter_is_left_of_dealer(self):
        assert cutter_seat(Seat.NORTH) == Seat.EAST
        assert cutter_seat(Seat.WEST) == Seat.NORTH
