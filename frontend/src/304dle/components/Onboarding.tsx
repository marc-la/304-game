import { useState } from 'react';

const STEPS = [
  {
    title: 'You are South — the trumper.',
    body: 'Trump is set. Your hand is below. Three opponents will play; partner sits across.',
  },
  {
    title: 'Win every round you can.',
    body: "Each round, players play one card. You must follow suit if you can. Highest trump or led-suit wins.",
  },
  {
    title: 'Call Caps when certain.',
    body: 'When you can guarantee winning every remaining round, tap Call Caps and lay your order. Wrong calls hurt your score.',
  },
];

interface Props {
  onClose: () => void;
}

export const Onboarding = ({ onClose }: Props) => {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  return (
    <div className="dle-modal-backdrop">
      <div className="dle-modal dle-onboarding">
        <h2>{STEPS[step].title}</h2>
        <p>{STEPS[step].body}</p>
        <div className="dle-onboarding-dots">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`dle-dot${i === step ? ' dle-dot-active' : ''}`}
            />
          ))}
        </div>
        <div className="dle-modal-actions">
          <button type="button" className="dle-btn dle-btn-secondary" onClick={onClose}>
            Skip
          </button>
          <button
            type="button"
            className="dle-btn dle-btn-primary"
            onClick={() => last ? onClose() : setStep(step + 1)}
          >
            {last ? "Let's play" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};
