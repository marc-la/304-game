import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { SEAT_NAMES } from '../../types/game';
import styles from './ControlBar.module.css';

export default function ControlBar() {
  const newMatch = useGameStore(s => s.newMatch);
  const seed = useGameStore(s => s.seed);
  const setSeed = useGameStore(s => s.setSeed);
  const peekMode = useGameStore(s => s.peekMode);
  const togglePeekMode = useGameStore(s => s.togglePeekMode);
  const error = useGameStore(s => s.error);
  const clearError = useGameStore(s => s.clearError);
  const matchId = useGameStore(s => s.matchId);
  const mySeat = useGameStore(s => s.mySeat);
  const gameCount = useGameStore(s => s.gameCount);

  const [seedInput, setSeedInput] = useState(seed?.toString() ?? '');

  // In lobby mode (mySeat is set), hide solo/dev affordances. The "New
  // Match" button, seed control and peek toggle only make sense in the
  // single-window dev path. Lobby-spawned matches are driven from the
  // lobby flow.
  const inLobbyMode = mySeat !== null;

  const handleNewMatch = () => {
    const s = seedInput ? parseInt(seedInput, 10) : undefined;
    if (seedInput && !isNaN(s!)) {
      setSeed(s!);
    }
    newMatch(s);
  };

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.title}>304 Card Game</span>
        {matchId && <span className={styles.gameNum}>Game #{gameCount}</span>}
        {mySeat && (
          <span className={styles.gameNum}>You: {SEAT_NAMES[mySeat]}</span>
        )}
      </div>

      {!inLobbyMode && (
        <div className={styles.controls}>
          <div className={styles.group}>
            <label className={styles.label}>Seed:</label>
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              placeholder="Random"
              className={styles.seedInput}
            />
          </div>

          <button className="primary" onClick={handleNewMatch}>
            New Match
          </button>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={peekMode}
              onChange={togglePeekMode}
            />
            <span>Peek</span>
          </label>
        </div>
      )}

      {error && (
        <div className={styles.error} onClick={clearError}>
          {error} <span className={styles.dismiss}>x</span>
        </div>
      )}
    </div>
  );
}
