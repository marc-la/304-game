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
  const validPlays = useGameStore(s => s.validPlays);
  const whoseTurn = useGameStore(s => s.whoseTurn);
  const phase = useGameStore(s => s.phase);
  const peekMode = useGameStore(s => s.peekMode);
  const gameState = useGameStore(s => s.gameState);
  const pccOut = gameState?.pcc_partner_out;

  const selectTrump = useGameStore(s => s.selectTrump);
  const playCard = useGameStore(s => s.playCard);

  const cards = hands[seat] || [];
  const valid = validPlays[seat] || [];
  const isActive = whoseTurn === seat;
  const isBottom = position === 'bottom';
  const isPccOut = pccOut === seat;
  const team = SEAT_TEAM[seat];
  const teamClass = team === 'team_a' ? styles.teamA : styles.teamB;

  // Bottom seat always face-up; others only if peek mode
  const faceUp = isBottom || peekMode;
  const small = !isBottom;

  // Interactive during trump selection and playing phases
  const interactive =
    isActive &&
    (phase === 'trump_selection' || phase === 'playing');

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
    <div className={`${styles.seat} ${styles[position]} ${isActive ? styles.active : ''} ${isPccOut ? styles.pccOut : ''}`}>
      <div className={`${styles.label} ${teamClass}`}>
        <span className={styles.name}>{SEAT_NAMES[seat]}</span>
        {isDealer && <span className={styles.badge}>D</span>}
        {isTrumper && <span className={styles.badgeTrump}>T</span>}
        {isPccOut && <span className={styles.badgePcc}>OUT</span>}
        {isActive && <span className={styles.turnArrow}>&#9654;</span>}
      </div>
      <CardHand
        cards={cards}
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
