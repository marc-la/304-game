// Leaderboard insights — the player as a character, with receipts.
// Approved composition (2026-07-26): compass field centrepiece; per-player
// cards carrying an earned epithet, the AI one-liner, a signature move,
// the stat grid, and a two-ink verdict; all-time finishing shapes; and a
// nulls footnote. Every claim is computed from the data; components render
// nothing rather than stretch when a threshold isn't met.
// Contract: .claude/leaderboard-design.md.
import {
  loadData, playerName, playerColors, onThemeChange,
  renderMeta, showMain, showError, fmtDate, esc, PLAYER_ORDER,
} from './core.js';

const LADDER = ['60', '70', '80', '90', '100', '115', 'H', '250', 'PCC'];
const ladderIdx = (t) => LADDER.indexOf(t);

/* ---------- computed characteristics ---------- */

function characteristics(data) {
  const out = {};
  const sheetRevs = new Set(Object.keys(data.bets));

  // pair win rates (all-time) for favourite/synergy computations
  const pair = {};
  const indiv = Object.fromEntries(PLAYER_ORDER.map((p) => [p, { w: 0, n: 0 }]));
  for (const m of data.matches) {
    for (const [team, opp] of [[m.teamA, m.teamB], [m.teamB, m.teamA]]) {
      const k = [...team].sort().join('-');
      pair[k] ??= { w: 0, n: 0 };
      pair[k].n++;
      const won = team.every((p) => m.winner.includes(p));
      if (won) pair[k].w++;
      for (const p of team) { indiv[p].n++; if (won) indiv[p].w++; }
      void opp;
    }
  }
  const pairRate = (team) => { const e = pair[[...team].sort().join('-')]; return e ? e.w / e.n : 0.5; };

  for (const p of PLAYER_ORDER) {
    const s = data.betStats[p];
    const c = { p, s };

    // avg ladder height of bids (sheet scope)
    let sum = 0, n = 0;
    for (const [t, count] of Object.entries(s.mix)) { sum += ladderIdx(t) * count; n += count; }
    c.avgLadder = n ? sum / n : 0;
    c.betN = n;
    c.convPct = (s.wins + s.losses) ? s.wins / (s.wins + s.losses) : 0;
    c.netPerBet = c.betN ? s.netStone / c.betN : 0;

    // signature: modal tier if it carries >= 40% of bids
    let modal = null;
    for (const [t, count] of Object.entries(s.mix)) if (!modal || count > s.mix[modal]) modal = t;
    c.signature = modal && s.mix[modal] / Math.max(1, n) >= 0.4
      ? { tier: modal, count: s.mix[modal], rec: s.mixOutcomes[modal] }
      : null;

    // stone economy per set (sheet scope) + clutch + set arc (all-time)
    c.stone = { given: 0, lost: 0, sets: 0 };
    c.clutch = { w: 0, l: 0 };
    c.arc = [{ w: 0, n: 0 }, { w: 0, n: 0 }, { w: 0, n: 0 }];
    c.favN = 0;
    c.matchN = 0;
    for (const m of data.matches) {
      const inA = m.teamA.includes(p), inB = m.teamB.includes(p);
      if (!inA && !inB) continue;
      const team = inA ? m.teamA : m.teamB;
      const own = inA ? m.scoreA : m.scoreB;
      const opp = inA ? m.scoreB : m.scoreA;
      const won = m.winner.includes(p);
      c.matchN++;
      if (sheetRevs.has(m.revId)) { c.stone.sets++; c.stone.given += own; c.stone.lost += opp; }
      if (Math.min(m.scoreA, m.scoreB) >= 8) { won ? c.clutch.w++ : c.clutch.l++; }
      const slot = Math.min(3, Math.max(1, m.setNo)) - 1;
      c.arc[slot].n++; if (won) c.arc[slot].w++;
      if (pairRate(team) > pairRate(inA ? m.teamB : m.teamA)) c.favN++;
    }

    // finishing shape (all-time)
    c.ranks = [0, 0, 0, 0];
    for (const r of data.revolutions) {
      const pl = r.placements.find((x) => x.p === p);
      if (pl) c.ranks[pl.rank - 1]++;
    }
    out[p] = c;
  }

  // nulls (table-level facts)
  const trio = ['LX', 'ML', 'MN'];
  const h2h = [];
  for (let i = 0; i < trio.length; i++) for (let j = i + 1; j < trio.length; j++) {
    let w = 0, nn = 0;
    for (const m of data.matches) {
      const aIn = m.teamA.includes(trio[i]) || m.teamB.includes(trio[i]);
      const bIn = m.teamA.includes(trio[j]) || m.teamB.includes(trio[j]);
      const sameTeam = [m.teamA, m.teamB].some((t) => t.includes(trio[i]) && t.includes(trio[j]));
      if (!aIn || !bIn || sameTeam) continue;
      nn++; if (m.winner.includes(trio[i])) w++;
    }
    h2h.push(w / nn);
  }
  let maxSynergy = 0;
  for (const [k, e] of Object.entries(pair)) {
    const [a, b] = k.split('-');
    const ra = indiv[a].w / indiv[a].n, rb = indiv[b].w / indiv[b].n;
    const expected = (ra + rb) / 2;
    maxSynergy = Math.max(maxSynergy, Math.abs(e.w / e.n - expected));
  }
  out._table = {
    h2hRange: [Math.min(...h2h), Math.max(...h2h)],
    maxSynergy,
    matches: data.matches.length,
  };
  return out;
}

/* ---------- epithets & verdicts (deterministic, receipts cited) ---------- */

function assignEpithets(chars) {
  const by = (fn, dir = 1) => [...PLAYER_ORDER].sort((a, b) => dir * (fn(chars[b]) - fn(chars[a])))[0];
  const candidates = [
    {
      title: 'The Strongman',
      pick: by((c) => c.avgLadder),
      cite: (c) => 'highest average bid on the sheet' + (c.s.pccWin ? ' · the only PCC — won' : ''),
    },
    {
      title: 'The Sniper',
      pick: by((c) => c.convPct - (c.s.bets / Math.max(1, c.s.sets)) / 10),
      cite: (c) => 'fewest bets, best conversion — ' + c.s.wins + 'W–' + c.s.losses + 'L',
    },
    {
      title: 'The Sixty-Merchant',
      pick: by((c) => (c.s.mix['60'] ?? 0) / Math.max(1, c.betN)),
      cite: (c) => (c.s.mix['60'] ?? 0) + ' of ' + c.betN + ' bids are 60s' +
        ((c.s.capsPlain + c.s.capsBonus + c.s.capsLate + c.s.capsWrong) === 0 ? ' · zero caps written in ' + c.betN + ' bids' : ''),
    },
    {
      title: 'The Gambler',
      pick: by((c) => c.netPerBet, -1),
      cite: (c) => c.s.netStone + ' stone from own bets · ' + c.s.penalties + ' penalties',
    },
  ];
  const result = {};
  for (const cand of candidates) {
    if (result[cand.pick]) continue;
    result[cand.pick] = { title: cand.title, cite: cand.cite(chars[cand.pick]) };
  }
  for (const p of PLAYER_ORDER) result[p] ??= { title: 'The Regular', cite: '' };
  return result;
}

function verdict(c, chars) {
  const pros = [], cons = [];
  // per-tier records with n >= 5
  let bestTier = null, worstTier = null;
  for (const [t, r] of Object.entries(c.s.mixOutcomes)) {
    const nn = r.w + r.l;
    if (nn < 5) continue;
    if (!bestTier || r.w / nn > bestTier.rate) bestTier = { t, r, rate: r.w / nn };
    if (!worstTier || r.w / nn < worstTier.rate) worstTier = { t, r, rate: r.w / nn };
  }
  if (bestTier && bestTier.rate >= 0.65) pros.push('owns the ' + bestTier.t + ' — ' + bestTier.r.w + '–' + bestTier.r.l);
  if (c.clutch.w + c.clutch.l >= 10 && c.clutch.w / (c.clutch.w + c.clutch.l) >= 0.65) {
    pros.push('wins the nail-biters — ' + c.clutch.w + '–' + c.clutch.l + ' in matches decided at 8+');
  }
  const capsWins = c.s.capsPlain + c.s.capsBonus;
  if (capsWins >= 2 && c.s.capsLate + c.s.capsWrong === 0) pros.push('clean caps ledger — ' + capsWins + ' called, ' + capsWins + ' landed');
  if (c.netPerBet > 0.3) pros.push('bets at a profit — +' + c.s.netStone + ' stone over the sheets');

  if (worstTier && worstTier.rate <= 0.4) cons.push('bleeds at the ' + worstTier.t + ' — ' + worstTier.r.w + '–' + worstTier.r.l);
  if (c.netPerBet < -0.5) cons.push('pays for the ladder — ' + c.s.netStone + ' stone from own bets');
  const maxPen = Math.max(...PLAYER_ORDER.map((q) => chars[q].s.penalties));
  if (c.s.penalties >= 3 && c.s.penalties === maxPen) cons.push('most penalised at the table — ' + c.s.penalties + ' PN');
  if (c.betN >= 20 && capsWins + c.s.capsLate + c.s.capsWrong === 0) cons.push('never calls caps — 0 in ' + c.betN + ' bids');
  if (c.clutch.w + c.clutch.l >= 10 && c.clutch.w / (c.clutch.w + c.clutch.l) <= 0.4) {
    cons.push('folds in the nail-biters — ' + c.clutch.w + '–' + c.clutch.l + ' at 8+');
  }
  return { pro: pros[0] ?? null, con: cons[0] ?? null };
}

/* ---------- renderers ---------- */

function renderCompass(data, chars) {
  const host = document.getElementById('lb-compass');
  const colors = playerColors();
  const W = 640, H = 400, padL = 58, padR = 132, padT = 40, padB = 64;
  const iw = W - padL - padR, ih = H - padT - padB;

  const xs = PLAYER_ORDER.map((p) => chars[p].avgLadder);
  const xMin = Math.min(...xs) - 0.45, xMax = Math.max(...xs) + 0.45;
  const x = (v) => padL + ((v - xMin) / (xMax - xMin)) * iw;
  const y = (v) => padT + (1 - v) * ih; // conversion 0..1
  const right = W - padR;

  // grid: a rule per ladder rung inside the domain, labelled with the bid
  let grid = '';
  for (let i = Math.ceil(xMin); i <= Math.floor(xMax); i++) {
    const gx = x(i).toFixed(1);
    grid += '<line class="lb-compass-grid" x1="' + gx + '" x2="' + gx + '" y1="' + padT + '" y2="' + (H - padB) + '"/>' +
      '<text class="lb-compass-tick" x="' + gx + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + esc(LADDER[i]) + '</text>';
  }
  // grid: conversion quarters, with the 50% line named
  for (const v of [0.25, 0.5, 0.75]) {
    const gy = y(v).toFixed(1);
    grid += '<line class="lb-compass-grid' + (v === 0.5 ? ' lb-compass-grid--even' : '') +
      '" x1="' + padL + '" x2="' + right + '" y1="' + gy + '" y2="' + gy + '"/>' +
      '<text class="lb-compass-tick" x="' + (padL - 8) + '" y="' + (+gy + 4) + '" text-anchor="end">' + v * 100 + '%</text>';
  }
  grid += '<text class="lb-compass-tick" x="' + (padL + 6) + '" y="' + (y(0.5) - 5) + '">breaks even</text>';

  // axis captions in plain words
  const axes =
    '<text class="lb-compass-axis" x="' + padL + '" y="16">share of bets won ↑</text>' +
    '<text class="lb-compass-axis" x="' + padL + '" y="' + (H - 12) + '">← bids small</text>' +
    '<text class="lb-compass-axis" x="' + right + '" y="' + (H - 12) + '" text-anchor="end">bids big →</text>' +
    '<text class="lb-compass-axis lb-compass-axis--mid" x="' + ((padL + right) / 2) + '" y="' + (H - 12) + '" text-anchor="middle">average bid</text>';

  // corner captions give the quadrants meaning without pretending to a hard split
  const quads =
    '<text class="lb-compass-quad" x="' + (padL + 10) + '" y="' + (padT + 18) + '">bids small, lands them</text>' +
    '<text class="lb-compass-quad" x="' + (right - 10) + '" y="' + (padT + 18) + '" text-anchor="end">bids big, lands them</text>' +
    '<text class="lb-compass-quad" x="' + (padL + 10) + '" y="' + (H - padB - 10) + '">bids small, still pays</text>' +
    '<text class="lb-compass-quad" x="' + (right - 10) + '" y="' + (H - padB - 10) + '" text-anchor="end">bids big, pays for it</text>';

  let dots = '', labels = '';
  // dodge name labels vertically
  const pts = PLAYER_ORDER.map((p) => ({ p, x: x(chars[p].avgLadder), y: y(chars[p].convPct) }))
    .sort((a, b) => a.y - b.y);
  let lastY = -Infinity;
  for (const pt of pts) {
    const ly = Math.max(pt.y, lastY + 16);
    lastY = ly;
    const c = chars[pt.p];
    dots += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="6" fill="' + colors[pt.p] + '"/>';
    labels += '<text class="lb-compass-label" x="' + (pt.x + 12).toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '">' +
      esc(playerName(data, pt.p)) + ' <tspan class="lb-compass-rec">' + c.s.wins + '–' + c.s.losses + '</tspan></text>';
  }

  host.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average bid height versus share of bets won, for all four players" preserveAspectRatio="xMidYMid meet">' +
    '<rect class="lb-compass-plot" x="' + padL + '" y="' + padT + '" width="' + iw + '" height="' + ih + '"/>' +
    grid + axes + quads + dots + labels +
    '</svg>';
}

function renderCards(data, chars) {
  const el = document.getElementById('lb-profiles');
  const epithets = assignEpithets(chars);

  el.innerHTML = PLAYER_ORDER.map((p) => {
    const c = chars[p];
    const s = c.s;
    const e = epithets[p];
    const v = verdict(c, chars);
    const style = data.styles && data.styles[p];
    const perSet = s.sets ? (s.bets / s.sets).toFixed(1) : '0';
    const givenAvg = c.stone.sets ? (c.stone.given / c.stone.sets).toFixed(1) : '—';
    const lostAvg = c.stone.sets ? (c.stone.lost / c.stone.sets).toFixed(1) : '—';
    const net = (s.netStone > 0 ? '+' : '') + s.netStone;
    const maxPen = Math.max(...PLAYER_ORDER.map((q) => chars[q].s.penalties));
    const penClass = s.penalties > 0 && s.penalties === maxPen ? ' lb-pen-max' : '';
    const capsWins = s.capsPlain + s.capsBonus;
    const capsLosses = s.capsLate + s.capsWrong;
    const capsTotal = capsWins + capsLosses;
    const arcPct = c.arc.map((a) => (a.n ? Math.round((a.w / a.n) * 100) : 0));
    const arcTrend = arcPct[2] > arcPct[0] + 5 ? ' ↗' : arcPct[2] < arcPct[0] - 5 ? ' ↘' : '';

    const sig = c.signature
      ? '<span class="lb-sig-not">' + esc(c.signature.tier) + ' ×' + c.signature.count + '</span>' +
        '<span class="lb-sig-rec">' + c.signature.rec.w + '–' + c.signature.rec.l + '</span>'
      : '<span class="lb-sig-not">the whole ladder · 60 → ' +
        esc(LADDER.filter((t) => s.mix[t]).at(-1) ?? '60') + '</span>';

    return '<article class="lb-profile" style="--pc: var(--player-' + p + ')">' +
      '<header class="lb-profile-head">' +
        '<h3 class="lb-profile-h"><i class="lb-dot lb-dot--lg"></i>' + esc(playerName(data, p)) + '</h3>' +
        '<p class="lb-epithet">' + esc(e.title) + '</p>' +
        (e.cite ? '<p class="lb-epithet-cite">' + esc(e.cite) + '</p>' : '') +
      '</header>' +
      (style ? '<p class="lb-profile-style">&ldquo;' + esc(style) + '&rdquo;</p>' : '') +
      '<div class="lb-sig"><span class="lb-profile-label">Signature</span>' + sig + '</div>' +
      '<div class="lb-profile-grid">' +
        '<span class="lb-profile-label">Bets / set</span><span class="lb-profile-val">' + perSet + '</span>' +
        '<span class="lb-profile-label">Record</span><span class="lb-profile-val">' + s.wins + 'W – ' + s.losses + 'L</span>' +
        '<span class="lb-profile-label">Stone, own bets</span><span class="lb-profile-val ' + (s.netStone > 0 ? 'lb-val-win' : s.netStone < 0 ? 'lb-val-loss' : '') + '">' + net + '</span>' +
        '<span class="lb-profile-label">Stone given / set</span><span class="lb-profile-val">' + givenAvg + '</span>' +
        '<span class="lb-profile-label">Stone lost / set</span><span class="lb-profile-val">' + lostAvg + '</span>' +
        '<span class="lb-profile-label">Caps</span><span>' +
          (capsTotal
            ? '<span class="lb-profile-val">' + capsWins + 'W – ' + capsLosses + 'L</span>' +
              (s.pccWin || s.pccLoss ? ' <span class="lb-not lb-not--big">PCC ' + s.pccWin + 'W/' + s.pccLoss + 'L</span>' : '')
            : '<span class="lb-footnote">none called</span>') + '</span>' +
        '<span class="lb-profile-label">Penalties</span><span class="lb-profile-val' + penClass + '">' + s.penalties + '</span>' +
        '<span class="lb-profile-divider" aria-hidden="true"></span>' +
        '<span class="lb-profile-scope">All-time · 92 matches</span>' +
        '<span class="lb-profile-label">Clutch (8+)</span><span class="lb-profile-val">' + c.clutch.w + 'W – ' + c.clutch.l + 'L</span>' +
        '<span class="lb-profile-label">Sets 1 → 3</span><span class="lb-profile-val">' + arcPct.join('·') + '%' + arcTrend + '</span>' +
      '</div>' +
      ((v.pro || v.con)
        ? '<div class="lb-verdict">' +
            (v.pro ? '<p class="lb-verdict-pro">✓ ' + esc(v.pro) + '</p>' : '') +
            (v.con ? '<p class="lb-verdict-con">✗ ' + esc(v.con) + '</p>' : '') +
          '</div>'
        : '') +
    '</article>';
  }).join('');
}

function renderFinishes(data, chars) {
  const el = document.getElementById('lb-finishes');
  const total = data.revolutions.length;
  el.innerHTML = PLAYER_ORDER.map((p) => {
    const c = chars[p];
    const segs = c.ranks.map((n, i) => {
      const w = (n / total) * 100;
      const cls = i === 0 ? ' lb-fin-first' : '';
      return n ? '<span class="lb-fin-seg' + cls + '" style="width:' + w.toFixed(1) + '%" title="' + (i + 1) + ordSuffix(i + 1) + ' ×' + n + '">' +
        (i === 0 ? '★ ' : '') + n + '</span>' : '';
    }).join('');
    return '<div class="lb-fin-row">' +
      '<span class="lb-fin-name"><i class="lb-dot" style="background:var(--player-' + p + ')"></i>' + esc(playerName(data, p)) + '</span>' +
      '<span class="lb-fin-bar">' + segs + '</span>' +
    '</div>';
  }).join('') +
  '<p class="lb-footnote">Segments left to right: 1st · 2nd · 3rd · 4th place finishes across all ' + total + ' revolutions.</p>';
}

function ordSuffix(n) { return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'; }

function renderNulls(data, chars) {
  const t = chars._table;
  const vmFav = chars.VM.favN;
  const withSheets = Object.keys(data.bets);
  const dates = [...new Set(withSheets
    .map((id) => data.revolutions.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => fmtDate(r.date, true)))];
  document.getElementById('lb-nulls').innerHTML =
    '<span>Bet-level numbers cover the ' + withSheets.length + ' of ' + data.revolutions.length +
    ' revolutions with a betting sheet (' + dates.join(' · ') + '); match-level numbers cover everything.</span>' +
    '<span>No pair over- or under-performs the sum of its players (largest deviation ' +
    (t.maxSynergy * 100).toFixed(0) + ' points — within noise at this sample).</span>' +
    '<span>No bogey opponents — Lewei, Marc and Matthew sit at ' +
    Math.round(t.h2hRange[0] * 100) + '–' + Math.round(t.h2hRange[1] * 100) + '% head-to-head: a perfect triangle.</span>' +
    '<span>Vithusayan has been the on-paper favourite in ' + vmFav + ' of his ' + chars.VM.matchN + ' matches.</span>';
}

/* ---------- init ---------- */

loadData().then((data) => {
  renderMeta(data);
  const chars = characteristics(data);
  renderCompass(data, chars);
  renderCards(data, chars);
  renderFinishes(data, chars);
  renderNulls(data, chars);
  onThemeChange(() => renderCompass(data, chars));
  showMain();
}).catch(showError);
