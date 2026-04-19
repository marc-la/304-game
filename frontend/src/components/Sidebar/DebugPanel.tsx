import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import styles from './DebugPanel.module.css';

export default function DebugPanel() {
  const gameState = useGameStore(s => s.gameState);
  const [showRaw, setShowRaw] = useState(false);

  if (!gameState) {
    return <div className={styles.empty}>No game state</div>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.title}>State Summary</div>
        <div className={styles.field}>Phase: <strong>{gameState.phase}</strong></div>
        <div className={styles.field}>Dealer: <strong>{gameState.dealer}</strong></div>
        <div className={styles.field}>Game #: <strong>{gameState.game_number}</strong></div>
        <div className={styles.field}>Reshuffles: <strong>{gameState.consecutive_reshuffles}</strong></div>
        {gameState.pcc_partner_out && (
          <div className={styles.field}>PCC Out: <strong>{gameState.pcc_partner_out}</strong></div>
        )}
      </div>

      {gameState.trump.trumper_seat && (
        <div className={styles.section}>
          <div className={styles.title}>Trump</div>
          <div className={styles.field}>Trumper: <strong>{gameState.trump.trumper_seat}</strong></div>
          <div className={styles.field}>Suit: <strong>{gameState.trump.trump_suit || '?'}</strong></div>
          <div className={styles.field}>Revealed: <strong>{String(gameState.trump.is_revealed)}</strong></div>
          <div className={styles.field}>Open: <strong>{String(gameState.trump.is_open)}</strong></div>
          <div className={styles.field}>Card in hand: <strong>{String(gameState.trump.trump_card_in_hand)}</strong></div>
        </div>
      )}

      {gameState.bidding && (
        <div className={styles.section}>
          <div className={styles.title}>Bidding</div>
          <div className={styles.field}>4-card: <strong>{String(gameState.bidding.is_four_card)}</strong></div>
          <div className={styles.field}>Current: <strong>{gameState.bidding.current_bidder}</strong></div>
          <div className={styles.field}>Highest: <strong>{gameState.bidding.highest_bid}</strong> by {gameState.bidding.highest_bidder || 'none'}</div>
          <div className={styles.field}>Passes: <strong>{gameState.bidding.consecutive_passes}</strong></div>
          <div className={styles.field}>PCC: <strong>{String(gameState.bidding.is_pcc)}</strong></div>
        </div>
      )}

      {gameState.play && (
        <div className={styles.section}>
          <div className={styles.title}>Play</div>
          <div className={styles.field}>Round: <strong>{gameState.play.round_number}</strong></div>
          <div className={styles.field}>Priority: <strong>{gameState.play.priority || '-'}</strong></div>
          <div className={styles.field}>Turn: <strong>{gameState.play.current_turn || '-'}</strong></div>
          {Object.keys(gameState.play.caps_obligations).length > 0 && (
            <div className={styles.field}>
              Caps Obligations: <strong>{JSON.stringify(gameState.play.caps_obligations)}</strong>
            </div>
          )}
        </div>
      )}

      <button className="ghost" onClick={() => setShowRaw(!showRaw)}>
        {showRaw ? 'Hide' : 'Show'} Raw JSON
      </button>
      {showRaw && (
        <pre className={styles.raw}>{JSON.stringify(gameState, null, 2)}</pre>
      )}
    </div>
  );
}
