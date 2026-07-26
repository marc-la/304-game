// First-run only. Soul §VI.5.2 forbids tutorials and §VI.5.4 forbids
// retelling the rules — the player already knows 304, and the rules
// live on site/rules.html. So this says exactly one thing: the thing
// about *this app* that cannot be inferred from knowing 304, which is
// that you don't choose your cards here. Everything else (what caps
// is, when to call it, how to read the table) is the puzzle, and
// explaining it would be explaining the answer.

interface Props {
  onClose: () => void;
}

export const Onboarding = ({ onClose }: Props) => (
  <div className="dle-modal-backdrop">
    <div className="dle-modal dle-onboarding">
      <h2>Your cards play themselves.</h2>
      <p>
        You are South. The line is already chosen — tap the lit card to lay it.
        The only decision that is yours is when to call Caps.
      </p>
      <div className="dle-modal-actions">
        <button type="button" className="dle-btn dle-btn-primary" onClick={onClose}>
          Deal
        </button>
      </div>
    </div>
  </div>
);
