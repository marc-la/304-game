import type { CardData, Suit, Rank } from '../types/game';
import { SUIT_SYMBOLS, RANK_ORDER } from '../types/game';

export function suitColor(suit: Suit): string {
  return suit === 'h' || suit === 'd' ? 'var(--color-suit-red)' : 'var(--color-suit-black)';
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function cardLabel(card: CardData): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

const SUIT_SORT_ORDER: Suit[] = ['s', 'c', 'h', 'd']; // black then red

export function sortHand(cards: CardData[]): CardData[] {
  return [...cards].sort((a, b) => {
    const suitDiff = SUIT_SORT_ORDER.indexOf(a.suit) - SUIT_SORT_ORDER.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
}

export function handPoints(cards: CardData[]): number {
  return cards.reduce((sum, c) => sum + c.points, 0);
}

export function isCardInList(card: CardData, list: CardData[]): boolean {
  return list.some(c => c.str === card.str);
}
