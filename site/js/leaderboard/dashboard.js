// Leaderboard dashboard: standings, the race chart, partnership list.
// No-scroll contract + component rules: .claude/leaderboard-design.md §1, §5.
import {
  loadData, standings, partnerships, playerName, playerColors, onThemeChange,
  renderMeta, showMain, showError, seasonToggle, fmtDate, esc, PLAYER_ORDER,
} from './core.js';

function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
}

/* ---- standings ledger ---- */

function renderStandings(data, scope) {
  const el = document.getElementById('lb-standings');
  const rows = standings(data, scope);
  const maxRevs = Math.max(1, ...rows.map((r) => r.revsWon));
  el.innerHTML = rows.map((r, i) => {
    const pips = r.form.map((f) => {
      if (!f) return '';
      const cls = f.win ? ' is-win' : '';
      const label = f.tied ? 'Tied 1st' : ordinal(f.rank);
      return '<span class="lb-pip' + cls + '" title="' + label + '">' + (f.tied ? 'T' : f.rank) + '</span>';
    }).join('');
    return (
      '<div class="lb-standing" style="--pc: var(--player-' + r.p + ')">' +
        '<span class="lb-standing-rank">' + (i + 1) + '</span>' +
        '<span class="lb-standing-swatch" aria-hidden="true"></span>' +
        '<span class="lb-standing-name">' + esc(playerName(data, r.p)) + '</span>' +
        '<span class="lb-standing-revs"><strong>' + r.revsWon + '</strong><small>rev' + (r.revsWon === 1 ? '' : 's') + '</small></span>' +
        '<span class="lb-standing-rate">' +
          '<span class="lb-bar" role="img" aria-label="Match win rate ' + r.winRate + '%"><span class="lb-bar-fill" style="width:' + r.winRate + '%"></span></span>' +
          '<span class="lb-standing-pct">' + r.winRate + '%</span>' +
        '</span>' +
        '<span class="lb-standing-form" aria-label="Recent form, oldest first">' + pips + '</span>' +
      '</div>'
    );
  }).join('') +
  '<p class="lb-footnote">Ranked by revolutions won, then matches, then stone · form pips = last 5 placements, oldest left' +
  (scope === 'all' ? '' : ' · win rate within ' + (scope === 'all' ? '' : 'season ' + scope)) + '</p>';
  // Keep the max in reserve for future emphasis (leader detection).
  void maxRevs;
}

/* ---- the race chart (hand-rolled SVG, stepped) ---- */

function renderRace(data) {
  const host = document.getElementById('lb-race');
  const colors = playerColors();
  const revs = data.revolutions;
  const n = revs.length;
  if (!n) { host.innerHTML = ''; return; }

  // cumulative series
  const cum = {};
  PLAYER_ORDER.forEach((p) => { cum[p] = []; });
  const running = { LX: 0, ML: 0, MN: 0, VM: 0 };
  for (const r of revs) {
    for (const w of r.winners) running[w]++;
    for (const p of PLAYER_ORDER) cum[p].push(running[p]);
  }
  const maxY = Math.max(1, ...PLAYER_ORDER.map((p) => running[p]));

  const W = 640, H = 300, padL = 26, padR = 92, padT = 14, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - (v / maxY) * ih;

  // stepped path
  const path = (series) => {
    let d = 'M' + x(0).toFixed(1) + ' ' + y(series[0]).toFixed(1);
    for (let i = 1; i < n; i++) {
      d += ' H' + x(i).toFixed(1) + ' V' + y(series[i]).toFixed(1);
    }
    return d;
  };

  // horizontal gridlines at integer steps (sparse)
  const gridStep = maxY > 8 ? 2 : 1;
  let grid = '';
  for (let v = 0; v <= maxY; v += gridStep) {
    grid += '<line class="lb-race-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
      '<text class="lb-race-tick" x="' + (padL - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
  }

  // season dividers
  let dividers = '';
  for (let i = 1; i < n; i++) {
    if (revs[i].season !== revs[i - 1].season) {
      const xx = ((x(i) + x(i - 1)) / 2).toFixed(1);
      dividers += '<line class="lb-race-season" x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (padT + ih) + '"/>' +
        '<text class="lb-race-season-label" x="' + xx + '" y="' + (padT - 3) + '" text-anchor="middle">S' + revs[i].season + '</text>';
    }
  }

  // sparse x ticks: first rev of each month
  let xticks = '';
  let lastMonth = '';
  let lastTickX = -Infinity;
  for (let i = 0; i < n; i++) {
    const month = (revs[i].date || '').slice(0, 7);
    if (month && month !== lastMonth) {
      lastMonth = month;
      const tx = x(i);
      if (tx - lastTickX < 34) continue; // dodge label collisions
      lastTickX = tx;
      xticks += '<text class="lb-race-tick" x="' + tx.toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' +
        fmtDate(revs[i].date, true).replace(/^\d+ /, '') + '</text>';
    }
  }

  // lines + direct end labels with collision dodge
  const ends = PLAYER_ORDER.map((p) => ({ p, v: running[p], y: y(running[p]) }))
    .sort((a, b) => a.y - b.y);
  const MIN_GAP = 15;
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < MIN_GAP) ends[i].y = ends[i - 1].y + MIN_GAP;
  }
  let lines = '', labels = '';
  for (const p of PLAYER_ORDER) {
    lines += '<path class="lb-race-line" fill="none" d="' + path(cum[p]) + '" stroke="' + colors[p] + '"/>';
  }
  for (const e of ends) {
    labels += '<text class="lb-race-label" x="' + (W - padR + 8) + '" y="' + (e.y + 4).toFixed(1) + '">' +
      '<tspan fill="' + colors[e.p] + '">●</tspan> ' + esc(playerName(data, e.p)) + ' <tspan class="lb-race-label-num">' + e.v + '</tspan></text>';
  }

  host.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative revolutions won by player across all ' + n + ' revolutions" preserveAspectRatio="xMidYMid meet">' +
    grid + dividers + lines + labels + xticks +
    '<rect class="lb-race-hover" x="' + padL + '" y="' + padT + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>' +
    '<line class="lb-race-cross" y1="' + padT + '" y2="' + (padT + ih) + '" hidden/>' +
    '</svg><div class="lb-race-tip" hidden></div>';

  // screen-reader summary
  const sr = document.createElement('p');
  sr.className = 'sr-only';
  sr.textContent = 'Race totals: ' + PLAYER_ORDER.map((p) => playerName(data, p) + ' ' + running[p]).join(', ') + '.';
  host.appendChild(sr);

  // crosshair + tooltip
  const svg = host.querySelector('svg');
  const hover = host.querySelector('.lb-race-hover');
  const cross = host.querySelector('.lb-race-cross');
  const tip = host.querySelector('.lb-race-tip');
  hover.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - padL) / iw) * (n - 1))));
    const xx = x(i);
    cross.setAttribute('x1', xx); cross.setAttribute('x2', xx);
    cross.hidden = false;
    const r = revs[i];
    tip.innerHTML = '<strong>' + esc(fmtDate(r.date, true)) + ' · rev ' + r.index + '</strong>' +
      PLAYER_ORDER.map((p) => {
        const won = r.winners.includes(p) ? ' ★' : '';
        return '<span><i style="background:' + colors[p] + '"></i>' + esc(playerName(data, p)) + ' ' + cum[p][i] + won + '</span>';
      }).join('');
    tip.hidden = false;
    const px = (xx / W) * rect.width;
    tip.style.left = Math.min(rect.width - 150, Math.max(0, px + 10)) + 'px';
  });
  hover.addEventListener('pointerleave', () => { cross.hidden = true; tip.hidden = true; });
}

/* ---- partnership list ---- */

function renderPartnerships(data, scope) {
  const el = document.getElementById('lb-partnerships');
  const pairs = partnerships(data, scope);
  if (!pairs.length) { el.innerHTML = '<p class="lb-footnote">No matches yet this season.</p>'; return; }
  const counts = [...new Set(pairs.map((x) => x.played))];
  const caption = counts.length === 1
    ? 'each pair has played ' + counts[0] + (counts[0] === 1 ? ' match' : ' matches')
    : 'pairs have played ' + Math.min(...counts) + '–' + Math.max(...counts) + ' matches';
  el.innerHTML = pairs.map((pr) => {
    const rate = Math.round((pr.won / pr.played) * 100);
    const [a, b] = pr.players;
    return '<div class="lb-pair">' +
      '<span class="lb-pair-dots"><i style="background:var(--player-' + a + ')"></i><i style="background:var(--player-' + b + ')"></i></span>' +
      '<span class="lb-pair-names">' + esc(playerName(data, a)) + ' &amp; ' + esc(playerName(data, b)) + '</span>' +
      '<span class="lb-bar lb-pair-bar" role="img" aria-label="' + rate + '% win rate"><span class="lb-bar-mid"></span><span class="lb-bar-fill" style="width:' + rate + '%"></span></span>' +
      '<span class="lb-pair-pct">' + rate + '%</span>' +
      '<span class="lb-pair-rec">' + pr.won + '–' + (pr.played - pr.won) + '</span>' +
    '</div>';
  }).join('') + '<p class="lb-footnote">' + caption + ' · rule at 50%</p>';
}

/* ---- init ---- */

loadData().then((data) => {
  let scope = seasonToggle(document.getElementById('lb-seasons'), data, (s) => {
    scope = s;
    renderStandings(data, scope);
    renderPartnerships(data, scope);
  });
  renderMeta(data);
  renderStandings(data, scope);
  renderRace(data);
  renderPartnerships(data, scope);
  onThemeChange(() => renderRace(data));
  showMain();
}).catch(showError);
