// Glicko-2 implementation (Mark Glickman, 2012).
// http://www.glicko.net/glicko/glicko2.pdf
//
// In-house implementation rather than a library because the engine
// already enforces "no untracked deps" (per directory.md) and the
// algorithm fits in <100 lines.

const PI = Math.PI;
const SCALE = 173.7178; // rating units per glicko-2 µ unit
const DEFAULT_TAU = 0.5;
const EPS = 1e-6;

export interface Rating {
  rating: number;    // r (display) — anchor at 1000 by convention
  rd: number;        // rating deviation (display)
  volatility: number;
}

export const newRating = (
  rating = 1500,
  rd = 350,
  volatility = 0.06,
): Rating => ({ rating, rd, volatility });

// One match outcome: opponent's rating snapshot + score for our side.
// score = 1 for win, 0.5 for draw, 0 for loss.
export interface MatchOutcome {
  opponent: Rating;
  score: number;
}

const toGlicko2 = (r: Rating): { mu: number; phi: number; sigma: number } => ({
  mu: (r.rating - 1500) / SCALE,
  phi: r.rd / SCALE,
  sigma: r.volatility,
});

const fromGlicko2 = (
  mu: number,
  phi: number,
  sigma: number,
): Rating => ({
  rating: mu * SCALE + 1500,
  rd: phi * SCALE,
  volatility: sigma,
});

const g = (phi: number): number =>
  1 / Math.sqrt(1 + (3 * phi * phi) / (PI * PI));

const E = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

export const update = (
  player: Rating,
  outcomes: ReadonlyArray<MatchOutcome>,
  tau = DEFAULT_TAU,
): Rating => {
  if (outcomes.length === 0) {
    // No matches — only RD inflation. φ' = sqrt(φ² + σ²).
    const { mu, phi, sigma } = toGlicko2(player);
    const phiPrime = Math.sqrt(phi * phi + sigma * sigma);
    return fromGlicko2(mu, phiPrime, sigma);
  }

  const { mu, phi, sigma } = toGlicko2(player);

  // Step 3: compute v (estimated variance).
  let vInv = 0;
  for (const m of outcomes) {
    const { mu: muJ, phi: phiJ } = toGlicko2(m.opponent);
    const gJ = g(phiJ);
    const eJ = E(mu, muJ, phiJ);
    vInv += gJ * gJ * eJ * (1 - eJ);
  }
  const v = 1 / vInv;

  // Step 4: compute ∆ (estimated improvement).
  let deltaSum = 0;
  for (const m of outcomes) {
    const { mu: muJ, phi: phiJ } = toGlicko2(m.opponent);
    deltaSum += g(phiJ) * (m.score - E(mu, muJ, phiJ));
  }
  const delta = v * deltaSum;

  // Step 5: iterate to find new volatility σ'.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const phiSq = phi * phi;
    const denom = phiSq + v + ex;
    return (ex * (delta * delta - phiSq - v - ex)) / (2 * denom * denom)
      - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  let safety = 100;
  while (Math.abs(B - A) > EPS && safety-- > 0) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; }
    else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  // Step 6: update φ'.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: update µ'.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return fromGlicko2(muPrime, phiPrime, sigmaPrime);
};
