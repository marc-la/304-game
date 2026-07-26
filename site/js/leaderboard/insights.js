// Leaderboard insights: betting-sheet-resolution player profiles.
// Focus: the players as the central object — how each of them plays.
// Coverage honesty is the governing rule — everything on this page counts
// only the revolutions that have a betting sheet, and says so.
// Contract: .claude/leaderboard-design.md §2, §5.
import {
  loadData, playerName, renderMeta, showMain, showError, fmtDate, esc, PLAYER_ORDER,
} from './core.js';

const TIERS = ['60', '70', '80', '90', '100', '115', 'H', '250', 'PCC'];

function coverageBanner(data) {
  const withSheets = Object.keys(data.bets);
  const el = document.getElementById('lb-coverage');
  const dates = withSheets
    .map((id) => data.revolutions.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => fmtDate(r.date, true));
  el.innerHTML = '<strong>Betting-sheet resolution:</strong> ' + withSheets.length + ' of ' +
    data.revolutions.length + ' revolutions have a sheet (' + [...new Set(dates)].join(' · ') + ').';
}

/* Stone economy per player, scoped to the revolutions that have a sheet.
   A match score is stone given by that team, so per set:
   given = own team's score, lost = opponents' score. */
function stoneStats(data) {
  const sheetRevs = new Set(Object.keys(data.bets));
  const out = Object.fromEntries(PLAYER_ORDER.map((p) => [p, { given: 0, lost: 0, sets: 0 }]));
  for (const m of data.matches) {
    if (!sheetRevs.has(m.revId)) continue;
    for (const p of PLAYER_ORDER) {
      const inA = m.teamA.includes(p), inB = m.teamB.includes(p);
      if (!inA && !inB) continue;
      const s = out[p];
      s.sets++;
      s.given += inA ? m.scoreA : m.scoreB;
      s.lost += inA ? m.scoreB : m.scoreA;
    }
  }
  return out;
}

function mixCounts(mix) {
  const parts = TIERS.filter((t) => mix[t]).map((t) =>
    '<span class="lb-mix-item"><strong>' + t + '</strong>×' + mix[t] + '</span>');
  return parts.length ? parts.join('') : '<span class="lb-footnote">no bets recorded</span>';
}

function capsLine(s) {
  const total = s.capsPlain + s.capsBonus + s.capsLate + s.capsWrong;
  if (!total) return '<span class="lb-footnote">no caps calls</span>';
  const wins = s.capsPlain + s.capsBonus;
  const losses = s.capsLate + s.capsWrong;
  const bits = [];
  if (s.capsBonus) bits.push('<span class="lb-not lb-not--win" title="Correct Caps before R7 (+1 stone)">+1×' + s.capsBonus + '</span>');
  if (s.capsPlain) bits.push('<span class="lb-not lb-not--win" title="Correct Caps, no bonus">+0×' + s.capsPlain + '</span>');
  if (s.capsLate) bits.push('<span class="lb-not lb-not--loss" title="Late Caps">−L×' + s.capsLate + '</span>');
  if (s.capsWrong) bits.push('<span class="lb-not lb-not--loss" title="Wrong Caps (5 stone)">−W×' + s.capsWrong + '</span>');
  return '<span class="lb-caps-line"><span class="lb-profile-val">' + wins + 'W – ' + losses + 'L</span>' + bits.join('') + '</span>';
}

function renderProfiles(data) {
  const el = document.getElementById('lb-profiles');
  const stone = stoneStats(data);
  const maxPenalties = Math.max(...PLAYER_ORDER.map((p) => data.betStats[p].penalties));

  el.innerHTML = PLAYER_ORDER.map((p) => {
    const s = data.betStats[p];
    const st = stone[p];
    const perSet = s.sets ? (s.bets / s.sets).toFixed(1) : '0';
    const givenAvg = st.sets ? (st.given / st.sets).toFixed(1) : '—';
    const lostAvg = st.sets ? (st.lost / st.sets).toFixed(1) : '—';
    const style = data.styles && data.styles[p];
    const pcc = (s.pccWin || s.pccLoss)
      ? ' <span class="lb-not lb-not--big" title="Partner Closed Caps record">PCC ' + s.pccWin + 'W/' + s.pccLoss + 'L</span>' : '';
    const penClass = s.penalties > 0 && s.penalties === maxPenalties ? ' lb-pen-max' : '';
    return '<article class="lb-profile" style="--pc: var(--player-' + p + ')">' +
      '<h3 class="lb-profile-h"><i class="lb-dot lb-dot--lg"></i>' + esc(playerName(data, p)) + '</h3>' +
      (style ? '<p class="lb-profile-style">&ldquo;' + esc(style) + '&rdquo;</p>' : '') +
      '<div class="lb-profile-grid">' +
        '<span class="lb-profile-label">Bets / set</span><span class="lb-profile-val">' + perSet + '</span>' +
        '<span class="lb-profile-label">Record</span><span class="lb-profile-val">' + s.wins + 'W – ' + s.losses + 'L</span>' +
        '<span class="lb-profile-label">Stone given / set</span><span class="lb-profile-val">' + givenAvg + ' <span class="lb-profile-sub">(' + st.given + ' total)</span></span>' +
        '<span class="lb-profile-label">Stone lost / set</span><span class="lb-profile-val">' + lostAvg + ' <span class="lb-profile-sub">(' + st.lost + ' total)</span></span>' +
        '<span class="lb-profile-label">Bid mix</span><span class="lb-mix-counts">' + mixCounts(s.mix) + '</span>' +
        '<span class="lb-profile-label">Caps</span><span>' + capsLine(s) + pcc + '</span>' +
        '<span class="lb-profile-label">Penalties</span><span class="lb-profile-val' + penClass + '">' + s.penalties + '</span>' +
      '</div>' +
    '</article>';
  }).join('');
}

loadData().then((data) => {
  renderMeta(data);
  coverageBanner(data);
  renderProfiles(data);
  showMain();
}).catch(showError);
