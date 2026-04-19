import { BID_NAMES } from '../types/game';

export function bidDisplayName(value: number): string {
  return BID_NAMES[value] || String(value);
}

export function getNextValidBids(currentBid: number, isFourCard: boolean): number[] {
  const bids: number[] = [];
  const min = isFourCard ? 160 : 220;

  let start = currentBid === 0 ? min : currentBid;
  // Determine increment from current bid
  if (start < 200) {
    start = currentBid === 0 ? min : currentBid + 10;
  } else {
    start = currentBid === 0 ? min : currentBid + 5;
  }

  for (let v = start; v <= 250; ) {
    bids.push(v);
    if (v < 200) v += 10;
    else v += 5;
  }

  return bids;
}
