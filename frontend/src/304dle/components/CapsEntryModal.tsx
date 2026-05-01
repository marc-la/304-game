import type { CardId } from '../engine/card';
import { CardView } from './CardView';

interface Props {
  hand: ReadonlyArray<CardId>;
  chosen: ReadonlyArray<CardId>;
  onToggle: (card: CardId) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const CapsEntryModal = ({ hand, chosen, onToggle, onSubmit, onCancel }: Props) => {
  const remaining = hand.filter(c => !chosen.includes(c));
  const ready = chosen.length === hand.length;
  return (
    <div className="dle-modal-backdrop" role="dialog" aria-modal="true">
      <div className="dle-modal">
        <h2>Call Caps</h2>
        <p className="dle-modal-blurb">
          Lay your remaining cards face up in the order you'll play them.
          Once you confirm, the engine checks every world consistent with what you know.
        </p>

        <div className="dle-order-slots">
          {chosen.map((c, i) => (
            <div key={`slot-${i}`} className="dle-order-slot dle-order-slot-filled">
              <span className="dle-order-slot-num">R{i + 1}</span>
              <CardView card={c} small selectable onClick={() => onToggle(c)} />
            </div>
          ))}
          {Array.from({ length: hand.length - chosen.length }).map((_, i) => (
            <div key={`empty-${i}`} className="dle-order-slot dle-order-slot-empty">
              <span className="dle-order-slot-num">R{chosen.length + i + 1}</span>
            </div>
          ))}
        </div>

        <p className="dle-modal-prompt">Tap cards to add to your order:</p>
        <div className="dle-order-pool">
          {remaining.map(c => (
            <CardView
              key={c}
              card={c}
              selectable
              onClick={() => onToggle(c)}
            />
          ))}
        </div>

        <div className="dle-modal-actions">
          <button type="button" className="dle-btn dle-btn-secondary" onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className="dle-btn dle-btn-primary"
            disabled={!ready}
            onClick={onSubmit}
          >
            Confirm Caps
          </button>
        </div>
      </div>
    </div>
  );
};
