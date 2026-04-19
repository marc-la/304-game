import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Seat } from '../../types/game';
import { SEAT_NAMES } from '../../types/game';
import styles from './ControlBar.module.css';

export default function ControlBar() {
  const newMatch = useGameStore(s => s.newMatch);
  const seed = useGameStore(s => s.seed);
  const setSeed = useGameStore(s => s.setSeed);
  const activeSeat = useGameStore(s => s.activeSeat);
  const setActiveSeat = useGameStore(s => s.setActiveSeat);
  const peekMode = useGameStore(s => s.peekMode);
  const togglePeekMode = useGameStore(s => s.togglePeekMode);
  const error = useGameStore(s => s.error);
  const clearError = useGameStore(s => s.clearError);
  const matchId = useGameStore(s => s.matchId);
  const gameCount = useGameStore(s => s.gameCount);

  const [seedInput, setSeedInput] = useState(seed?.toString() ?? '');

  const handleNewMatch = () => {
    const s = seedInput ? parseInt(seedInput, 10) : undefined;
    if (seedInput && !isNaN(s!)) {
      setSeed(s!);
    }
    newMatch(s);
  };

  const seats: Seat[] = ['south', 'north', 'west', 'east'];

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.title}>304 Card Game</span>
        {matchId && <span className={styles.gameNum}>Game #{gameCount}</span>}
      </div>

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

        <button className="primary" onClick={handleNewMatch}>New Match</button>

        <div className={styles.group}>
          <label className={styles.label}>View as:</label>
          <select
            value={activeSeat}
            onChange={e => setActiveSeat(e.target.value as Seat)}
          >
            {seats.map(s => (
              <option key={s} value={s}>{SEAT_NAMES[s]}</option>
            ))}
          </select>
        </div>

        <label className={styles.toggle}>
          <input type="checkbox" checked={peekMode} onChange={togglePeekMode} />
          <span>Peek</span>
        </label>
      </div>

      {error && (
        <div className={styles.error} onClick={clearError}>
          {error} <span className={styles.dismiss}>x</span>
        </div>
      )}
    </div>
  );
}
