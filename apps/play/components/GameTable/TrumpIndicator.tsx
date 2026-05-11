import { useGameStore } from '../../store/gameStore';
import CardBack from '../Card/CardBack';
import PlayingCard from '../Card/PlayingCard';
import { SUIT_SYMBOLS } from '../../types/game';
import styles from './TrumpIndicator.module.css';

export default function TrumpIndicator() {
  const gameState = useGameStore(s => s.gameState);
  const trump = gameState?.trump;

  if (!trump || (!trump.trump_card && !trump.trump_suit)) return null;

  return (
    <div className={styles.container}>
      {trump.is_revealed || trump.is_open ? (
        <>
          {trump.trump_card && !trump.trump_card_in_hand ? (
            <PlayingCard card={trump.trump_card} small showPoints={false} />
          ) : (
            <div className={styles.suitBadge}>
              {trump.trump_suit ? SUIT_SYMBOLS[trump.trump_suit] : '?'}
            </div>
          )}
          <div className={styles.label}>
            Trump: {trump.trump_suit ? SUIT_SYMBOLS[trump.trump_suit] : '?'}
            {trump.is_open ? ' (Open)' : ''}
          </div>
        </>
      ) : (
        <>
          <CardBack small />
          <div className={styles.label}>Trump ?</div>
        </>
      )}
    </div>
  );
}
