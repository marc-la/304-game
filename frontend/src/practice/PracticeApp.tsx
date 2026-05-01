import { useMemo, useState } from 'react';
import type { Scenario, ScenarioRoundCard, Verdict } from './types';
import { cardFromStr } from './types';
import { SCENARIOS } from './scenarios';
import type { Seat, Suit } from '../types/game';
import { SEAT_NAMES, SUIT_NAMES, SUIT_SYMBOLS } from '../types/game';
import { sortHand } from '../utils/cardUtils';

/**
 * Solo caps trainer. CSR — no API, no engine call. Each scenario carries
 * its own ground truth and the UI compares the user's decision against it.
 */
export default function PracticeApp() {
  const [scenarioIdx, setScenarioIdx] = useState(0);

  // Per-scenario UI state. Reset whenever the scenario changes.
  const [mode, setMode] = useState<'idle' | 'choosing-order'>('idle');
  const [order, setOrder] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const scenario = SCENARIOS[scenarioIdx];

  const resetScenarioState = () => {
    setMode('idle');
    setOrder([]);
    setVerdict(null);
  };

  const goToScenario = (idx: number) => {
    if (idx < 0 || idx >= SCENARIOS.length) return;
    setScenarioIdx(idx);
    resetScenarioState();
  };

  const handleCallCaps = () => {
    if (scenario.yourHand.length === 1) {
      // Single-card hand — order is trivial; submit directly.
      submitCall(scenario.yourHand);
      return;
    }
    setMode('choosing-order');
    setOrder([]);
  };

  const handleWait = () => {
    if (scenario.shouldCall) {
      setVerdict({ kind: 'should_have_called' });
    } else {
      setVerdict({ kind: 'correctly_waited' });
    }
  };

  const submitCall = (chosen: string[]) => {
    if (!scenario.shouldCall) {
      setVerdict({ kind: 'too_early' });
      return;
    }
    const expected = scenario.correctOrder ?? [];
    const sameOrder =
      chosen.length === expected.length &&
      chosen.every((c, i) => c === expected[i]);
    if (sameOrder) {
      setVerdict({ kind: 'correct' });
    } else {
      setVerdict({
        kind: 'right_call_wrong_order',
        expected,
        given: chosen,
      });
    }
  };

  const toggleCard = (cardStr: string) => {
    setOrder(prev =>
      prev.includes(cardStr)
        ? prev.filter(c => c !== cardStr)
        : [...prev, cardStr],
    );
  };

  const handCards = useMemo(
    () => sortHand(scenario.yourHand.map(cardFromStr)),
    [scenario.yourHand],
  );

  const trumpModeLabel: Record<Scenario['trumpMode'], string> = {
    open: 'Open Trump',
    'closed-pre-reveal': 'Closed Trump (not yet revealed)',
    'closed-post-reveal': 'Closed Trump (revealed)',
  };

  return (
    <div className="practice-page">
      <div className="practice-header">
        <div>
          <h1 className="practice-title">Caps Practice</h1>
          <p className="practice-subtitle">
            Calling Caps at the right moment is the hardest skill in 304.
            One scenario at a time — call, wait, or commit to a play order.
          </p>
        </div>
        <div className="scenario-meta">
          Scenario {scenarioIdx + 1} of {SCENARIOS.length}
        </div>
      </div>

      <div className="scenario-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <span
            className={`difficulty-badge diff-${scenario.difficulty}`}
          >
            {scenario.difficulty}
          </span>
          <h2 className="scenario-name">{scenario.title}</h2>
        </div>

        <div className="setup-text">
          {scenario.setup
            .split('\n\n')
            .map((para, i) => <p key={i}>{para}</p>)}
        </div>

        <div className="state-grid">
          <div className="state-item">
            <span className="state-label">Trump suit</span>
            <span className="state-value">
              <SuitText suit={scenario.trumpSuit} />
            </span>
          </div>
          <div className="state-item">
            <span className="state-label">Trump mode</span>
            <span className="state-value">{trumpModeLabel[scenario.trumpMode]}</span>
          </div>
          <div className="state-item">
            <span className="state-label">Trumper</span>
            <span className="state-value">
              {SEAT_NAMES[scenario.trumperSeat]}
              {scenario.trumperSeat === scenario.yourSeat && (
                <span className="you-marker"> (you)</span>
              )}
            </span>
          </div>
          <div className="state-item">
            <span className="state-label">Your seat</span>
            <span className="state-value">
              <strong>{SEAT_NAMES[scenario.yourSeat]}</strong>
              {' · partner '}
              {SEAT_NAMES[scenario.partnerSeat]}
            </span>
          </div>
          <div className="state-item">
            <span className="state-label">Round</span>
            <span className="state-value">{scenario.currentRound} of 8</span>
          </div>
          <div className="state-item">
            <span className="state-label">Priority</span>
            <span className="state-value">
              {scenario.yourPriority
                ? 'Yours — you lead'
                : `${SEAT_NAMES[scenario.currentRoundLeader ?? scenario.partnerSeat]} leads`}
            </span>
          </div>
        </div>

        {scenario.latestRound && (
          <div className="last-round">
            <h3 className="section-heading">
              Last completed round (Round {scenario.latestRound.roundNumber})
            </h3>
            <RoundCardRow
              cards={scenario.latestRound.cards}
              winner={scenario.latestRound.winner}
            />
          </div>
        )}

        {scenario.currentRoundCards && scenario.currentRoundCards.length > 0 && (
          <div className="last-round">
            <h3 className="section-heading">
              Current round in progress (Round {scenario.currentRound})
            </h3>
            <RoundCardRow cards={scenario.currentRoundCards} />
          </div>
        )}

        {scenario.knownVoids && Object.keys(scenario.knownVoids).length > 0 && (
          <div className="voids">
            <h3 className="section-heading">Public deductions</h3>
            <ul>
              {Object.entries(scenario.knownVoids).map(([seat, suits]) => (
                <li key={seat}>
                  <strong>{SEAT_NAMES[seat as Seat]}</strong> is publicly out of:{' '}
                  {(suits as Suit[]).map((s, i) => (
                    <span key={s}>
                      {i > 0 ? ', ' : ''}
                      <SuitText suit={s} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="your-hand">
          <h3 className="section-heading">Your hand</h3>
          <div className="hand-cards">
            {handCards.map(card => {
              const idx = order.indexOf(card.str);
              const isSelected = idx >= 0;
              const clickable = mode === 'choosing-order' && verdict === null;
              return (
                <div
                  key={card.str}
                  className={`big-card ${clickable ? 'clickable' : ''} ${isSelected ? 'selected' : ''} ${suitColorClass(card.suit)}`}
                  onClick={() =>
                    clickable && toggleCard(card.str)
                  }
                >
                  <span className="rank">{card.rank}</span>
                  <span className="suit">{SUIT_SYMBOLS[card.suit]}</span>
                  {isSelected && (
                    <span className="selection-index">{idx + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Action area */}
        {verdict === null && mode === 'idle' && (
          <div className="actions">
            <button className="btn btn-primary" onClick={handleCallCaps}>
              Call Caps
            </button>
            <button className="btn btn-secondary" onClick={handleWait}>
              Wait — don't call now
            </button>
          </div>
        )}

        {verdict === null && mode === 'choosing-order' && (
          <div>
            <p className="caps-instruction">
              Click your cards in the order you intend to play them
              ({order.length}/{handCards.length} chosen).
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={() => submitCall(order)}
                disabled={order.length !== handCards.length}
              >
                Confirm Caps call
              </button>
              <button
                className="btn"
                onClick={() => {
                  setMode('idle');
                  setOrder([]);
                }}
              >
                Cancel
              </button>
              {order.length > 0 && (
                <button className="btn" onClick={() => setOrder([])}>
                  Reset order
                </button>
              )}
            </div>
          </div>
        )}

        {verdict !== null && (
          <VerdictPanel
            verdict={verdict}
            scenario={scenario}
            onNext={() => goToScenario(scenarioIdx + 1)}
            onRetry={resetScenarioState}
            hasNext={scenarioIdx < SCENARIOS.length - 1}
          />
        )}
      </div>

      <div className="scenario-nav">
        <button
          className="scenario-nav-btn"
          disabled={scenarioIdx === 0}
          onClick={() => goToScenario(scenarioIdx - 1)}
        >
          ← Previous scenario
        </button>
        <button
          className="scenario-nav-btn"
          disabled={scenarioIdx >= SCENARIOS.length - 1}
          onClick={() => goToScenario(scenarioIdx + 1)}
        >
          Next scenario →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SuitText({ suit }: { suit: Suit }) {
  return (
    <span className={suitColorClass(suit)}>
      {SUIT_SYMBOLS[suit]} {SUIT_NAMES[suit]}
    </span>
  );
}

function suitColorClass(suit: Suit): string {
  return suit === 'h' || suit === 'd' ? 'suit-red' : 'suit-black';
}

function RoundCardRow({
  cards,
  winner,
}: {
  cards: ScenarioRoundCard[];
  winner?: Seat;
}) {
  return (
    <div className="round-cards">
      {cards.map((entry, i) => {
        const card = entry.cardStr ? cardFromStr(entry.cardStr) : null;
        const wasFaceDown = entry.faceDown && !entry.revealed;
        const wasRevealedTrump = entry.faceDown && entry.revealed;
        return (
          <div key={`${entry.seat}-${i}`} className="round-card-entry">
            {card === null || wasFaceDown ? (
              <div className="mini-card face-down-card">
                <span className="face-down-label">
                  {wasFaceDown ? 'face-down' : 'hidden'}
                </span>
              </div>
            ) : (
              <div className={`mini-card ${suitColorClass(card.suit)}`}>
                <span className="rank">{card.rank}</span>
                <span className="suit">{SUIT_SYMBOLS[card.suit]}</span>
                {wasRevealedTrump && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -16,
                      left: 0,
                      right: 0,
                      textAlign: 'center',
                      fontSize: 10,
                      color: 'var(--clr-accent)',
                      fontWeight: 700,
                    }}
                  >
                    cut
                  </span>
                )}
              </div>
            )}
            <span
              className={`round-card-seat ${winner === entry.seat ? 'winner-seat' : ''}`}
            >
              {SEAT_NAMES[entry.seat]}
              {winner === entry.seat ? ' ★' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VerdictPanel({
  verdict,
  scenario,
  onNext,
  onRetry,
  hasNext,
}: {
  verdict: Verdict;
  scenario: Scenario;
  onNext: () => void;
  onRetry: () => void;
  hasNext: boolean;
}) {
  let title = '';
  let detail = '';
  let cls = 'verdict-correct';

  switch (verdict.kind) {
    case 'correct':
      title = 'Correct!';
      detail =
        scenario.shouldCall === false
          ? 'Calling now would be wrong; waiting was right.'
          : 'You called Caps and your play order forces the win.';
      cls = 'verdict-correct';
      break;
    case 'correctly_waited':
      title = 'Correct — calling now would be early.';
      detail = '';
      cls = 'verdict-correct';
      break;
    case 'right_call_wrong_order':
      title = 'Right call, wrong order.';
      detail = `Caps does hold here, but only with this play order: ${verdict.expected.join(' → ')}. You played: ${verdict.given.join(' → ')}.`;
      cls = 'verdict-warn';
      break;
    case 'too_early':
      title = 'Too early — that\'s Wrong/Early Caps.';
      detail =
        'In a real game this would attract the 5-stone penalty. The opposition still has a way to win at least one round.';
      cls = 'verdict-error';
      break;
    case 'should_have_called':
      title = 'Late — you should have called now.';
      detail =
        'In a real game, missing this first opportunity flips the win to a Late Caps loss + 1 stone.';
      cls = 'verdict-error';
      break;
  }

  return (
    <div className={`verdict ${cls}`}>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      <p>{scenario.rationale}</p>
      {scenario.hint && <p className="hint">{scenario.hint}</p>}
      <div className="verdict-actions">
        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
        {hasNext && (
          <button className="btn" onClick={onNext}>
            Next scenario →
          </button>
        )}
      </div>
    </div>
  );
}
