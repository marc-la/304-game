interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

// Minimal confirmation. Per soul §VI.4 and rules.md §C-1
// adaptive: the player declares "I see the cap" and the engine
// verifies. No order entry, no commit.
export const CapsConfirmModal = ({ onConfirm, onCancel }: Props) => (
  <div className="dle-modal-backdrop" role="dialog" aria-modal="true">
    <div className="dle-modal dle-confirm-modal">
      <h2>Call Caps?</h2>
      <p className="dle-modal-blurb">
        You're declaring that, in every world consistent with what you've seen,
        you have a strategy that wins every remaining round.
      </p>
      <p className="dle-modal-blurb dle-confirm-warning">
        Wrong calls hurt — there's no take-back.
      </p>
      <div className="dle-modal-actions">
        <button type="button" className="dle-btn dle-btn-secondary" onClick={onCancel}>
          Back
        </button>
        <button type="button" className="dle-btn dle-btn-primary" onClick={onConfirm}>
          Call Caps
        </button>
      </div>
    </div>
  </div>
);
