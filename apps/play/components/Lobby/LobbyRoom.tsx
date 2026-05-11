import { useState } from 'react';
import { useLobbyStore } from '../../store/lobbyStore';
import type { LobbyView, Seat, Team } from '../../api/lobbyApi';
import EditPanel from './EditPanel';
import styles from './Lobby.module.css';

const SEATS: Seat[] = ['north', 'east', 'south', 'west'];

// "Colombo card table" theme. Keys must match ALL_AVATARS in
// backend/lobby.py.
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

interface LobbyRoomProps {
  lobby: LobbyView;
  mySeat: Seat;
}

export default function LobbyRoom({ lobby, mySeat }: LobbyRoomProps) {
  const playerId = useLobbyStore((s) => s.playerId);
  const leave = useLobbyStore((s) => s.leave);
  const start = useLobbyStore((s) => s.start);
  const switchTeam = useLobbyStore((s) => s.switchTeam);
  const kick = useLobbyStore((s) => s.kick);
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isHost = lobby.hostId === playerId;
  const teamA = SEATS.filter((s) => lobby.seats[s]?.team === 'teamA').map((s) => ({ seat: s, ...lobby.seats[s]! }));
  const teamB = SEATS.filter((s) => lobby.seats[s]?.team === 'teamB').map((s) => ({ seat: s, ...lobby.seats[s]! }));
  const totalPlayers = teamA.length + teamB.length;
  const teamsBalanced = teamA.length === 2 && teamB.length === 2;
  const canStart = isHost && totalPlayers === 4 && teamsBalanced;

  function copyCode() {
    // Copy the join URL so recipients can click straight in.
    const url = new URL(window.location.href);
    url.searchParams.set('code', lobby.code);
    void navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function renderTeam(label: string, team: Team, players: typeof teamA) {
    return (
      <div className={styles.teamColumn}>
        <h3 className={styles.teamHeading}>{label}</h3>
        <div className={styles.teamSlots}>
          {players.map((p) => (
            <PlayerSlot
              key={p.playerId}
              player={p}
              isHost={isHost}
              isMe={p.playerId === playerId}
              hostId={lobby.hostId}
              onSwitch={() =>
                switchTeam(p.seat, team === 'teamA' ? 'teamB' : 'teamA')
              }
              onKick={() => kick(p.seat)}
              onEdit={() => setEditOpen(true)}
            />
          ))}
          {Array.from({ length: Math.max(0, 2 - players.length) }).map(
            (_, i) => (
              <div
                key={`empty-${i}`}
                className={`${styles.playerSlot} ${styles.empty}`}
              >
                <span className={styles.placeholder}>Waiting…</span>
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.room}>
      <div className={styles.roomHeader}>
        <span className={styles.modeLabel}>{isHost ? 'Hosting' : `Joined ${lobby.code}`}</span>
        <button className={styles.btnGhost} onClick={() => void leave()}>
          Leave
        </button>
      </div>

      <div className={styles.codeDisplay}>
        <span className={styles.codeLabel}>Game Code</span>
        <span className={styles.code}>{lobby.code}</span>
        <button
          type="button"
          className={styles.btnCopy}
          onClick={copyCode}
          aria-label={copied ? 'Link copied' : 'Copy join link'}
          title={copied ? 'Link copied!' : 'Copy join link'}
        >
          {copied ? '✓' : '📋'}
        </button>
      </div>

      <div className={styles.teams}>
        {renderTeam('Team A', 'teamA', teamA)}
        <div className={styles.vs}>vs</div>
        {renderTeam('Team B', 'teamB', teamB)}
      </div>

      {editOpen && (
        <EditPanel
          lobby={lobby}
          mySeat={mySeat}
          onClose={() => setEditOpen(false)}
        />
      )}

      {isHost ? (
        <div className={styles.hostControls}>
          <button
            className={styles.btnPrimary}
            onClick={() => void start()}
            disabled={!canStart}
          >
            Start Game
          </button>
          <p className={styles.hint}>
            {teamsBalanced
              ? 'Ready to start!'
              : totalPlayers < 4
              ? `Waiting for players — ${totalPlayers}/4 joined`
              : `Teams unbalanced (${teamA.length} vs ${teamB.length}) — need 2 per team`}
          </p>
        </div>
      ) : (
        <p className={styles.hint}>Waiting for host to start the game…</p>
      )}
    </div>
  );
}

interface PlayerSlotProps {
  player: { seat: Seat; playerId: string; name: string; avatar: string; team: Team; connected: boolean };
  isHost: boolean;
  isMe: boolean;
  hostId: string;
  onSwitch: () => void;
  onKick: () => void;
  onEdit: () => void;
}

function PlayerSlot({ player, isHost, isMe, hostId, onSwitch, onKick, onEdit }: PlayerSlotProps) {
  const isPlayerHost = player.playerId === hostId;
  const connStatus = player.connected ? 'Connected' : 'Disconnected';
  return (
    <div className={styles.playerSlot}>
      <span
        className={`${styles.connDot} ${
          player.connected ? styles.connected : styles.disconnected
        }`}
        role="status"
        aria-label={connStatus}
        title={connStatus}
      />
      <span className={styles.avatar} aria-hidden="true">{AVATAR_GLYPH[player.avatar] ?? '♠'}</span>
      <span className={styles.name}>{player.name}</span>
      {isPlayerHost && <span className={styles.badge}>Host</span>}
      {isMe && <span className={styles.badge}>You</span>}
      <span className={styles.actions}>
        {isMe && (
          <button
            type="button"
            aria-label="Edit profile"
            title="Edit profile"
            onClick={onEdit}
          >
            ✎
          </button>
        )}
        {(isMe || isHost) && (
          <button
            type="button"
            aria-label={isMe ? 'Switch your team' : `Switch ${player.name}'s team`}
            title="Switch team"
            onClick={onSwitch}
          >
            ⇄
          </button>
        )}
        {isHost && !isMe && (
          <button
            type="button"
            aria-label={`Remove ${player.name}`}
            title="Remove player"
            onClick={onKick}
          >
            ✕
          </button>
        )}
      </span>
    </div>
  );
}
