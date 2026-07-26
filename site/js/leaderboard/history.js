// Leaderboard history: the archive. Design contract: .claude/leaderboard-design.md §5.
// Rules that matter here: winner keeps their player colour (★ marks the win),
// collapsed rows carry information scent (badges, sheet tail), revolutions are
// hash-linkable, and filters toggle [hidden] — they never re-render.
import {
  loadData, playerName, renderMeta, showMain, showError, fmtDate, esc, PLAYER_ORDER,
} from './core.js';

function ordinalShort(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
}

/* ---- bet token -> styled notation (two inks + weight, no chip zoo) ---- */

function notation(tok) {
  if (tok === 'PN') return '<span class="lb-not lb-not--pn" title="Penalty — 1 stone to opponents">PN</span>';
  if (tok === 'PCC') return '<span class="lb-not lb-not--win lb-not--big" title="Partner Closed Caps won (5 stone)">PCC</span>';
  if (tok === 'PCC-') return '<span class="lb-not lb-not--loss lb-not--big" title="Partner Closed Caps lost (5 stone)">PCC−</span>';
  const m = tok.match(/^(\d+|H\d*)(\+0|\+1|-L|-W|-)?$/);
  if (!m) return '<span class="lb-not" title="Unrecognised">' + esc(tok) + '</span>';
  const bet = esc(m[1]);
  switch (m[2] || '') {
    case '+0': return '<span class="lb-not lb-not--win lb-not--caps" title="Correct Caps (R7+, no bonus)">' + bet + '+0</span>';
    case '+1': return '<span class="lb-not lb-not--win lb-not--caps" title="Correct Caps before R7 (+1 stone)">' + bet + '+1</span>';
    case '-L': return '<span class="lb-not lb-not--loss lb-not--caps" title="Late Caps (loss + 1 stone)">' + bet + '−L</span>';
    case '-W': return '<span class="lb-not lb-not--loss lb-not--big" title="Wrong Caps (5 stone penalty)">' + bet + '−W</span>';
    case '-': return '<span class="lb-not lb-not--loss" title="Bet lost">' + bet + '−</span>';
    default: return '<span class="lb-not lb-not--win" title="Bet won">' + bet + '</span>';
  }
}

function notationCell(raw) {
  const t = (raw || '').trim();
  if (!t) return '';
  return t.split(';').map((x) => notation(x.trim())).join(' ');
}

/* ---- bet sheet artifact ---- */

function lastPlayedRound(set) {
  let last = 0;
  for (const p of PLAYER_ORDER) {
    const cells = set.playerBets[p] || [];
    for (let i = 0; i < cells.length; i++) {
      if ((cells[i] || '').trim()) last = Math.max(last, i + 1);
    }
  }
  return Math.max(last, 1);
}

function sheetTable(data, set, match) {
  const nRounds = lastPlayedRound(set);
  const winners = match ? match.winner : [];
  // team-grouped rows: teamA pair, then teamB pair
  const order = [...set.teamA, ...set.teamB].filter((p) => PLAYER_ORDER.includes(p));
  for (const p of PLAYER_ORDER) if (!order.includes(p)) order.push(p);

  let html = '<div class="lb-sheet-wrap"><table class="lb-sheet"><thead><tr><th class="lb-sheet-name"></th>';
  for (let r = 1; r <= nRounds; r++) html += '<th>' + r + '</th>';
  html += '</tr></thead><tbody>';
  order.forEach((p, idx) => {
    const teamB = set.teamB.includes(p);
    const cls = (idx === 2 ? 'lb-sheet-teamsplit' : '');
    const win = winners.includes(p) ? ' <span class="lb-sheet-star" title="Won the set">★</span>' : '';
    html += '<tr class="' + cls + '"><td class="lb-sheet-name"><i class="lb-dot" style="background:var(--player-' + p + ')"></i>' + esc(playerName(data, p)) + win + '</td>';
    const cells = set.playerBets[p] || [];
    for (let r = 0; r < nRounds; r++) {
      html += '<td>' + notationCell(cells[r]) + '</td>';
    }
    html += '</tr>';
    void teamB;
  });
  html += '</tbody></table></div>';
  return html;
}

/* ---- rev node ---- */

function badgesFor(data, rev) {
  const ev = data.revEvents[rev.id];
  if (!ev) return '';
  const toks = [];
  for (const p of PLAYER_ORDER) {
    for (const t of ev[p] || []) {
      if (t === 'PN') continue; // penalties are noise at this level
      toks.push(t);
    }
  }
  if (!toks.length) return '';
  return '<span class="lb-rev-badges">' + toks.slice(0, 4).map((t) => notation(t)).join('') + '</span>';
}

function buildRevNode(data, rev, revMatches) {
  const sheet = data.bets[rev.id];
  const winner = rev.placements[0];
  const rest = rev.placements.slice(1);

  const winnerHtml =
    '<span class="lb-rev-winner" style="--pc: var(--player-' + winner.p + ')">' +
      '<span class="lb-rev-star" aria-hidden="true">★</span>' +
      '<span class="lb-rev-winner-name">' + esc(playerName(data, winner.p)) + (winner.tied ? ' <small>(tied)</small>' : '') + '</span>' +
      '<span class="lb-rev-score">' + rev.results[winner.p].m + '·' + rev.results[winner.p].s + '</span>' +
    '</span>';

  const runHtml = rest.map((pl) =>
    '<span class="lb-rev-run-item" title="' + (pl.tied ? 'Tied ' : '') + ordinalShort(pl.rank) + '">' +
      '<i class="lb-dot" style="background:var(--player-' + pl.p + ')"></i>' +
      esc(playerName(data, pl.p)) + ' <span class="lb-rev-score">' + rev.results[pl.p].m + '·' + rev.results[pl.p].s + '</span>' +
    '</span>'
  ).join('<span class="lb-rev-run-sep">›</span>');

  const tail = sheet
    ? revMatches.length + ' sets · sheet ✓'
    : (revMatches.length ? revMatches.length + ' sets · no sheet' : 'no match data');

  const el = document.createElement('details');
  el.className = 'lb-rev';
  el.id = rev.id;
  el.dataset.winners = rev.winners.join(' ');
  el.dataset.season = String(rev.season);

  const summary = document.createElement('summary');
  summary.className = 'lb-rev-summary';
  summary.innerHTML =
    '<span class="lb-chevron" aria-hidden="true"></span>' +
    '<span class="lb-rev-num">Rev ' + rev.num + '</span>' +
    winnerHtml +
    '<span class="lb-rev-run">' + runHtml + '</span>' +
    badgesFor(data, rev) +
    '<span class="lb-rev-tail">' + tail + '</span>';
  el.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'lb-rev-body';
  if (rev.notes) {
    const notes = document.createElement('p');
    notes.className = 'lb-rev-notes';
    notes.textContent = rev.notes;
    body.appendChild(notes);
  }

  for (const m of revMatches) {
    body.appendChild(buildMatchNode(data, m, sheet));
  }

  if (sheet) {
    const foot = document.createElement('div');
    foot.className = 'lb-sheet-overall';
    const parts = PLAYER_ORDER.filter((p) => sheet.overall[p]).map((p) =>
      '<span><i class="lb-dot" style="background:var(--player-' + p + ')"></i>' + esc(playerName(data, p)) +
      ' <span class="lb-rev-score">' + sheet.overall[p].sets + '·' + sheet.overall[p].stone + '</span></span>');
    foot.innerHTML = (parts.length ? '<span class="lb-sheet-overall-label">Sheet totals</span>' + parts.join('') : '') +
      '<a class="lb-raw-link" href="' + sheet.csv + '" download>raw sheet ↓</a>';
    body.appendChild(foot);
  }

  el.appendChild(body);
  return el;
}

function buildMatchNode(data, m, sheet) {
  const set = sheet ? sheet.sets.find((s) => s.setNo === m.setNo) : null;
  const winA = m.teamA.every((p) => m.winner.includes(p));
  const winB = m.teamB.every((p) => m.winner.includes(p));

  const team = (t, won) =>
    '<span class="lb-match-team' + (won ? ' is-winner' : '') + '">' +
    t.map((p) => '<i class="lb-dot" style="background:var(--player-' + p + ')"></i>' + esc(playerName(data, p))).join(' &amp; ') +
    '</span>';

  const el = document.createElement('details');
  el.className = 'lb-match';
  const summary = document.createElement('summary');
  summary.className = 'lb-match-summary';
  summary.innerHTML =
    '<span class="lb-chevron" aria-hidden="true"></span>' +
    '<span class="lb-match-set">Set ' + m.setNo + '</span>' +
    team(m.teamA, winA) + '<span class="lb-match-vs">v</span>' + team(m.teamB, winB) +
    '<span class="lb-match-score"><span class="' + (winA ? 'is-winner' : '') + '">' + m.scoreA + '</span>–<span class="' + (winB ? 'is-winner' : '') + '">' + m.scoreB + '</span></span>' +
    (set ? '' : '<span class="lb-rev-tail">no sheet</span>');
  el.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'lb-match-body';
  if (m.notes) {
    const n = document.createElement('p');
    n.className = 'lb-rev-notes';
    n.textContent = m.notes;
    body.appendChild(n);
  }
  if (set) {
    body.insertAdjacentHTML('beforeend', sheetTable(data, set, m));
    const setNotes = (sheet.notes || []).filter((x) => new RegExp('^' + m.setNo + '\\.').test(x));
    if (setNotes.length) {
      body.insertAdjacentHTML('beforeend',
        '<ul class="lb-sheet-notes">' + setNotes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>');
    }
  }
  el.appendChild(body);
  return el;
}

/* ---- filters (toggle hidden, never re-render) ---- */

function applyFilters(state) {
  document.querySelectorAll('.lb-rev').forEach((el) => {
    const winnerOk = !state.winner || (el.dataset.winners || '').split(' ').includes(state.winner);
    el.hidden = !winnerOk;
  });
  // Hide empty date groups, but keep season headers visible with an
  // updated applicable-revolution count ("3 of 12 revolutions").
  document.querySelectorAll('.lb-day').forEach((g) => {
    g.hidden = !g.querySelector('.lb-rev:not([hidden])');
  });
  document.querySelectorAll('.lb-season-group').forEach((g) => {
    const total = g.querySelectorAll('.lb-rev').length;
    const visible = g.querySelectorAll('.lb-rev:not([hidden])').length;
    const meta = g.querySelector('.lb-season-meta');
    if (meta) {
      const word = total === 1 ? 'revolution' : 'revolutions';
      meta.textContent = state.winner ? visible + ' of ' + total + ' ' + word : total + ' ' + word;
    }
  });
}

function renderFilters(data, state) {
  const el = document.getElementById('lb-filters');
  el.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lb-seg-item' + (state.winner === val ? ' is-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      state.winner = val;
      el.querySelectorAll('.lb-seg-item').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      applyFilters(state);
    });
    return b;
  };
  const group = document.createElement('span');
  group.className = 'lb-seg lb-seg--sub';
  group.appendChild(mk('All', null));
  for (const p of PLAYER_ORDER) group.appendChild(mk(playerName(data, p), p));
  el.appendChild(group);
}

/* ---- page assembly ---- */

function render(data) {
  const container = document.getElementById('lb-history');
  container.innerHTML = '';

  const matchesByRev = {};
  for (const m of data.matches) (matchesByRev[m.revId] ??= []).push(m);
  for (const k of Object.keys(matchesByRev)) matchesByRev[k].sort((a, b) => a.setNo - b.setNo);

  // newest first; grouped season -> date
  const revs = [...data.revolutions].reverse();
  const seasonGroups = new Map();
  for (const r of revs) {
    if (!seasonGroups.has(r.season)) seasonGroups.set(r.season, []);
    seasonGroups.get(r.season).push(r);
  }

  for (const [season, list] of seasonGroups) {
    const sg = document.createElement('section');
    sg.className = 'lb-season-group';
    const revWord = list.length === 1 ? 'revolution' : 'revolutions';
    sg.innerHTML = '<h2 class="lb-season-h">Season ' + season + ' <span class="lb-season-meta">' + list.length + ' ' + revWord + '</span></h2>';

    // collapse past seasons by default (unless a hash targets them)
    const wrap = document.createElement('div');

    let currentDay = null, dayEl = null;
    for (const rev of list) {
      const key = fmtDate(rev.date) || 'Undated';
      if (key !== currentDay) {
        currentDay = key;
        dayEl = document.createElement('div');
        dayEl.className = 'lb-day';
        dayEl.innerHTML = '<h3 class="lb-day-h">' + esc(key) + '</h3>';
        wrap.appendChild(dayEl);
      }
      dayEl.appendChild(buildRevNode(data, rev, matchesByRev[rev.id] || []));
    }
    sg.appendChild(wrap);
    container.appendChild(sg);
  }
}

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const el = document.getElementById(id);
  if (!el || !el.classList.contains('lb-rev')) return;
  el.open = true;
  el.scrollIntoView({ block: 'start' });
}

loadData().then((data) => {
  renderMeta(data);
  render(data);
  const state = { winner: null };
  renderFilters(data, state);
  showMain();
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
}).catch(showError);
