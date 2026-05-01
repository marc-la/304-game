import { useEffect } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import LobbyEntry from './LobbyEntry';
import LobbyRoom from './LobbyRoom';
import styles from './Lobby.module.css';

interface LobbyProps {
  onGameStart: (matchId: string, mySeat: string) => void;
}

export default function Lobby({ onGameStart }: LobbyProps) {
  const phase = useLobbyStore((s) => s.phase);
  const error = useLobbyStore((s) => s.error);
  const clearError = useLobbyStore((s) => s.clearError);
  const hydrate = useLobbyStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (phase.kind === 'in-game') {
      onGameStart(phase.matchId, phase.mySeat);
    }
  }, [phase, onGameStart]);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Play 304</h1>
      <p className={styles.subtitle}>Host a game or join with a code</p>

      {error && (
        <div className={styles.toast} onClick={clearError} role="alert">
          {error}
          <span className={styles.toastClose}>×</span>
        </div>
      )}

      {phase.kind === 'idle' || phase.kind === 'entering' ? (
        <LobbyEntry busy={phase.kind === 'entering'} />
      ) : phase.kind === 'in-room' ? (
        <LobbyRoom lobby={phase.lobby} mySeat={phase.mySeat} />
      ) : null}
    </div>
  );
}
