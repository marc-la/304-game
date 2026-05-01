import { useState } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import type { LobbyView, Seat } from '../../api/lobbyApi';
import styles from './Lobby.module.css';

const AVATARS = [
  'spade', 'heart', 'diamond', 'club',
  'crown', 'knight', 'tower', 'star',
];

const AVATAR_GLYPH: Record<string, string> = {
  spade: '♠', heart: '♥', diamond: '♦', club: '♣',
  crown: '♚', knight: '♞', tower: '♜', star: '★',
};

interface EditPanelProps {
  lobby: LobbyView;
  mySeat: Seat;
  onClose: () => void;
}

export default function EditPanel({ lobby, mySeat, onClose }: EditPanelProps) {
  const updateProfile = useLobbyStore((s) => s.updateProfile);
  const me = lobby.seats[mySeat]!;
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [busy, setBusy] = useState(false);

  // Compute taken-by-others sets so we can grey them out (informational —
  // server is the source of truth and will reject conflicts).
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
    <div className={styles.editPanel}>
      <h3>Edit profile</h3>
      <label className={styles.field}>
        Name
        <input
          type="text"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
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
              className={`${styles.avatarBtn} ${selected ? styles.selected : ''} ${taken ? styles.taken : ''}`}
              onClick={() => !taken && setAvatar(a)}
              disabled={busy || taken}
              title={a}
            >
              {AVATAR_GLYPH[a]}
            </button>
          );
        })}
      </fieldset>

      <div className={styles.editActions}>
        <button className={styles.btnGhost} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={styles.btnPrimary} onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  );
}
