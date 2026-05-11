// Mode-select screen shown at /play before any match starts.
//
// Three modes:
//   - Vs Bots: spins up a match via the active Transport (backend if
//     reachable, local fallback otherwise) and hands the matchId up
//     to App which mounts the existing game UI.
//   - Create Room / Join Room: dispatches to the existing Lobby
//     subtree (multiplayer flow, requires backend).
//
// A small status pill shows online/offline. Multiplayer is disabled
// when the backend is unreachable (graceful degradation rather than
// silent failure).

import { useEffect, useState } from 'react';
import { api } from '../../api/gameApi';
import { selectTransport } from '../../transport/select';
import styles from './PlayLanding.module.css';

const LOCAL_PLAYER_ID_KEY = '304:localPlayerId';

const ensureLocalPlayerId = (): string => {
  const existing = localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(LOCAL_PLAYER_ID_KEY, fresh);
  return fresh;
};

interface PlayLandingProps {
  /** Called when a bot match has been created. Carries (matchId, mySeat, playerId). */
  onBotMatchStart: (matchId: string, mySeat: 'south', playerId: string) => void;
  /** Called when the user chooses Create/Join Room — App switches to the Lobby. */
  onRoomMode: () => void;
}

export default function PlayLanding({
  onBotMatchStart,
  onRoomMode,
}: PlayLandingProps) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void selectTransport().then(t => setIsOnline(!t.isLocal));
  }, []);

  const handleVsBots = async () => {
    setBusy(true);
    setError(null);
    try {
      const playerId = ensureLocalPlayerId();
      const view = await api.newBotMatch({ playerId, seat: 'south' });
      onBotMatchStart(view.matchId, 'south', playerId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className={styles.landing}>
      <div className={styles.statusBar}>
        {isOnline === null ? (
          <span className={styles.statusProbing}>Checking server…</span>
        ) : isOnline ? (
          <span className={styles.statusOnline}>● Online</span>
        ) : (
          <span className={styles.statusOffline}>● Offline (playing locally)</span>
        )}
      </div>

      <h1 className={styles.title}>Play 304</h1>
      <p className={styles.subtitle}>
        Pick your match. <strong>Vs Bots</strong> works anywhere; rooms need a
        backend.
      </p>

      <div className={styles.cards}>
        <button
          type="button"
          className={styles.modeCard}
          onClick={handleVsBots}
          disabled={busy}
        >
          <div className={styles.modeBadge}>Solo</div>
          <h2>Vs Bots</h2>
          <p>
            A full 10-stone match against three simple bots. You play South.
          </p>
          <span className={styles.modeAction}>
            {busy ? 'Starting…' : 'Start →'}
          </span>
        </button>

        <button
          type="button"
          className={styles.modeCard}
          onClick={onRoomMode}
          disabled={isOnline === false}
          title={
            isOnline === false
              ? 'Multiplayer requires the backend to be running.'
              : undefined
          }
        >
          <div className={styles.modeBadge}>Online</div>
          <h2>Create Room</h2>
          <p>Host a private room and invite 3 friends.</p>
          <span className={styles.modeAction}>
            {isOnline === false ? 'Backend unreachable' : 'Open lobby →'}
          </span>
        </button>

        <button
          type="button"
          className={styles.modeCard}
          onClick={onRoomMode}
          disabled={isOnline === false}
          title={
            isOnline === false
              ? 'Multiplayer requires the backend to be running.'
              : undefined
          }
        >
          <div className={styles.modeBadge}>Online</div>
          <h2>Join Room</h2>
          <p>Enter a room code your host shared with you.</p>
          <span className={styles.modeAction}>
            {isOnline === false ? 'Backend unreachable' : 'Open lobby →'}
          </span>
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
