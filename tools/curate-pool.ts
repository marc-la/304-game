// CLI entrypoint for the diverse hard-caps pool curator.
//
// Streaming JSONL output: each accepted puzzle is appended on its
// own line as soon as it's found. A sidecar .meta.json records
// thresholds, master seed, and running stats. The process is
// resumable / killable; partial output is durable via fsync.
//
// Usage:
//   tsx tools/curate-pool.ts \
//     --out frontend/public/puzzles/pool.jsonl \
//     --master-seed 42 \
//     [--max-accepted 5000]   [--max-attempts 1000000]
//     [--max-wall-seconds 86400]
//     [--min-labour 4] [--min-suit-span 2] [--min-round 3] [--max-round 7]
//     [--samples 8] [--no-dedup]
//
// Defaults: no caps on accepted/attempts/wall; runs until killed.
// Use Ctrl-C; partial output is saved and the meta file is written
// on each accept-batch.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { curatePool } from './curate/pool-curator.js';
import { DEFAULT_THRESHOLDS } from './curate/types.js';
import type { CuratorThresholds } from './curate/types.js';

interface CliArgs {
  outPath: string;
  metaPath: string;
  masterSeed: number;
  maxAccepted?: number;
  maxAttempts?: number;
  maxWallSeconds?: number;
  thresholds: CuratorThresholds;
  uniqueSouthHands: boolean;
}

const REPO_ROOT = resolve(__dirname, '..');

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2);
  let outPath = resolve(REPO_ROOT, 'frontend/public/puzzles/pool.jsonl');
  let masterSeed = 42;
  let maxAccepted: number | undefined;
  let maxAttempts: number | undefined;
  let maxWallSeconds: number | undefined;
  const t: CuratorThresholds = { ...DEFAULT_THRESHOLDS };
  let dedup = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case '--out': outPath = resolve(next()); break;
      case '--master-seed': masterSeed = parseInt(next(), 10) >>> 0; break;
      case '--max-accepted': maxAccepted = parseInt(next(), 10); break;
      case '--max-attempts': maxAttempts = parseInt(next(), 10); break;
      case '--max-wall-seconds': maxWallSeconds = parseInt(next(), 10); break;
      case '--min-labour': t.minLabour = parseInt(next(), 10); break;
      case '--min-suit-span': t.minWitnessSuitSpan = parseInt(next(), 10); break;
      case '--min-round': t.minOptimalCallRound = parseInt(next(), 10); break;
      case '--max-round': t.maxOptimalCallRound = parseInt(next(), 10); break;
      case '--samples': t.trajectorySamples = parseInt(next(), 10); break;
      case '--min-hcp': t.minHcp = parseInt(next(), 10); break;
      case '--min-trump-len': t.minTrumpLen = parseInt(next(), 10); break;
      case '--no-dedup': dedup = false; break;
      default:
        console.error(`unknown flag: ${a}`);
        process.exit(2);
    }
  }
  const metaPath = outPath.replace(/\.jsonl?$/, '') + '.meta.json';
  return {
    outPath, metaPath, masterSeed, maxAccepted, maxAttempts, maxWallSeconds,
    thresholds: t, uniqueSouthHands: dedup,
  };
};

const main = () => {
  const cli = parseArgs();
  mkdirSync(dirname(cli.outPath), { recursive: true });
  const tStart = Date.now();
  console.log(`Pool curation starting.`);
  console.log(`  out=${cli.outPath}`);
  console.log(`  meta=${cli.metaPath}`);
  console.log(`  master-seed=${cli.masterSeed}`);
  console.log(`  thresholds=`, cli.thresholds);
  console.log(`  budget: accepted=${cli.maxAccepted ?? '∞'}  attempts=${cli.maxAttempts ?? '∞'}  wall=${cli.maxWallSeconds ?? '∞'}s`);
  console.log();

  const meta = curatePool({
    outPath: cli.outPath,
    metaPath: cli.metaPath,
    masterSeed: cli.masterSeed,
    maxAccepted: cli.maxAccepted,
    maxAttempts: cli.maxAttempts,
    maxWallSeconds: cli.maxWallSeconds,
    thresholds: cli.thresholds,
    uniqueSouthHands: cli.uniqueSouthHands,
    progressEvery: 200,
    onProgress: ({ attempts, accepted, rejection, cells }) => {
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      const cellStr = Object.entries(cells)
        .sort()
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      console.log(
        `  att=${attempts} acc=${accepted} ${dt}s | ` +
        `rej L1=${rejection.L1} L4=${rejection.L4} L3=${rejection.L3} dup=${rejection.duplicate} | ` +
        `cells: ${cellStr}`,
      );
    },
  });

  console.log();
  console.log(`Done. Accepted ${meta.stats.accepted} puzzles after ${meta.stats.attempts} attempts in ${meta.stats.elapsedSeconds.toFixed(1)}s.`);
  console.log(`Cells:`, meta.stats.cells);
  console.log(`Rejection:`, meta.stats.rejection);
};

main();
