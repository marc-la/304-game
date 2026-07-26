// Leaderboard insights: betting-sheet-resolution profiles, stone ledger,
// event log. Coverage honesty is the governing rule here — everything on this
// page is scoped to the revolutions that have a betting CSV, and says so.
// Contract: .claude/leaderboard-design.md §2, §5.
import {
  loadData, playerName, renderMeta, showMain, showError, fmtDate, esc, PLAYER_ORDER,
} from './core.js';

/* Bid-ladder order for the mix bar; single-hue sequential ramp (darker = higher
   tier = more aggressive), per the ordered-scale colour rule. */
const TIERS = ['60', '70', '80', '90', '100', '115', 'H', '250', 'PCC'];
const RAMP = ['#d9b98a', '#cda76e', '#c09453', '#b3823a', '#a56f24', '#985e0f', '#7c4a08', '#5f3705', '#422503'];

function coverageBanner(data) {
  const withSheets = Object.keys(data.bets);
  const el = document.getElementById('lb-coverage');
  const dates = withSheets
    .map((id) => data.revolutions.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => fmtDate(r.date, true));
  el.innerHTML = '<strong>Betting-sheet resolution:</strong> ' + withSheets.length + ' of ' +
    data.revolutions.length + ' revolutions have a sheet (' + [...new Set(dates)].join(' · ') +
    '). Everything on this page counts only those revolutions — counts, not percentages, while the sample is small.';
}

function mixBar(mix) {
  const total = TIERS.reduce((s, t) => s + (mix[t] || 0), 0);
  if (!total) return '<span class="lb-footnote">no bets recorded</span>';
  let html = '<span class="lb-mix" role="img" aria-label="Bid mix by tier">';
  TIERS.forEach((t, i) => {
    const n = mix[t] || 0;
    if (!n) return;
    const pct = (n / total) * 100;
    html += '<span class="lb-mix-seg" style="width:' + pct.toFixed(1) + '%;background:' + RAMP[i] + '" title="' + t + ' × ' + n + '"></span>';
  });
  html += '</span>';
  return html;
}

function mixLegend() {
  return '<div class="lb-mix-legend">' + TIERS.map((t, i) =>
    '<span><i style="background:' + RAMP[i] + '"></i>' + t + '</span>').join('') + '</div>';
}

function capsLedger(s) {
  const total = s.capsPlain + s.capsBonus + s.capsLate + s.capsWrong;
  if (!total) return '<span class="lb-footnote">no caps calls</span>';
  const bit = (n, label, cls, title) => n
    ? '<span class="lb-caps-bit ' + cls + '" title="' + title + '">' + label + '×' + n + '</span>' : '';
  return bit(s.capsBonus, '+1', 'lb-not--win', 'Correct Caps before R7 (+1 stone)') +
    bit(s.capsPlain, '+0', 'lb-not--win', 'Correct Caps, no bonus') +
    bit(s.capsLate, '−L', 'lb-not--loss', 'Late Caps') +
    bit(s.capsWrong, '−W', 'lb-not--loss', 'Wrong Caps (5 stone)');
}

function renderProfiles(data) {
  const el = document.getElementById('lb-profiles');
  el.innerHTML = PLAYER_ORDER.map((p) => {
    const s = data.betStats[p];
    const perSet = s.sets ? (s.bets / s.sets).toFixed(1) : '0';
    const style = data.styles && data.styles[p];
    const pcc = (s.pccWin || s.pccLoss)
      ? '<span class="lb-caps-bit lb-not--big">PCC ' + s.pccWin + 'W/' + s.pccLoss + 'L</span>' : '';
    return '<article class="lb-profile" style="--pc: var(--player-' + p + ')">' +
      '<h3 class="lb-profile-h"><i class="lb-dot lb-dot--lg"></i>' + esc(playerName(data, p)) + '</h3>' +
      (style ? '<p class="lb-profile-style">&ldquo;' + esc(style) + '&rdquo;</p>' : '') +
      '<div class="lb-profile-grid">' +
        '<span class="lb-profile-label">Bets / set</span><span class="lb-profile-val">' + perSet + '</span>' +
        '<span class="lb-profile-label">Record</span><span class="lb-profile-val">' + s.wins + 'W – ' + s.losses + 'L</span>' +
        '<span class="lb-profile-label">Bid mix</span><span>' + mixBar(s.mix) + '</span>' +
        '<span class="lb-profile-label">Caps</span><span>' + capsLedger(s) + ' ' + pcc + '</span>' +
        '<span class="lb-profile-label">Penalties</span><span class="lb-profile-val">' + (s.penalties || '0') + '</span>' +
      '</div>' +
    '</article>';
  }).join('');
  document.getElementById('lb-mix-legend').innerHTML = mixLegend();
}

function renderStoneLedger(data) {
  const el = document.getElementById('lb-stone');
  const revIds = Object.keys(data.bets);
  if (!revIds.length) { el.innerHTML = ''; return; }
  const revs = revIds.map((id) => data.revolutions.find((r) => r.id === id)).filter(Boolean);
  const maxStone = Math.max(1, ...revs.flatMap((r) => PLAYER_ORDER.map((p) => r.results[p].s)));
  el.innerHTML = revs.map((r) => {
    const rows = PLAYER_ORDER.map((p) => {
      const stone = r.results[p].s;
      const w = (stone / maxStone) * 100;
      return '<div class="lb-stone-row">' +
        '<span class="lb-stone-name"><i class="lb-dot" style="background:var(--player-' + p + ')"></i>' + esc(playerName(data, p)) + '</span>' +
        '<span class="lb-bar lb-stone-bar"><span class="lb-bar-fill" style="width:' + w.toFixed(0) + '%;background:var(--player-' + p + ')"></span></span>' +
        '<span class="lb-stone-val">' + stone + '</span>' +
      '</div>';
    }).join('');
    return '<div class="lb-stone-rev">' +
      '<h4 class="lb-stone-h"><a href="leaderboard-history.html#' + r.id + '">' + esc(fmtDate(r.date, true)) + ' · rev ' + r.num + '</a></h4>' + rows +
    '</div>';
  }).join('');
}

const EVENT_LABEL = {
  'pcc-win': 'Partner Closed Caps — won',
  'pcc-loss': 'Partner Closed Caps — lost',
  'caps-wrong': 'Wrong Caps (5 stone)',
  'caps-late': 'Late Caps',
  'caps-win': 'Caps called and won',
  'bet-win': 'big bet won',
  'bet-loss': 'big bet lost',
};

function renderEvents(data) {
  const el = document.getElementById('lb-events');
  if (!data.eventLog.length) { el.innerHTML = '<p class="lb-footnote">Nothing notable yet.</p>'; return; }
  const items = [...data.eventLog].reverse().map((e) => {
    const label = EVENT_LABEL[e.type] || e.type;
    return '<li class="lb-event">' +
      '<span class="lb-event-date"><a href="leaderboard-history.html#' + e.revId + '">' + esc(fmtDate(e.date, true)) + '</a> · set ' + e.setNo + '</span>' +
      '<span class="lb-event-who"><i class="lb-dot" style="background:var(--player-' + e.player + ')"></i>' + esc(playerName(data, e.player)) + '</span>' +
      '<span class="lb-event-tok">' + esc(e.token) + '</span>' +
      '<span class="lb-event-label">' + esc(label) + '</span>' +
    '</li>';
  }).join('');
  el.innerHTML = '<ul class="lb-event-list">' + items + '</ul>';
}

loadData().then((data) => {
  renderMeta(data);
  coverageBanner(data);
  renderProfiles(data);
  renderStoneLedger(data);
  renderEvents(data);
  showMain();
}).catch(showError);
