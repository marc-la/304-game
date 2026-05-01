import { useGameStore } from '../../store/gameStore';
import CardHand from '../Card/CardHand';
import type { Seat, CardData } from '../../types/game';
import { SEAT_NAMES, SEAT_TEAM } from '../../types/game';
import styles from './SeatPosition.module.css';

interface Props {
  seat: Seat;
  position: 'top' | 'bottom' | 'left' | 'right';
}

export default function SeatPosition({ seat, position }: Props) {
  const hands = useGameStore(s => s.hands);
  const handCounts = useGameStore(s => s.handCounts);
  const validPlays = useGameStore(s => s.validPlays);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const phase = useGameStore(s => s.phase);
  const peekMode = useGameStore(s => s.peekMode);
  const mySeat = useGameStore(s => s.mySeat);
  const gameState = useGameStore(s => s.gameState);
  const pccOut = gameState?.pcc_partner_out;

  const selectTrump = useGameStore(s => s.selectTrump);
  const playCard = useGameStore(s => s.playCard);

  const cards = hands[seat] || [];
  const valid = validPlays[seat] || [];
  const isActive = whoseTurn === seat;
  const isMe = mySeat === seat;
  const isPccOut = pccOut === seat;
  const team = SEAT_TEAM[seat];
  const teamClass = team === 'team_a' ? styles.teamA : styles.teamB;

  // Card visibility:
  // - Lobby mode (mySeat set): only my own seat is face-up; opponents are
  //   face-down with a count from handCounts. After game completion, all
  //   are face-up for scrutiny.
  // - Solo/dev mode (mySeat null): bottom always face-up; others depend on
  //   peekMode (legacy hot-seat behaviour).
  const gameComplete = phase === 'complete';
  const inLobbyMode = mySeat !== null;
  const faceUp = inLobbyMode
    ? isMe || gameComplete
    : position === 'bottom' || peekMode;

  const small = inLobbyMode ? !isMe : position !== 'bottom';

  // Card count for face-down rendering (when we don't have the cards but
  // we do know how many they hold).
  const count = handCounts[seat] ?? cards.length;

  // Only the local player can act on their own seat. In solo mode, fall
  // back to whoseTurn-driven interactivity.
  const canAct = inLobbyMode ? isMe : true;
  const interactive =
    canAct && isActive && (phase === 'trump_selection' || phase === 'playing');

  const handleCardClick = (card: CardData) => {
    if (phase === 'trump_selection') {
      selectTrump(card.str);
    } else if (phase === 'playing') {
      playCard(card.str);
    }
  };

  const isDealer = gameState?.dealer === seat;
  const isTrumper = gameState?.trump?.trumper_seat === seat;

  return (
    <div
      className={`${styles.seat} ${styles[position]} ${
        isActive ? styles.active : ''
      } ${isPccOut ? styles.pccOut : ''}`}
    >
      <div className={`${styles.label} ${teamClass}`}>
        <span className={styles.name}>
          {SEAT_NAMES[seat]}
          {isMe && ' (you)'}
        </span>
        {isDealer && <span className={styles.badge}>D</span>}
        {isTrumper && <span className={styles.badgeTrump}>T</span>}
        {isPccOut && <span className={styles.badgePcc}>OUT</span>}
        {isActive && <span className={styles.turnArrow}>&#9654;</span>}
      </div>
      <CardHand
        cards={cards}
        count={count}
        validPlays={valid}
        faceUp={faceUp}
        small={small}
        interactive={interactive}
        onCardClick={handleCardClick}
        showPoints={faceUp}
      />
    </div>
  );
}
