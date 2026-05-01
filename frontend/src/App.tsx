import { useState, useCallback } from 'react';
import GameTable from './components/GameTable/GameTable';
import ActionPanel from './components/ActionPanel/ActionPanel';
import Sidebar from './components/Sidebar/Sidebar';
import ControlBar from './components/Controls/ControlBar';
import Lobby from './components/Lobby/Lobby';
import styles from './App.module.css';

export default function App() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<string | null>(null);

  const handleGameStart = useCallback((id: string, seat: string) => {
    setMatchId(id);
    setMySeat(seat);
  }, []);

  if (!matchId) {
    return <Lobby onGameStart={handleGameStart} />;
  }

  return (
    <div className={styles.app} data-match-id={matchId} data-my-seat={mySeat ?? undefined}>
      <ControlBar />
      <div className={styles.main}>
        <div className={styles.tableSection}>
          <GameTable />
        </div>
        <div className={styles.sideSection}>
          <ActionPanel />
          <Sidebar />
        </div>
      </div>
    </div>
  );
}
