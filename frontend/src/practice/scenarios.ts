import type { Scenario } from './types';

/**
 * Hand-authored caps practice scenarios.
 *
 * Each scenario presents one decision point. The author has confirmed
 * by hand that ``shouldCall`` and ``correctOrder`` are correct under
 * the rules. The deductive context (``knownVoids``, the visible last
 * round, and the setup blurb) gives the player exactly the information
 * a real player at the table would have.
 *
 * To extend: add another entry. Keep difficulty graded (easy → hard).
 */

export const SCENARIOS: Scenario[] = [
  // -----------------------------------------------------------------
  {
    id: 's1-top-trumps',
    title: 'Top of the trumps',
    difficulty: 'easy',
    setup:
      'You are South, the trumper. Trump is Hearts; it was revealed in Round 2 ' +
      'when your partner cut a Spade lead. From Round 3 onward play has been ' +
      'face-up. You have priority for Round 5 (you won Round 4 by cutting with ' +
      'a low Heart).\n\n' +
      'Three rounds of off-suits have shown that opponents are running thin: West ' +
      'has been out of Diamonds and Clubs; East has been out of Clubs and Spades. ' +
      'You currently hold the four strongest Hearts in the deck.',
    trumpSuit: 'h',
    trumpMode: 'closed-post-reveal',
    trumperSeat: 'south',
    partnerSeat: 'north',
    yourSeat: 'south',
    yourHand: ['Jh', '9h', 'Ah', '10h'],
    currentRound: 5,
    yourPriority: true,
    latestRound: {
      roundNumber: 4,
      cards: [
        { seat: 'east', cardStr: 'Qd' },
        { seat: 'south', cardStr: '7h' },
        { seat: 'west', cardStr: '8d' },
        { seat: 'north', cardStr: '10d' },
      ],
      winner: 'south',
      pointsWon: 12,
    },
    knownVoids: {
      east: ['c', 's'],
      west: ['d', 'c'],
    },
    shouldCall: true,
    correctOrder: ['Jh', '9h', 'Ah', '10h'],
    rationale:
      'You hold the top four Hearts (J, 9, A, 10) — the four strongest cards in the ' +
      'pack. Lead them in power order. Whatever any other player does, your card ' +
      'wins each round; opponents must follow Hearts if they hold any (lower ones), ' +
      'and if they are out of Hearts they discard freely while you collect the trick.',
    hint: 'Power order in 304: J > 9 > A > 10 > K > Q > 8 > 7.',
  },

  // -----------------------------------------------------------------
  {
    id: 's2-partner-deduction',
    title: 'Partner deduction',
    difficulty: 'hard',
    setup:
      'You are South. Trump is Spades, played Open. Six rounds have been played; ' +
      'you won Round 6, so you have priority for Round 7.\n\n' +
      'Counting trumps: every Spade has been played out. Both opponents (West and ' +
      'East) failed to follow Diamonds in Round 4 — they are publicly out of ' +
      'Diamonds. By careful tracking you know that the only Diamonds still in play ' +
      'are your two cards (9♦, 7♦) and the J♦ — and the J♦ must be with your ' +
      'partner, since the opponents are void.\n\n' +
      "By elimination of every other card played, your partner's last two cards " +
      'are the J♦ and the A♥. Both opponents are out of Hearts as well.',
    trumpSuit: 's',
    trumpMode: 'open',
    trumperSeat: 'south',
    partnerSeat: 'north',
    yourSeat: 'south',
    yourHand: ['9d', '7d'],
    currentRound: 7,
    yourPriority: true,
    latestRound: {
      roundNumber: 6,
      cards: [
        { seat: 'east', cardStr: '8c' },
        { seat: 'south', cardStr: '7s' },
        { seat: 'west', cardStr: 'Qc' },
        { seat: 'north', cardStr: 'Kc' },
      ],
      winner: 'south',
      pointsWon: 5,
    },
    knownVoids: {
      east: ['d', 'h'],
      west: ['d', 'h'],
    },
    shouldCall: true,
    correctOrder: ['9d', '7d'],
    rationale:
      'Lead 9♦. Partner is forced to follow with their only Diamond, the J♦, which ' +
      'wins the round. Partner now has priority and only the A♥ left — they lead ' +
      'A♥ in Round 8, the highest remaining Heart. Both rounds are forced wins for ' +
      'your team. You are not relying on partner choosing well; they have no choice.',
    hint:
      'Caps via partner deduction is allowed when the rules force the partner\'s ' +
      'play, not when you hope they\'ll play well.',
  },

  // -----------------------------------------------------------------
  {
    id: 's3-too-early',
    title: 'Tempting, but too early',
    difficulty: 'medium',
    setup:
      'You are East. Trump is Diamonds, declared Open before play. The trumper ' +
      '(West) led the J♦ in Round 1 and has been winning steadily.\n\n' +
      'It is now Round 4. West won Round 3 and leads again. West has just played ' +
      'K♣; South (your partner) played 10♣. Your turn is next, with the trick on ' +
      'its way to you.\n\n' +
      'You hold strong Hearts (J♥, 9♥, A♥) plus Q♣ and 8♠. You\'re tempted: if ' +
      'your Q♣ wins this round somehow, you take priority and your Hearts run the ' +
      'table…',
    trumpSuit: 'd',
    trumpMode: 'open',
    trumperSeat: 'west',
    partnerSeat: 'south',
    yourSeat: 'east',
    yourHand: ['Jh', '9h', 'Ah', 'Qc', '8s'],
    currentRound: 4,
    yourPriority: false,
    currentRoundLeader: 'west',
    currentRoundCards: [
      { seat: 'west', cardStr: 'Kc' },
      { seat: 'south', cardStr: '10c' },
    ],
    knownVoids: {},
    shouldCall: false,
    rationale:
      'You can\'t call yet. Even if you take this round, the trumper still holds ' +
      'unknown trump cards (Diamonds) and could cut any of your Heart leads. Caps ' +
      'must be guaranteed, not hopeful — until you have evidence the trumper is out ' +
      'of trumps (or you can deduce it), this is Wrong/Early Caps territory and ' +
      'attracts the 5-stone penalty.',
    hint:
      'A correct Caps call requires that NO sequence of opposing plays beats you. ' +
      'An unaccounted trump in the trumper\'s hand defeats that condition.',
  },
];
