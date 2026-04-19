import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getNextValidBids, bidDisplayName } from '../../utils/bidUtils';
import { handPoints } from '../../utils/cardUtils';
import { SEAT_NAMES } from '../../types/game';
import styles from './SubActions.module.css';

export default function BiddingActions() {
  const bid = useGameStore(s => s.bid);
  const reshuffle = useGameStore(s => s.reshuffle);
  const redeal8 = useGameStore(s => s.redeal8);
  const gameState = useGameStore(s => s.gameState);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const hands = useGameStore(s => s.hands);

  const bidding = gameState?.bidding;
  const isFourCard = bidding?.is_four_card ?? true;
  const currentBid = bidding?.highest_bid ?? 0;
  const pending = bidding?.pending_partner;

  const validBids = getNextValidBids(currentBid, isFourCard);
  const [selectedBid, setSelectedBid] = useState(validBids[0] || 160);

  // Hand points for reshuffle/redeal check
  const turnHand = whoseTurn ? hands[whoseTurn] || [] : [];
  const pts = handPoints(turnHand);

  const canReshuffle = isFourCard && pts < 15;
  const canRedeal = !isFourCard && pts < 25;

  // Determine available actions
  const isPendingPartner = !!pending;
  const bidAction = isPendingPartner ? 'bet_for_partner' : 'bet';
  const passAction = isPendingPartner ? 'pass_for_partner' : 'pass';

  // Check if partner action is available
  const canPartner = !isPendingPartner && whoseTurn && bidding?.player_state?.[whoseTurn]?.speech_count === 0 && !bidding?.player_state?.[whoseTurn]?.has_partnered;

  return (
    <div className={styles.column}>
      {/* Current bid info */}
      <div className={styles.info}>
        {currentBid > 0 ? (
          <>Current: <strong>{bidDisplayName(currentBid)} ({currentBid})</strong> by {bidding?.highest_bidder ? SEAT_NAMES[bidding.highest_bidder] : '?'}</>
        ) : (
          <>No bids yet. Min: {isFourCard ? '60 (160)' : 'Honest (220)'}</>
        )}
        {isFourCard && bidding?.four_card_bid == null && <span className={styles.hint}> | 4-card round</span>}
        {!isFourCard && bidding?.four_card_bid != null && (
          <span className={styles.hint}> | 4-card: {bidDisplayName(bidding.four_card_bid)} ({bidding.four_card_bid})</span>
        )}
      </div>

      {isPendingPartner && pending && (
        <div className={styles.info}>
          <strong>{SEAT_NAMES[pending.partner_seat]}</strong> bidding for <strong>{SEAT_NAMES[pending.original_seat]}</strong>
        </div>
      )}

      {/* Bid selector + Bet button */}
      <div className={styles.row}>
        <select
          value={selectedBid}
          onChange={e => setSelectedBid(Number(e.target.value))}
          className={styles.select}
        >
          {validBids.map(v => (
            <option key={v} value={v}>{bidDisplayName(v)} ({v})</option>
          ))}
        </select>
        <button className="primary" onClick={() => bid(bidAction, selectedBid)}>
          {isPendingPartner ? 'Bet (Partner)' : 'Bet'}
        </button>
      </div>

      {/* Pass, Partner, PCC */}
      <div className={styles.row}>
        <button className="secondary" onClick={() => bid(passAction)}>
          {isPendingPartner ? 'Pass (Partner)' : 'Pass'}
        </button>
        {canPartner && isFourCard && (
          <button className="secondary" onClick={() => bid('partner')}>Partner</button>
        )}
        {!isFourCard && !isPendingPartner && (
          <button className="primary" onClick={() => bid('pcc')}>PCC</button>
        )}
      </div>

      {/* Reshuffle / Redeal */}
      {canReshuffle && (
        <button className="ghost" onClick={reshuffle}>
          Reshuffle ({pts} pts &lt; 15)
        </button>
      )}
      {canRedeal && (
        <button className="ghost" onClick={redeal8}>
          Redeal ({pts} pts &lt; 25)
        </button>
      )}
    </div>
  );
}
