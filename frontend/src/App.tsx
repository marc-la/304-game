import { useState, useCallback, useEffect } from 'react';
import GameTable from './components/GameTable/GameTable';
import ActionPanel from './components/ActionPanel/ActionPanel';
import Sidebar from './components/Sidebar/Sidebar';
import ControlBar from './components/Controls/ControlBar';
import Lobby from './components/Lobby/Lobby';
import { useGameStore } from './store/gameStore';
import { useLobbyStore } from './store/lobbyStore';
import type { Seat } from './types/game';
import styles from './App.module.css';

export default function App() {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const playerId = useLobbyStore(s => s.playerId);
  const enterGame = useGameStore(s => s.enterGame);
  const exitGame = useGameStore(s => s.exitGame);

  const handleGameStart = useCallback((id: string, seat: string) => {
    setMatchId(id);
    setMySeat(seat as Seat);
  }, []);

  // Once identity is fully resolved (matchId + mySeat from lobby + playerId
  // from lobbyStore), bind the game store. Stops polling on unmount.
  useEffect(() => {
    if (matchId && mySeat && playerId) {
      void enterGame(matchId, mySeat, playerId);
    }
    return () => {
      exitGame();
    };
  }, [matchId, mySeat, playerId, enterGame, exitGame]);

  if (!matchId || !mySeat || !playerId) {
    return <Lobby onGameStart={handleGameStart} />;
  }

  return (
    <div
      className={styles.app}
      data-match-id={matchId}
      data-my-seat={mySeat ?? undefined}
    >
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
