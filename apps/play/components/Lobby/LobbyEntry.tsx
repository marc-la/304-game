import { useEffect, useState, type KeyboardEvent } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import styles from './Lobby.module.css';

interface LobbyEntryProps {
  busy: boolean;
}

/**
 * Host / Join entry screen.
 *
 * The code input pre-fills from ``?code=`` if present (matches the
 * auto-join path in Lobby.tsx). Paste-friendly: any characters that
 * aren't A-Z get stripped so users can paste arbitrary text and have
 * it cleaned up.
 */
export default function LobbyEntry({ busy }: LobbyEntryProps) {
  const host = useLobbyStore((s) => s.host);
  const join = useLobbyStore((s) => s.join);

  const [code, setCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('code') ?? '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4);
  });

  // Keep the URL in sync so the link is shareable while editing.
  useEffect(() => {
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    window.history.replaceState({}, '', url.toString());
  }, [code]);

  function handleCodeChange(value: string) {
    setCode(value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  }

  function handleJoin() {
    if (code.length === 4) void join(code);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleJoin();
  }

  return (
    <div className={styles.entry}>
      <button
        type="button"
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
          inputMode="text"
          aria-label="Game code (4 letters)"
          onChange={(e) => handleCodeChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          autoFocus
        />
        <button
          type="button"
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
