/**
 * Build-time leaderboard data pipeline.
 *
 * Parses data/stats.xlsx (Revolutions / Matches / By Player) and the betting
 * CSVs in data/bets/ into a single site/public/data/leaderboard.json that the
 * three leaderboard pages fetch. This removes SheetJS + Chart.js from the
 * client entirely (see .claude/leaderboard-design.md §2).
 *
 * Invoked from frontend/vite.config.ts on dev-server start and on build.
 * Can also be run directly: npx tsx tools/leaderboard/build-data.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as XLSX from 'xlsx';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(REPO_ROOT, 'data');
const OUT_DIR = resolve(REPO_ROOT, 'site', 'public', 'data');

export const PLAYER_ORDER = ['LX', 'ML', 'MN', 'VM'] as const;
type Initial = (typeof PLAYER_ORDER)[number];

interface PlayerResult { m: number; s: number }
interface Placement { p: Initial; rank: number; tied: boolean; win: boolean }

// ---- xlsx helpers -----------------------------------------------------------

// Format as local YYYY-MM-DD: xlsx dates are local midnights, so
// toISOString() would shift them a day west of UTC.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function excelDate(val: unknown): string | null {
  if (val instanceof Date) return ymd(val);
  if (typeof val === 'number') return ymd(new Date(Math.round((val - 25569) * 86400000)));
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val);
    return isNaN(+d) ? null : ymd(d);
  }
  return null;
}

function parseResult(str: unknown): PlayerResult {
  const m = String(str ?? '').match(/^(\d+)\s*\((\d+)\)$/);
  return m ? { m: parseInt(m[1], 10), s: parseInt(m[2], 10) } : { m: 0, s: 0 };
}

function revNum(id: string): number {
  const m = id.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function placements(results: Record<Initial, PlayerResult>): Placement[] {
  const sorted = [...PLAYER_ORDER].sort((a, b) => {
    if (results[b].m !== results[a].m) return results[b].m - results[a].m;
    return results[b].s - results[a].s;
  });
  const out: Placement[] = [];
  let rank = 1;
  sorted.forEach((p, i) => {
    if (i > 0) {
      const prev = results[sorted[i - 1]], cur = results[p];
      if (prev.m !== cur.m || prev.s !== cur.s) rank = i + 1;
    }
    out.push({ p, rank, tied: false, win: rank === 1 });
  });
  const winners = out.filter((x) => x.rank === 1);
  if (winners.length > 1) winners.forEach((w) => { w.tied = true; });
  return out;
}

// ---- bet CSV parsing (grammar per site history page legend) -----------------

export interface BetEvent {
  type: 'penalty' | 'pcc-win' | 'pcc-loss' | 'caps-win' | 'caps-late' | 'caps-wrong' | 'bet-win' | 'bet-loss' | 'unknown';
  bet?: string;
  bonus?: number;
  raw: string;
}

export function parseBetToken(token: string): BetEvent | null {
  if (!token) return null;
  if (token === 'PN') return { type: 'penalty', raw: token };
  if (token === 'PCC') return { type: 'pcc-win', raw: token };
  if (token === 'PCC-') return { type: 'pcc-loss', raw: token };
  const m = token.match(/^(\d+|H\d*)(\+0|\+1|-L|-W|-)?$/);
  if (!m) return { type: 'unknown', raw: token };
  const bet = m[1];
  switch (m[2] || '') {
    case '+0': return { type: 'caps-win', bet, bonus: 0, raw: token };
    case '+1': return { type: 'caps-win', bet, bonus: 1, raw: token };
    case '-L': return { type: 'caps-late', bet, raw: token };
    case '-W': return { type: 'caps-wrong', bet, raw: token };
    case '-': return { type: 'bet-loss', bet, raw: token };
    default: return { type: 'bet-win', bet, raw: token };
  }
}

interface BetSet {
  setNo: number;
  teamA: string[]; teamB: string[];
  scoreA: number; scoreB: number;
  rounds: string[];
  playerBets: Record<string, string[]>;
}
interface BetSheet {
  sets: BetSet[];
  overall: Record<string, { sets: number; stone: number }>;
  notes: string[];
  csv: string;
}

function parseBetsCSV(text: string, csvPath: string): BetSheet {
  const lines = text.split(/\r?\n/);
  const sets: BetSet[] = [];
  let current: BetSet | null = null;
  let phase: 'sets' | 'overall' | 'notes' = 'sets';
  const notes: string[] = [];
  const overall: BetSheet['overall'] = {};

  for (const raw of lines) {
    if (raw == null) continue;
    const line = raw.replace(/﻿/, '');
    if (!line.trim() && phase !== 'notes') continue;

    const setMatch = line.match(/^Set\s+(\d+)\s+(\S+)\s+(\d+)\s*-\s*(\d+)\s+(\S+)/);
    if (setMatch) {
      current = {
        setNo: parseInt(setMatch[1], 10),
        teamA: setMatch[2].split('/'),
        scoreA: parseInt(setMatch[3], 10),
        scoreB: parseInt(setMatch[4], 10),
        teamB: setMatch[5].split('/'),
        rounds: [],
        playerBets: {},
      };
      sets.push(current);
      phase = 'sets';
      continue;
    }
    if (/^OVERALL\b/i.test(line)) { phase = 'overall'; continue; }
    if (/^NOTES\b/i.test(line)) { phase = 'notes'; continue; }

    const cells = line.split(',').map((s) => s.trim());
    const first = cells[0];
    if (phase === 'sets' && current) {
      if (first === '') {
        current.rounds = cells.slice(1).filter((c) => c !== '');
      } else if ((PLAYER_ORDER as readonly string[]).includes(first)) {
        current.playerBets[first] = cells.slice(1);
      }
    } else if (phase === 'overall') {
      if ((PLAYER_ORDER as readonly string[]).includes(first)) {
        overall[first] = { sets: parseInt(cells[1], 10) || 0, stone: parseInt(cells[2], 10) || 0 };
      }
    } else if (phase === 'notes') {
      const t = line.trim();
      if (t) notes.push(t.replace(/^-\s*/, ''));
    }
  }
  return { sets, overall, notes, csv: csvPath };
}

// ---- main build -------------------------------------------------------------

export function buildLeaderboardData(): string {
  const wb = XLSX.read(readFileSync(join(DATA_DIR, 'stats.xlsx')), { type: 'buffer', cellDates: true });
  const revRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Revolutions']);
  const matchRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Matches']);
  const playerRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['By Player']);

  const players = playerRows.map((r) => ({
    initial: String(r['Initial']),
    name: String(r['Name']),
    first: String(r['Name']).split(' ')[0],
  }));

  // Revolutions, chronological. Season boundaries are data-driven from Notes.
  let season = 1;
  const revolutions = revRows
    .map((r) => ({
      id: String(r['RevolutionID']),
      date: excelDate(r['Date']),
      notes: String(r['Notes'] ?? ''),
      results: Object.fromEntries(PLAYER_ORDER.map((p) => [p, parseResult(r[p])])) as Record<Initial, PlayerResult>,
    }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return revNum(a.id) - revNum(b.id);
    })
    .map((r, i) => {
      const m = r.notes.match(/SEASON\s+(\d+)\s+START/i);
      if (m) season = parseInt(m[1], 10);
      const pl = placements(r.results);
      return {
        ...r,
        index: i + 1,
        num: revNum(r.id),
        season,
        placements: pl,
        winners: pl.filter((x) => x.win).map((x) => x.p),
      };
    });

  const revById = new Map(revolutions.map((r) => [r.id, r]));

  const matches = matchRows.map((r) => ({
    revId: String(r['RevolutionID']),
    setNo: Number(r['SetNo']),
    teamA: [String(r['TeamA_P1']), String(r['TeamA_P2'])],
    teamB: [String(r['TeamB_P1']), String(r['TeamB_P2'])],
    scoreA: Number(r['ScoreA']),
    scoreB: Number(r['ScoreB']),
    winner: String(r['Winner'] ?? '').split('/').map((s) => s.trim()).filter(Boolean).sort(),
    notes: String(r['Notes'] ?? ''),
    season: revById.get(String(r['RevolutionID']))?.season ?? 1,
  }));

  // Betting sheets, keyed by revolution id via filename date + rev number.
  const bets: Record<string, BetSheet> = {};
  if (existsSync(join(DATA_DIR, 'bets'))) {
    for (const f of readdirSync(join(DATA_DIR, 'bets')).sort()) {
      const m = f.match(/^(\d{4})-(\d{2})-(\d{2})_304_rev(\d+)\.csv$/);
      if (!m) continue;
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      const num = parseInt(m[4], 10);
      const rev = revolutions.find((r) => r.date === date && r.num === num);
      if (!rev) continue;
      bets[rev.id] = parseBetsCSV(readFileSync(join(DATA_DIR, 'bets', f), 'utf8'), `data/bets/${f}`);
    }
  }

  // Per-player bet aggregates + event log + per-rev event badges.
  const betStats = Object.fromEntries(PLAYER_ORDER.map((p) => [p, {
    bets: 0, sets: 0,
    mix: {} as Record<string, number>, // tier -> count (60,70,H,100,...,250,PCC)
    wins: 0, losses: 0,
    capsPlain: 0, capsBonus: 0, capsLate: 0, capsWrong: 0,
    pccWin: 0, pccLoss: 0, penalties: 0,
  }]));
  const eventLog: Array<{ date: string | null; revId: string; setNo: number; player: string; token: string; type: string }> = [];
  const revEvents: Record<string, Partial<Record<Initial, string[]>>> = {};

  const NOTABLE: BetEvent['type'][] = ['pcc-win', 'pcc-loss', 'caps-wrong', 'caps-late'];
  for (const [revId, sheet] of Object.entries(bets)) {
    const rev = revById.get(revId)!;
    revEvents[revId] = {};
    for (const set of sheet.sets) {
      for (const p of PLAYER_ORDER) {
        const cells = set.playerBets[p];
        if (cells) betStats[p].sets++;
        for (const cell of cells ?? []) {
          if (!cell.trim()) continue;
          for (const tok of cell.split(';').map((t) => t.trim()).filter(Boolean)) {
            const ev = parseBetToken(tok);
            if (!ev) continue;
            const s = betStats[p];
            switch (ev.type) {
              case 'penalty': s.penalties++; break;
              case 'pcc-win': s.pccWin++; s.bets++; s.wins++; break;
              case 'pcc-loss': s.pccLoss++; s.bets++; s.losses++; break;
              case 'caps-win': s.bets++; s.wins++; if (ev.bonus) s.capsBonus++; else s.capsPlain++; break;
              case 'caps-late': s.bets++; s.losses++; s.capsLate++; break;
              case 'caps-wrong': s.bets++; s.losses++; s.capsWrong++; break;
              case 'bet-win': s.bets++; s.wins++; break;
              case 'bet-loss': s.bets++; s.losses++; break;
            }
            if (ev.type !== 'penalty' && ev.type !== 'unknown') {
              const tier = ev.type.startsWith('pcc') ? 'PCC' : (ev.bet ?? '?').replace(/^H\d*$/, 'H');
              betStats[p].mix[tier] = (betStats[p].mix[tier] ?? 0) + 1;
            }
            const isBig = ev.bet === '250' || Number(ev.bet) >= 100;
            if (NOTABLE.includes(ev.type) || isBig || ev.type === 'penalty') {
              if (NOTABLE.includes(ev.type) || isBig) {
                eventLog.push({ date: rev.date, revId, setNo: set.setNo, player: p, token: ev.raw, type: ev.type });
              }
              (revEvents[revId]![p] ??= []).push(ev.raw);
            }
          }
        }
      }
    }
  }

  // Optional AI play-style one-liners (generated by the player-styles workflow).
  let styles: Record<string, string> = {};
  const stylesPath = join(DATA_DIR, 'player-styles.json');
  if (existsSync(stylesPath)) {
    try { styles = JSON.parse(readFileSync(stylesPath, 'utf8')); } catch { /* ignore malformed */ }
  }

  const seasons = [...new Set(revolutions.map((r) => r.season))].sort((a, b) => a - b);

  const out = {
    generatedAt: new Date().toISOString(),
    players,
    seasons,
    currentSeason: seasons[seasons.length - 1] ?? 1,
    revolutions,
    matches,
    bets,
    betStats,
    eventLog,
    revEvents,
    styles,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'leaderboard.json');
  writeFileSync(outPath, JSON.stringify(out));
  return outPath;
}

// Direct CLI invocation.
if (process.argv[1] && /build-data\.(ts|js)$/.test(process.argv[1])) {
  const p = buildLeaderboardData();
  console.log('leaderboard data written:', p);
}
