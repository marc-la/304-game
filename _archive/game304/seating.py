"""Seat navigation helpers for the 304 card game.

All movement around the table follows anticlockwise order:
North -> West -> South -> East -> North.

Partners sit opposite each other:
- North and South (Team A)
- East and West (Team B)
"""

from game304.types import Seat, Team

# Anticlockwise order around the table
ANTICLOCKWISE: tuple[Seat, ...] = (Seat.NORTH, Seat.WEST, Seat.SOUTH, Seat.EAST)

_SEAT_INDEX: dict[Seat, int] = {seat: i for i, seat in enumerate(ANTICLOCKWISE)}


def next_seat(seat: Seat) -> Seat:
    """Return the next seat in anticlockwise order.

    This is the player to the given seat's *right* at the table.

    Examples:
        >>> next_seat(Seat.NORTH)
        <Seat.WEST: 'west'>
        >>> next_seat(Seat.EAST)
        <Seat.NORTH: 'north'>
    """
    return ANTICLOCKWISE[(_SEAT_INDEX[seat] + 1) % 4]


def prev_seat(seat: Seat) -> Seat:
    """Return the previous seat in anticlockwise order (i.e. clockwise neighbour).

    This is the player to the given seat's *left* at the table.
    """
    return ANTICLOCKWISE[(_SEAT_INDEX[seat] - 1) % 4]


def partner_seat(seat: Seat) -> Seat:
    """Return the partner's seat (directly opposite).

    North <-> South, East <-> West.
    """
    return ANTICLOCKWISE[(_SEAT_INDEX[seat] + 2) % 4]


def team_of(seat: Seat) -> Team:
    """Return the team that a seat belongs to.

    North and South are Team A; East and West are Team B.
    """
    if seat in (Seat.NORTH, Seat.SOUTH):
        return Team.TEAM_A
    return Team.TEAM_B


def same_team(a: Seat, b: Seat) -> bool:
    """Check if two seats are on the same team."""
    return team_of(a) == team_of(b)


def deal_order(dealer: Seat) -> list[Seat]:
    """Return the dealing/play order starting from the player to the dealer's right.

    Cards are dealt anticlockwise, beginning with the player to the
    dealer's right (i.e. ``next_seat(dealer)``).

    Args:
        dealer: The seat of the dealer.

    Returns:
        A list of 4 seats in dealing order.

    Examples:
        >>> deal_order(Seat.NORTH)
        [<Seat.WEST: 'west'>, <Seat.SOUTH: 'south'>, <Seat.EAST: 'east'>, <Seat.NORTH: 'north'>]
    """
    first = next_seat(dealer)
    idx = _SEAT_INDEX[first]
    return [ANTICLOCKWISE[(idx + i) % 4] for i in range(4)]


def cutter_seat(dealer: Seat) -> Seat:
    """Return the seat of the player who cuts the deck (to the dealer's left)."""
    return prev_seat(dealer)
