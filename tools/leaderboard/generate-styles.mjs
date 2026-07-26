// Generates one-sentence play-style descriptions per player from the
// betting-sheet-resolution data, via the Claude API. Output: data/player-styles.json,
// which the build-time pipeline folds into leaderboard.json and the insights
// page renders under each betting profile.
//
// Run by .github/workflows/player-styles.yml whenever data/bets/ or
// data/stats.xlsx changes on main. Requires ANTHROPIC_API_KEY.
// Local run: node tools/leaderboard/generate-styles.mjs
// (run `npx tsx tools/leaderboard/build-data.ts` first so leaderboard.json exists)
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const dataPath = resolve(repoRoot, 'site', 'public', 'data', 'leaderboard.json');
const outPath = resolve(repoRoot, 'data', 'player-styles.json');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const players = Object.fromEntries(data.players.map((p) => [p.initial, p.first]));

// Compact per-player evidence: bet aggregates + their notable events.
const evidence = {};
for (const [initial, stats] of Object.entries(data.betStats)) {
  evidence[players[initial] ?? initial] = {
    ...stats,
    notableEvents: data.eventLog
      .filter((e) => e.player === initial)
      .map((e) => `${e.date} set ${e.setNo}: ${e.token} (${e.type})`),
  };
}

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 2048,
  system:
    'You are writing one-line play-style portraits for a leaderboard page of a ' +
    'four-player 304 (Tamil trick-taking card game) group. Context: bids run the ' +
    'ladder 60 < 70 < ... < H (Honest, 220) < 250 < PCC (Partner Closed Caps, the ' +
    'rarest and boldest bid). A trailing "-" means the bid was lost; "+0"/"+1" are ' +
    'successful Caps calls (+1 = called early, harder); "-L" late Caps, "-W" wrong ' +
    'Caps (5-stone disaster); PN is a penalty. The culture semi-rewards hubris: ' +
    'aggression is respected until it fails. Write with dry wit, like a friend who ' +
    'has watched every game — specific to the evidence, never generic. One sentence ' +
    'per player, under 25 words, no player-name prefix.',
  messages: [
    {
      role: 'user',
      content:
        'Betting-sheet evidence per player (counts cover only revolutions with a recorded sheet):\n\n' +
        JSON.stringify(evidence, null, 2) +
        '\n\nWrite one play-style sentence per player, keyed by initials: ' +
        Object.entries(players).map(([i, n]) => `${i} = ${n}`).join(', ') + '.',
    },
  ],
  output_config: {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          LX: { type: 'string' },
          ML: { type: 'string' },
          MN: { type: 'string' },
          VM: { type: 'string' },
        },
        required: ['LX', 'ML', 'MN', 'VM'],
        additionalProperties: false,
      },
    },
  },
});

if (response.stop_reason === 'refusal') {
  console.error('Model refused the request; leaving player-styles.json unchanged.');
  process.exit(1);
}

const text = response.content.find((b) => b.type === 'text')?.text;
if (!text) {
  console.error('No text block in response; aborting.');
  process.exit(1);
}

const styles = JSON.parse(text);
writeFileSync(outPath, JSON.stringify(styles, null, 2) + '\n');
console.log('Wrote', outPath);
for (const [k, v] of Object.entries(styles)) console.log(` ${k}: ${v}`);
