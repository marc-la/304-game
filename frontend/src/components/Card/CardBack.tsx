import { motion } from 'framer-motion';
import styles from './CardBack.module.css';

interface Props {
  small?: boolean;
  label?: string;
}

export default function CardBack({ small = false, label }: Props) {
  return (
    <motion.div
      className={`${styles.cardBack} ${small ? styles.small : ''}`}
      layout
    >
      <div className={styles.pattern}>
        {label && <span className={styles.label}>{label}</span>}
      </div>
    </motion.div>
  );
}
