import { useState } from 'react';

const STEPS = [
  {
    title: 'You are South — the trumper.',
    body: 'The bid was made. Trump is set. Your partner sits across; the opposition flanks you. Now you play.',
  },
  {
    title: 'Every card teaches you something.',
    body: "Watch what's led. Watch what's followed. Track who's void in what. The Worlds counter is your second pair of eyes — it ticks down as the hand reveals itself.",
  },
  {
    title: 'When the worlds collapse — call Caps.',
    body: 'When you know — really know — that you can win every remaining round, tap Call Caps and lay your order. Hesitate too long and the moment passes. Call too early and the moment never came.',
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
