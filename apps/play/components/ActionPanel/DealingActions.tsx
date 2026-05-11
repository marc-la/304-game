import { useGameStore } from '../../store/gameStore';
import styles from './SubActions.module.css';

export default function DealingActions() {
  const deal = useGameStore(s => s.deal);
  const phase = useGameStore(s => s.phase);

  return (
    <div className={styles.row}>
      <button className="primary" onClick={deal} disabled={phase !== 'dealing_4'}>
        Deal Cards
      </button>
    </div>
  );
}
