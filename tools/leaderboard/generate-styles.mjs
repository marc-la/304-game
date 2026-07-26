// Generates one-sentence play-style descriptions per player from the
// betting-sheet-resolution data, via the Gemini API. Output:
// data/player-styles.json, which the build-time pipeline folds into
// leaderboard.json and the insights page renders under each epithet.
//
// Run by .github/workflows/player-styles.yml whenever data/bets/ or
// data/stats.xlsx changes on main. Requires GEMINI_API_KEY.
// Local run: GEMINI_API_KEY=... node tools/leaderboard/generate-styles.mjs
// (run `npx tsx tools/leaderboard/build-data.ts` first so leaderboard.json exists)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const dataPath = resolve(repoRoot, 'site', 'public', 'data', 'leaderboard.json');
const outPath = resolve(repoRoot, 'data', 'player-styles.json');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const players = Object.fromEntries(data.players.map((p) => [p.initial, p.first]));

// Compact per-player evidence: aggregate bet stats only. No per-event log —
// the sentence should describe how they play, not recount what happened;
// the site already shows the history.
const evidence = {};
for (const [initial, stats] of Object.entries(data.betStats)) {
  evidence[players[initial] ?? initial] = stats;
}

const systemInstruction =
  'You are writing one-line play-style portraits for a leaderboard page of a ' +
  'four-player 304 (Tamil trick-taking card game) group. Context: bids run the ' +
  'ladder 60 < 70 < ... < H (Honest, 220) < 250 < PCC (Partner Closed Caps, the ' +
  'rarest and boldest bid); Caps means promising every trick; PN is a penalty. ' +
  'The culture semi-rewards hubris: aggression is respected until it fails. ' +
  'Work in two steps. First, privately read the aggregates and decide what they ' +
  'reveal about each player\'s temperament at the table — appetite for risk, ' +
  'patience, self-belief, discipline. Then write one sentence per player that ' +
  'describes that temperament, the way a friend who has watched every game ' +
  'would characterise how they play. The sentence is a portrait, not a report: ' +
  'no statistics, no counts, no scores, no dates, no specific games or events — ' +
  'the site already shows the numbers. Dry wit, specific to the personality the ' +
  'data implies, never generic. Under 22 words, no player-name prefix.';

const userPrompt =
  'Aggregate betting-sheet stats per player (your private evidence — derive the ' +
  'insight, then write the portrait; do not quote these numbers back):\n\n' +
  JSON.stringify(evidence, null, 2) +
  '\n\nWrite one play-style sentence per player, keyed by initials: ' +
  Object.entries(players).map(([i, n]) => `${i} = ${n}`).join(', ') + '.';

/* Model discovery: hardcoded names rot (retired models 404 for new users),
   so ask the API what this key can actually use and rank the candidates —
   "-latest" aliases first, then newest flash-family, then pro. */
const API = 'https://generativelanguage.googleapis.com/v1beta';

async function candidateModels() {
  const res = await fetch(API + '/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    console.error('ListModels failed:', res.status, await res.text());
    process.exit(1);
  }
  const { models = [] } = await res.json();
  const exclude = /embed|imagen|image|veo|tts|audio|live|aqa|vision|robotics/i;
  const version = (n) => {
    const m = n.match(/(\d+)\.(\d+)/) || n.match(/-(\d+)(?:-|$)/);
    return m ? parseFloat(m[1] + '.' + (m[2] ?? 0)) : 0;
  };
  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => !exclude.test(n))
    .sort((a, b) => {
      const score = (n) =>
        (/-latest$/.test(n) ? 1000 : 0) +
        (/flash/.test(n) ? 100 : /pro/.test(n) ? 50 : 0) +
        (!/preview|exp/.test(n) ? 25 : 0) +
        version(n);
      return score(b) - score(a);
    });
}

async function generate(model) {
  return fetch(API + '/models/' + model + ':generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            LX: { type: 'STRING' },
            ML: { type: 'STRING' },
            MN: { type: 'STRING' },
            VM: { type: 'STRING' },
          },
          required: ['LX', 'ML', 'MN', 'VM'],
        },
      },
    }),
  });
}

const candidates = (await candidateModels()).slice(0, 5);
if (!candidates.length) {
  console.error('No generateContent-capable models available to this key.');
  process.exit(1);
}
console.log('Model candidates:', candidates.join(', '));

let body = null;
for (const model of candidates) {
  const res = await generate(model);
  if (res.ok) {
    console.log('Using model:', model);
    body = await res.json();
    break;
  }
  console.error('Model', model, 'failed:', res.status, (await res.text()).slice(0, 300));
}
if (!body) {
  console.error('All candidate models failed.');
  process.exit(1);
}

const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
if (!text) {
  console.error('No text in Gemini response:', JSON.stringify(body).slice(0, 500));
  process.exit(1);
}

const styles = JSON.parse(text);
for (const k of ['LX', 'ML', 'MN', 'VM']) {
  if (typeof styles[k] !== 'string' || !styles[k].trim()) {
    console.error('Missing/empty style for', k);
    process.exit(1);
  }
}

writeFileSync(outPath, JSON.stringify(styles, null, 2) + '\n');
console.log('Wrote', outPath);
for (const [k, v] of Object.entries(styles)) console.log(` ${k}: ${v}`);
