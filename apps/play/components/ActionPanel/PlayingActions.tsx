import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { SEAT_NAMES, BID_NAMES } from '../../types/game';
import type { CardData } from '../../types/game';
import { cardLabel } from '../../utils/cardUtils';
import styles from './SubActions.module.css';

export default function PlayingActions() {
  const spoiltTrumps = useGameStore(s => s.spoiltTrumps);
  const callCaps = useGameStore(s => s.callCaps);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const hands = useGameStore(s => s.hands);
  const gameState = useGameStore(s => s.gameState);
  const play = gameState?.play;
  const bidding = gameState?.bidding;
  const trump = gameState?.trump;

  const [capsMode, setCapsMode] = useState(false);
  const [capsOrder, setCapsOrder] = useState<string[]>([]);

  const bid = bidding?.highest_bid ?? 0;
  const bidName = BID_NAMES[bid] || String(bid);
  const trumperTeam = trump?.trumper_seat ? (trump.trumper_seat === 'north' || trump.trumper_seat === 'south' ? 'team_a' : 'team_b') : null;
  const oppTeam = trumperTeam === 'team_a' ? 'team_b' : 'team_a';

  const trumperPts = trumperTeam && play ? play.points_won[trumperTeam] : 0;
  const oppPts = oppTeam && play ? play.points_won[oppTeam] : 0;

  // Caps mode UI — use mySeat when available (lobby mode), fall back
  // to whoseTurn for solo dev.
  const mySeat = useGameStore(s => s.mySeat);
  const handSeat = mySeat ?? whoseTurn;
  const myHand = handSeat ? hands[handSeat] || [] : [];

  const handleCapsCardClick = (card: CardData) => {
    if (capsOrder.includes(card.str)) {
      setCapsOrder(capsOrder.filter(c => c !== card.str));
    } else {
      setCapsOrder([...capsOrder, card.str]);
    }
  };

  const confirmCaps = () => {
    callCaps(capsOrder);
    setCapsMode(false);
    setCapsOrder([]);
  };

  if (capsMode) {
    return (
      <div className={styles.column}>
        <div className={styles.info}>
          <strong>CAPS</strong> — Click cards in play order ({capsOrder.length}/{myHand.length})
        </div>
        <div className={styles.capsCards}>
          {myHand.map(card => (
            <button
              key={card.str}
              className={`${styles.capsCard} ${capsOrder.includes(card.str) ? styles.capsSelected : ''}`}
              onClick={() => handleCapsCardClick(card)}
            >
              {cardLabel(card)}
              {capsOrder.includes(card.str) && (
                <span className={styles.capsIndex}>{capsOrder.indexOf(card.str) + 1}</span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <button
            className="primary"
            onClick={confirmCaps}
            disabled={capsOrder.length !== myHand.length}
          >
            Confirm Caps
          </button>
          <button className="secondary" onClick={() => { setCapsMode(false); setCapsOrder([]); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.column}>
      <div className={styles.info}>
        Click a card to play. Turn: <strong>{whoseTurn ? SEAT_NAMES[whoseTurn] : '-'}</strong>
      </div>
      <div className={styles.info}>
        Bid: <strong>{bidName} ({bid})</strong> | Trumper: {trumperPts} pts | Opp: {oppPts} pts
      </div>
      <div className={styles.row}>
        <button className="ghost" onClick={() => setCapsMode(true)}>
          Call Caps
        </button>
        <button className="ghost" onClick={spoiltTrumps}>
          Spoilt Trumps
        </button>
      </div>
    </div>
  );
}
