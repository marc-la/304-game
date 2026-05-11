import { useState, useCallback, useEffect } from 'react';
import GameTable from './components/GameTable/GameTable';
import ActionPanel from './components/ActionPanel/ActionPanel';
import Sidebar from './components/Sidebar/Sidebar';
import ControlBar from './components/Controls/ControlBar';
import Lobby from './components/Lobby/Lobby';
import PlayLanding from './components/PlayLanding/PlayLanding';
import { useGameStore } from './store/gameStore';
import { useLobbyStore } from './store/lobbyStore';
import { selectTransport } from './transport/select';
import type { Seat } from './types/game';
import styles from './App.module.css';

type Mode = 'landing' | 'rooms';

export default function App() {
  const [mode, setMode] = useState<Mode>('landing');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  // For Vs Bots flow we generate the playerId locally; lobbyStore.playerId
  // is used for the room flow. App tracks the active playerId either way.
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const enterGame = useGameStore(s => s.enterGame);
  const exitGame = useGameStore(s => s.exitGame);
  // When the game store clears its matchId (via ControlBar's "Menu" button
  // or any other exit path), drop App's local state so PlayLanding renders.
  const storeMatchId = useGameStore(s => s.matchId);
  useEffect(() => {
    if (storeMatchId === null && matchId !== null) {
      setMatchId(null);
      setMySeat(null);
      setActivePlayerId(null);
      setMode('landing');
    }
  }, [storeMatchId, matchId]);

  // On first mount, choose the transport so api routes correctly.
  useEffect(() => {
    void selectTransport();
  }, []);

  const handleBotMatchStart = useCallback(
    (id: string, seat: 'south', playerId: string) => {
      setMatchId(id);
      setMySeat(seat);
      setActivePlayerId(playerId);
    },
    [],
  );

  const handleRoomGameStart = useCallback((id: string, seat: string) => {
    setMatchId(id);
    setMySeat(seat as Seat);
    // For room flow, the lobbyStore's playerId is the source of truth.
    setActivePlayerId(useLobbyStore.getState().playerId);
  }, []);

  // Once we have a fully-resolved identity, bind the game store and
  // start polling. Cleanup on unmount.
  useEffect(() => {
    if (matchId && mySeat && activePlayerId) {
      void enterGame(matchId, mySeat, activePlayerId);
    }
    return () => {
      exitGame();
    };
  }, [matchId, mySeat, activePlayerId, enterGame, exitGame]);

  // Identity not yet resolved → show the mode-select or lobby.
  if (!matchId || !mySeat || !activePlayerId) {
    if (mode === 'rooms') {
      return (
        <Lobby
          onGameStart={(id, seat) => {
            handleRoomGameStart(id, seat);
          }}
        />
      );
    }
    // Default: mode-select landing.
    return (
      <PlayLanding
        onBotMatchStart={handleBotMatchStart}
        onRoomMode={() => setMode('rooms')}
      />
    );
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

