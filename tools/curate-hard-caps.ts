// CLI entrypoint for the hard-caps curator.
//
// Usage:
//   tsx tools/curate-hard-caps.ts \
//     --count 730 \
//     --master-seed 42 \
//     --max-attempts 200000 \
//     --out frontend/public/puzzles/hard-caps-curated.json \
//     [--min-labour 4] [--min-round 3] [--max-round 7] [--samples 8]
//     [--no-dedup]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { curate } from './curate/curator.js';
import { DEFAULT_THRESHOLDS } from './curate/types.js';
import type { CuratorThresholds } from './curate/types.js';

interface CliArgs {
  count: number;
  masterSeed: number;
  maxAttempts: number;
  out: string;
  thresholds: CuratorThresholds;
  uniqueSouthHands: boolean;
}

const REPO_ROOT = resolve(__dirname, '..');

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2);
  let count = 50;
  let masterSeed = 42;
  let maxAttempts = 50000;
  let out = resolve(REPO_ROOT, 'frontend/public/puzzles/hard-caps-curated.json');
  const t: CuratorThresholds = { ...DEFAULT_THRESHOLDS };
  let dedup = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case '--count': count = parseInt(next(), 10); break;
      case '--master-seed': masterSeed = parseInt(next(), 10) >>> 0; break;
      case '--max-attempts': maxAttempts = parseInt(next(), 10); break;
      case '--out': out = resolve(next()); break;
      case '--min-labour': t.minLabour = parseInt(next(), 10); break;
      case '--min-suit-span': t.minWitnessSuitSpan = parseInt(next(), 10); break;
      case '--min-round': t.minOptimalCallRound = parseInt(next(), 10); break;
      case '--max-round': t.maxOptimalCallRound = parseInt(next(), 10); break;
      case '--samples': t.trajectorySamples = parseInt(next(), 10); break;
      case '--min-hcp': t.minHcp = parseInt(next(), 10); break;
      case '--no-dedup': dedup = false; break;
      default:
        console.error(`unknown flag: ${a}`);
        process.exit(2);
    }
  }
  return { count, masterSeed, maxAttempts, out, thresholds: t, uniqueSouthHands: dedup };
};

const main = () => {
  const cli = parseArgs();
  const tStart = Date.now();
  console.log(`Curating ${cli.count} hard-caps puzzles (max ${cli.maxAttempts} attempts).`);
  console.log(`  master-seed=${cli.masterSeed}  thresholds=`, cli.thresholds);
  console.log(`  out=${cli.out}`);
  console.log();

  const result = curate({
    count: cli.count,
    masterSeed: cli.masterSeed,
    maxAttempts: cli.maxAttempts,
    thresholds: cli.thresholds,
    uniqueSouthHands: cli.uniqueSouthHands,
    progressEvery: 100,
    onProgress: ({ attempts, accepted, rejection }) => {
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      const rejs = `L1=${rejection.L1} L2=${rejection.L2} L4=${rejection.L4} L3=${rejection.L3} dup=${rejection.duplicate}`;
      console.log(`  attempt=${attempts} accepted=${accepted} ${rejs}  (${dt}s)`);
    },
  });

  const dt = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log();
  console.log(`Done in ${dt}s. Accepted ${result.puzzles.length}/${cli.count} after ${result.attempts} attempts.`);
  console.log(`Rejection by layer:`, result.rejection);

  const file = {
    version: 1 as const,
    criterion: 'hard-caps-v1' as const,
    thresholds: cli.thresholds,
    generatedAt: new Date().toISOString(),
    masterSeed: cli.masterSeed,
    stats: {
      attempts: result.attempts,
      rejection: result.rejection,
    },
    puzzles: result.puzzles,
  };

  mkdirSync(dirname(cli.out), { recursive: true });
  writeFileSync(cli.out, JSON.stringify(file));
  console.log(`Wrote ${cli.out} (${result.puzzles.length} puzzles).`);
};

main();
