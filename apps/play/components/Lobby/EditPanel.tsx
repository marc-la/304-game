import { useEffect, useRef, useState } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import type { LobbyView, Seat } from '../../api/lobbyApi';
import styles from './Lobby.module.css';

// "Colombo card table" theme. Keys must match ALL_AVATARS in
// backend/lobby.py and AVATAR_GLYPH in LobbyRoom.tsx.
const AVATARS = [
  'peacock', 'elephant', 'leopard', 'tortoise',
  'lotus', 'tea', 'coconut', 'chili',
];

const AVATAR_GLYPH: Record<string, string> = {
  peacock: '🦚',
  elephant: '🐘',
  leopard: '🐆',
  tortoise: '🐢',
  lotus: '🪷',
  tea: '🍵',
  coconut: '🥥',
  chili: '🌶',
};

interface EditPanelProps {
  lobby: LobbyView;
  mySeat: Seat;
  onClose: () => void;
}

/**
 * Profile editor.
 *
 * Uses the native ``<dialog>`` element so we get for free:
 * - Esc to close (the browser fires "cancel" on the dialog)
 * - focus trap inside the dialog while open
 * - backdrop styling via ::backdrop
 * - aria-modal / role="dialog" semantics
 *
 * Browser support: Chrome 37+, Firefox 98+, Safari 15.4+ — all the
 * targets the rest of the app already requires.
 */
export default function EditPanel({ lobby, mySeat, onClose }: EditPanelProps) {
  const updateProfile = useLobbyStore((s) => s.updateProfile);
  const me = lobby.seats[mySeat]!;
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  const takenAvatars = new Set<string>();
  for (const seat of ['north', 'east', 'south', 'west'] as Seat[]) {
    const p = lobby.seats[seat];
    if (p && p.playerId !== me.playerId) takenAvatars.add(p.avatar);
  }

  async function save() {
    setBusy(true);
    await updateProfile({ name: name.trim(), avatar });
    setBusy(false);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.editPanel}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="edit-panel-title"
    >
      <h3 id="edit-panel-title">Edit profile</h3>

      <label className={styles.field}>
        Name
        <input
          type="text"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </label>

      <fieldset className={styles.avatarGrid}>
        <legend>Avatar</legend>
        {AVATARS.map((a) => {
          const taken = takenAvatars.has(a);
          const selected = a === avatar;
          return (
            <button
              key={a}
              type="button"
              className={`${styles.avatarBtn} ${selected ? styles.selected : ''} ${taken ? styles.taken : ''}`}
              onClick={() => !taken && setAvatar(a)}
              disabled={busy || taken}
              aria-pressed={selected}
              aria-label={`${a}${taken ? ' (taken)' : ''}`}
              title={a}
            >
              {AVATAR_GLYPH[a]}
            </button>
          );
        })}
      </fieldset>

      <div className={styles.editActions}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={save}
          disabled={busy || !name.trim()}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
