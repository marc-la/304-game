import { useGameStore } from '../../store/gameStore';
import DealingActions from './DealingActions';
import BiddingActions from './BiddingActions';
import TrumpActions from './TrumpActions';
import PrePlayActions from './PrePlayActions';
import PlayingActions from './PlayingActions';
import ResultDisplay from './ResultDisplay';
import { SEAT_NAMES } from '../../types/game';
import styles from './ActionPanel.module.css';

export default function ActionPanel() {
  const phase = useGameStore(s => s.phase);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const mySeat = useGameStore(s => s.mySeat);
  const loading = useGameStore(s => s.loading);

  // In lobby mode, only show acting controls when it is the local
  // player's turn. Phases like spoilt-trumps / absolute-hand can be
  // called by any player, so PlayingActions remains visible to all
  // (the buttons inside handle their own seat-eligibility).
  const inLobbyMode = mySeat !== null;
  const isMyTurn = !inLobbyMode || whoseTurn === mySeat;
  const showTurnControls = isMyTurn || phase === 'playing';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {phase && <div className={styles.phaseBadge}>{formatPhase(phase)}</div>}
        {whoseTurn && (
          <div className={styles.turnLabel}>
            Turn: <strong>{SEAT_NAMES[whoseTurn]}</strong>
            {inLobbyMode && whoseTurn === mySeat && ' (you)'}
          </div>
        )}
      </div>
      <div className={`${styles.actions} ${loading ? styles.loading : ''}`}>
        {(!phase || phase === 'dealing_4') && <DealingActions />}
        {(phase === 'betting_4' || phase === 'betting_8') && showTurnControls && (
          <BiddingActions />
        )}
        {phase === 'trump_selection' && showTurnControls && <TrumpActions />}
        {phase === 'dealing_8' && <DealingActions />}
        {phase === 'pre_play' && showTurnControls && <PrePlayActions />}
        {phase === 'playing' && <PlayingActions />}
        {phase === 'complete' && <ResultDisplay />}
        {inLobbyMode && !isMyTurn && phase !== 'complete' && phase !== 'playing' && (
          <div className={styles.waitingMessage}>
            Waiting for {whoseTurn ? SEAT_NAMES[whoseTurn] : 'opponent'}…
          </div>
        )}
      </div>
    </div>
  );
}

function formatPhase(phase: string): string {
  const names: Record<string, string> = {
    dealing_4: 'Dealing (4)',
    betting_4: 'Bidding (4-card)',
    trump_selection: 'Trump Selection',
    dealing_8: 'Dealing (8)',
    betting_8: 'Bidding (8-card)',
    pre_play: 'Pre-Play',
    playing: 'Playing',
    round_resolution: 'Round Resolution',
    scrutiny: 'Scrutiny',
    complete: 'Complete',
  };
  return names[phase] || phase;
}
