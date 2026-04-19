import { motion } from 'framer-motion';
import type { CardData } from '../../types/game';
import { suitColor, suitSymbol } from '../../utils/cardUtils';
import styles from './PlayingCard.module.css';

interface Props {
  card: CardData;
  onClick?: () => void;
  clickable?: boolean;
  dimmed?: boolean;
  selected?: boolean;
  small?: boolean;
  showPoints?: boolean;
}

export default function PlayingCard({
  card,
  onClick,
  clickable = false,
  dimmed = false,
  selected = false,
  small = false,
  showPoints = true,
}: Props) {
  const color = suitColor(card.suit);
  const sym = suitSymbol(card.suit);

  return (
    <motion.div
      className={`${styles.card} ${clickable ? styles.clickable : ''} ${dimmed ? styles.dimmed : ''} ${selected ? styles.selected : ''} ${small ? styles.small : ''}`}
      onClick={clickable ? onClick : undefined}
      whileHover={clickable ? { y: -8, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' } : undefined}
      whileTap={clickable ? { scale: 0.97 } : undefined}
      layout
    >
      {/* Top-left corner */}
      <div className={styles.cornerTL} style={{ color }}>
        <span className={styles.rank}>{card.rank}</span>
        <span className={styles.suit}>{sym}</span>
      </div>

      {/* Center suit */}
      <div className={styles.center} style={{ color }}>
        {sym}
      </div>

      {/* Bottom-right corner (rotated 180) */}
      <div className={styles.cornerBR} style={{ color }}>
        <span className={styles.rank}>{card.rank}</span>
        <span className={styles.suit}>{sym}</span>
      </div>

      {/* Point badge */}
      {showPoints && card.points > 0 && (
        <div className={styles.pointBadge}>{card.points}</div>
      )}
    </motion.div>
  );
}
