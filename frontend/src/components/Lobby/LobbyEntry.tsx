import { useState, type KeyboardEvent } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import styles from './Lobby.module.css';

interface LobbyEntryProps {
  busy: boolean;
}

export default function LobbyEntry({ busy }: LobbyEntryProps) {
  const host = useLobbyStore((s) => s.host);
  const join = useLobbyStore((s) => s.join);
  const [code, setCode] = useState('');

  function handleCodeChange(value: string) {
    setCode(value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  }

  function handleJoin() {
    if (code.length === 4) {
      void join(code);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleJoin();
  }

  return (
    <div className={styles.entry}>
      <button
        className={styles.btnHost}
        onClick={() => void host()}
        disabled={busy}
      >
        {busy ? 'Connecting…' : 'Host Game'}
      </button>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <div className={styles.joinForm}>
        <input
          type="text"
          className={styles.codeInput}
          value={code}
          maxLength={4}
          placeholder="ABCD"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => handleCodeChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
        />
        <button
          className={styles.btnJoin}
          onClick={handleJoin}
          disabled={busy || code.length !== 4}
        >
          Join
        </button>
      </div>
    </div>
  );
}
