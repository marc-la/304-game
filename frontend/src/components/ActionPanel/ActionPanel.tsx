import { useGameStore } from '../../store/gameStore';
import DealingActions from './DealingActions';
import BiddingActions from './BiddingActions';
import TrumpActions from './TrumpActions';
import PrePlayActions from './PrePlayActions';
import PlayingActions from './PlayingActions';
import ResultDisplay from './ResultDisplay';
import styles from './ActionPanel.module.css';

export default function ActionPanel() {
  const phase = useGameStore(s => s.phase);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const loading = useGameStore(s => s.loading);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {phase && <div className={styles.phaseBadge}>{formatPhase(phase)}</div>}
        {whoseTurn && <div className={styles.turnLabel}>Turn: <strong>{whoseTurn.toUpperCase()}</strong></div>}
      </div>
      <div className={`${styles.actions} ${loading ? styles.loading : ''}`}>
        {(!phase || phase === 'dealing_4') && <DealingActions />}
        {(phase === 'betting_4' || phase === 'betting_8') && <BiddingActions />}
        {phase === 'trump_selection' && <TrumpActions />}
        {phase === 'dealing_8' && <DealingActions />}
        {phase === 'pre_play' && <PrePlayActions />}
        {phase === 'playing' && <PlayingActions />}
        {phase === 'complete' && <ResultDisplay />}
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
