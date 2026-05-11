import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import styles from './GameLog.module.css';

export default function GameLog() {
  const log = useGameStore(s => s.log);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  if (log.length === 0) {
    return <div className={styles.empty}>No events yet</div>;
  }

  return (
    <div className={styles.log}>
      {log.map(entry => (
        <div
          key={entry.id}
          className={`${styles.entry} ${styles[entry.type]} ${entry.team ? styles[entry.team] : ''}`}
        >
          {entry.message}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
