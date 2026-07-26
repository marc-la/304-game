// Shared data + helpers for the leaderboard domain pages.
// Contract: .claude/leaderboard-design.md. Data comes pre-parsed from the
// build-time pipeline (tools/leaderboard/build-data.ts) — no client parsing.

export const PLAYER_ORDER = ['LX', 'ML', 'MN', 'VM'];

let cached = null;

export async function loadData() {
  if (cached) return cached;
  const res = await fetch('data/leaderboard.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  cached = await res.json();
  return cached;
}

export function playerName(data, initial) {
  const p = data.players.find((x) => x.initial === initial);
  return p ? p.first : initial;
}

/* Player colours live in CSS so they follow the theme. Charts re-read them
   on theme change (design spec §6). */
export function playerColors() {
  const cs = getComputedStyle(document.documentElement);
  const map = {};
  for (const p of PLAYER_ORDER) {
    map[p] = (cs.getPropertyValue('--player-' + p) || '').trim() || '#888';
  }
  return map;
}

export function onThemeChange(fn) {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
}

/* ---- season scoping ---- */

export function revsForScope(data, scope) {
  // scope: 'all' | season number
  if (scope === 'all') return data.revolutions;
  return data.revolutions.filter((r) => r.season === scope);
}

export function matchesForScope(data, scope) {
  if (scope === 'all') return data.matches;
  return data.matches.filter((m) => m.season === scope);
}

/* Standings for a scope: ranked by revolutions won -> matches won -> stone. */
export function standings(data, scope) {
  const revs = revsForScope(data, scope);
  const matches = matchesForScope(data, scope);
  const rows = PLAYER_ORDER.map((p) => {
    let revsWon = 0;
    for (const r of revs) if (r.winners.includes(p)) revsWon++;
    let matchesWon = 0, played = 0, stone = 0;
    for (const m of matches) {
      const inA = m.teamA.includes(p), inB = m.teamB.includes(p);
      if (!inA && !inB) continue;
      played++;
      if (m.winner.includes(p)) matchesWon++;
    }
    for (const r of revs) stone += r.results[p].s;
    const form = revs.slice(-5).map((r) => {
      const pl = r.placements.find((x) => x.p === p);
      return pl ? { rank: pl.rank, win: pl.win, tied: pl.tied } : null;
    });
    return { p, revsWon, revsPlayed: revs.length, matchesWon, played, stone, form,
      winRate: played ? Math.round((matchesWon / played) * 100) : 0 };
  });
  rows.sort((a, b) => b.revsWon - a.revsWon || b.matchesWon - a.matchesWon || b.stone - a.stone);
  return rows;
}

export function partnerships(data, scope) {
  const matches = matchesForScope(data, scope);
  const pairs = {};
  for (const m of matches) {
    for (const team of [m.teamA, m.teamB]) {
      const key = [...team].sort().join('-');
      pairs[key] ??= { players: [...team].sort(), played: 0, won: 0 };
      pairs[key].played++;
      if (m.winner.join('-') === key) pairs[key].won++;
    }
  }
  return Object.values(pairs).sort((a, b) => (b.won / b.played) - (a.won / a.played));
}

/* ---- formatting ---- */

const DATE_FMT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_FMT_SHORT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });

export function fmtDate(iso, short) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return (short ? DATE_FMT_SHORT : DATE_FMT).format(d);
}

export function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---- shared page chrome ---- */

export function renderMeta(data) {
  const el = document.getElementById('lb-updated');
  if (!el) return;
  const last = data.revolutions[data.revolutions.length - 1];
  if (last) el.textContent = 'updated ' + fmtDate(last.date);
}

export function showMain() {
  const loading = document.getElementById('lb-loading');
  if (loading) loading.hidden = true;
  const main = document.getElementById('lb-main');
  if (main) main.hidden = false;
}

export function showError(err) {
  console.error('leaderboard data failed:', err);
  const loading = document.getElementById('lb-loading');
  if (loading) loading.hidden = true;
  const el = document.getElementById('lb-error');
  if (el) el.hidden = false;
}

/* Season segmented toggle. Renders into container; calls onChange(scope) with
   'all' or a season number. Persists in the URL hash (#s=2 / #s=all). */
export function seasonToggle(container, data, onChange) {
  const fromHash = () => {
    const m = location.hash.match(/s=(all|\d+)/);
    if (!m) return data.currentSeason;
    return m[1] === 'all' ? 'all' : parseInt(m[1], 10);
  };
  let scope = fromHash();
  const options = [
    ...[...data.seasons].sort((a, b) => b - a).map((s) => ({ label: 'Season ' + s, val: s })),
    { label: 'All-time', val: 'all' },
  ];
  container.classList.add('lb-seg', 'lb-seg--seasons');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Season scope');

  function paint() {
    container.innerHTML = '';
    for (const o of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lb-seg-item' + (o.val === scope ? ' is-active' : '');
      btn.setAttribute('aria-pressed', o.val === scope ? 'true' : 'false');
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        if (o.val === scope) return;
        scope = o.val;
        history.replaceState(null, '', '#s=' + (scope === 'all' ? 'all' : scope));
        paint();
        onChange(scope);
      });
      container.appendChild(btn);
    }
  }
  paint();
  return scope;
}
