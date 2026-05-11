import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import GameLog from './GameLog';
import ScoreSheet from './ScoreSheet';
import CompletedRounds from './CompletedRounds';
import DebugPanel from './DebugPanel';
import styles from './Sidebar.module.css';

const TABS = ['Log', 'Score', 'Rounds', 'Debug'] as const;
type Tab = typeof TABS[number];

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('Log');
  const showPoints = useGameStore(s => s.showPoints);
  const toggleShowPoints = useGameStore(s => s.toggleShowPoints);

  return (
    <div className={styles.sidebar}>
      <div className={styles.settings}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showPoints}
            onChange={toggleShowPoints}
          />
          <span>Show card point values</span>
        </label>
      </div>
      <div className={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {activeTab === 'Log' && <GameLog />}
        {activeTab === 'Score' && <ScoreSheet />}
        {activeTab === 'Rounds' && <CompletedRounds />}
        {activeTab === 'Debug' && <DebugPanel />}
      </div>
    </div>
  );
}
