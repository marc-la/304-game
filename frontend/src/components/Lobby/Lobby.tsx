import { useEffect, useRef } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import LobbyEntry from './LobbyEntry';
import LobbyRoom from './LobbyRoom';
import styles from './Lobby.module.css';

interface LobbyProps {
  onGameStart: (matchId: string, mySeat: string) => void;
}

/**
 * Top-level lobby switch.
 *
 * Hydrates from sessionStorage / URL ?code= on mount, then renders the
 * entry or in-room view based on the store's discriminated phase.
 *
 * Side-effects in this component (deliberately kept here, not in the
 * store):
 * - Auto-join when ?code=ABCD is present in the URL on first load.
 * - Notify the parent when the phase transitions to in-game so it can
 *   swap the whole route to the GameTable view.
 */
export default function Lobby({ onGameStart }: LobbyProps) {
  const phase = useLobbyStore((s) => s.phase);
  const error = useLobbyStore((s) => s.error);
  const clearError = useLobbyStore((s) => s.clearError);
  const hydrate = useLobbyStore((s) => s.hydrate);
  const join = useLobbyStore((s) => s.join);
  const hydrateOnce = useRef(false);

  useEffect(() => {
    if (hydrateOnce.current) return;
    hydrateOnce.current = true;

    void (async () => {
      await hydrate();
      // After hydrate, only auto-join from URL if we're still idle
      // (i.e., no in-room state was restored from sessionStorage).
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get('code');
      if (codeParam && useLobbyStore.getState().phase.kind === 'idle') {
        await join(codeParam);
      }
    })();
  }, [hydrate, join]);

  useEffect(() => {
    if (phase.kind === 'in-game') {
      onGameStart(phase.matchId, phase.mySeat);
    }
  }, [phase, onGameStart]);

  // Auto-dismiss errors after 4s; click also clears.
  useEffect(() => {
    if (!error) return;
    const handle = window.setTimeout(clearError, 4000);
    return () => window.clearTimeout(handle);
  }, [error, clearError]);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Play 304</h1>
      <p className={styles.subtitle}>Host a game or join with a code</p>

      {error && (
        <div
          className={styles.toast}
          onClick={clearError}
          role="alert"
          aria-live="assertive"
        >
          {error}
          <span className={styles.toastClose} aria-hidden="true">×</span>
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
