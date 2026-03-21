(function () {
  'use strict';

  // ===== Constants =====
  var PLAYER_ORDER = ['LX', 'ML', 'MN', 'VM'];
  var DATE_FMT = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // ===== Data Layer =====

  function fetchAndParse() {
    return fetch('docs/stats.xlsx')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array', cellDates: true });
        var players = XLSX.utils.sheet_to_json(wb.Sheets['By Player']);
        var revolutions = XLSX.utils.sheet_to_json(wb.Sheets['Revolutions']);
        var matches = XLSX.utils.sheet_to_json(wb.Sheets['Matches']);
        return {
          players: transformPlayers(players),
          revolutions: transformRevolutions(revolutions),
          matches: transformMatches(matches, revolutions),
        };
      });
  }

  function transformPlayers(rows) {
    return rows.map(function (r) {
      return {
        initial: r['Initial'],
        name: r['Name'],
        revolutionsWon: r['Revolutions Won'] || 0,
        matchesWon: r['Matches Won'] || 0,
        totalStoneGiven: r['Total Stone Given'] || 0,
        totalScore: r['Total Score'] || 0,
      };
    });
  }

  function transformRevolutions(rows) {
    return rows
      .map(function (r) {
        var date = parseExcelDate(r['Date']);
        var playerResults = {};
        PLAYER_ORDER.forEach(function (p) {
          playerResults[p] = parsePlayerResult(r[p]);
        });
        return {
          id: r['RevolutionID'],
          date: date,
          notes: r['Notes'] || '',
          playerResults: playerResults,
        };
      })
      .sort(function (a, b) {
        return b.date - a.date;
      });
  }

  function transformMatches(matchRows, revRows) {
    // Build a date lookup from revolutions
    var dateLookup = {};
    revRows.forEach(function (r) {
      dateLookup[r['RevolutionID']] = parseExcelDate(r['Date']);
    });

    return matchRows
      .map(function (r) {
        return {
          revolutionId: r['RevolutionID'],
          date: dateLookup[r['RevolutionID']] || null,
          setNo: r['SetNo'],
          teamA: [r['TeamA_P1'], r['TeamA_P2']],
          teamB: [r['TeamB_P1'], r['TeamB_P2']],
          scoreA: r['ScoreA'],
          scoreB: r['ScoreB'],
          winner: r['Winner'] || '',
          notes: r['Notes'] || '',
        };
      })
      .sort(function (a, b) {
        if (!a.date || !b.date) return 0;
        if (b.date - a.date !== 0) return b.date - a.date;
        return b.setNo - a.setNo;
      });
  }

  function parseExcelDate(val) {
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      // Excel serial date
      return new Date((val - 25569) * 86400000);
    }
    if (typeof val === 'string') return new Date(val);
    return new Date();
  }

  function parsePlayerResult(str) {
    // Format: "2 (26)" → { matchesWon: 2, score: 26 }
    if (!str) return { matchesWon: 0, score: 0 };
    var m = String(str).match(/^(\d+)\s*\((\d+)\)$/);
    if (m) return { matchesWon: parseInt(m[1]), score: parseInt(m[2]) };
    return { matchesWon: 0, score: 0 };
  }

  function computeRankings(players) {
    return players.slice().sort(function (a, b) {
      if (b.revolutionsWon !== a.revolutionsWon) return b.revolutionsWon - a.revolutionsWon;
      if (b.matchesWon !== a.matchesWon) return b.matchesWon - a.matchesWon;
      return b.totalStoneGiven - a.totalStoneGiven;
    });
  }

  function computePartnerships(matches, playerMap) {
    var pairs = {};

    matches.forEach(function (m) {
      var keyA = pairKey(m.teamA[0], m.teamA[1]);
      var keyB = pairKey(m.teamB[0], m.teamB[1]);

      if (!pairs[keyA]) pairs[keyA] = { players: sortedPair(m.teamA[0], m.teamA[1]), played: 0, won: 0 };
      if (!pairs[keyB]) pairs[keyB] = { players: sortedPair(m.teamB[0], m.teamB[1]), played: 0, won: 0 };

      pairs[keyA].played++;
      pairs[keyB].played++;

      // Winner string is like "ML/MN" — check which pair it matches
      var winParts = m.winner.split('/').sort();
      var winKey = winParts.join('-');
      if (winKey === keyA) pairs[keyA].won++;
      else if (winKey === keyB) pairs[keyB].won++;
    });

    return Object.values(pairs).sort(function (a, b) {
      var rateA = a.played ? a.won / a.played : 0;
      var rateB = b.played ? b.won / b.played : 0;
      return rateB - rateA;
    });
  }

  function computeBestPartner(initial, matches) {
    var partnerWins = {};
    var partnerPlayed = {};

    matches.forEach(function (m) {
      var team = null;
      if (m.teamA.indexOf(initial) >= 0) team = m.teamA;
      else if (m.teamB.indexOf(initial) >= 0) team = m.teamB;
      if (!team) return;

      var partner = team[0] === initial ? team[1] : team[0];
      if (!partnerPlayed[partner]) { partnerPlayed[partner] = 0; partnerWins[partner] = 0; }
      partnerPlayed[partner]++;

      var winParts = m.winner.split('/').sort();
      var teamSorted = team.slice().sort();
      if (winParts[0] === teamSorted[0] && winParts[1] === teamSorted[1]) {
        partnerWins[partner]++;
      }
    });

    var best = null;
    var bestRate = -1;
    Object.keys(partnerPlayed).forEach(function (p) {
      var rate = partnerWins[p] / partnerPlayed[p];
      if (rate > bestRate || (rate === bestRate && partnerWins[p] > (best ? partnerWins[best] : 0))) {
        best = p;
        bestRate = rate;
      }
    });

    return best;
  }

  function pairKey(a, b) {
    return [a, b].sort().join('-');
  }

  function sortedPair(a, b) {
    return [a, b].sort();
  }

  function totalMatchesPlayed(initial, matches) {
    return matches.filter(function (m) {
      return m.teamA.indexOf(initial) >= 0 || m.teamB.indexOf(initial) >= 0;
    }).length;
  }

  // ===== Render Layer =====

  function renderHeroLeaderboard(ranked, matches) {
    var container = document.getElementById('leaderboard-hero');
    var ordinals = ['1st', '2nd', '3rd', '4th'];

    ranked.forEach(function (player, i) {
      var played = totalMatchesPlayed(player.initial, matches);
      var winRate = played ? Math.round((player.matchesWon / played) * 100) : 0;

      var card = document.createElement('div');
      card.className = 'leaderboard-card' + (i === 0 ? ' leaderboard-card--first' : '');
      card.innerHTML =
        '<div class="leaderboard-rank">' + ordinals[i] + '</div>' +
        '<div class="leaderboard-name">' + esc(player.name.split(' ')[0]) + '</div>' +
        '<div class="leaderboard-stats">' +
          '<div class="leaderboard-stat"><strong>' + player.revolutionsWon + '</strong> revolutions</div>' +
          '<div class="leaderboard-stat"><strong>' + player.matchesWon + '</strong> matches won</div>' +
          '<div class="leaderboard-stat"><strong>' + winRate + '%</strong> win rate</div>' +
        '</div>';
      container.appendChild(card);
    });
  }

  function renderPlayerCards(players, matches, playerMap) {
    var container = document.getElementById('player-grid');

    players.forEach(function (player) {
      var played = totalMatchesPlayed(player.initial, matches);
      var matchWinRate = played ? Math.round((player.matchesWon / played) * 100) : 0;
      var revsPlayed = countRevsPlayed(player.initial, matches);
      var revWinRate = revsPlayed ? Math.round((player.revolutionsWon / revsPlayed) * 100) : 0;
      var bestPartner = computeBestPartner(player.initial, matches);
      var bestPartnerName = bestPartner && playerMap[bestPartner] ? playerMap[bestPartner].split(' ')[0] : '—';

      var card = document.createElement('div');
      card.className = 'player-card';
      card.innerHTML =
        '<div class="player-card-header">' +
          '<h3>' + esc(player.name) + '</h3>' +
          '<span class="player-initials">' + esc(player.initial) + '</span>' +
        '</div>' +
        '<div class="player-card-body">' +
          statRow('Revolutions', player.revolutionsWon + ' / ' + revsPlayed + ' (' + revWinRate + '%)') +
          statRow('Matches', player.matchesWon + ' / ' + played + ' (' + matchWinRate + '%)') +
          statRow('Total Stone Given', player.totalStoneGiven) +
          statRow('Total Score', player.totalScore) +
          statRow('Best Partner', bestPartnerName) +
        '</div>';
      container.appendChild(card);
    });
  }

  function countRevsPlayed(initial, matches) {
    // Count distinct revolution IDs where this player participated
    var seen = {};
    matches.forEach(function (m) {
      if (m.teamA.indexOf(initial) >= 0 || m.teamB.indexOf(initial) >= 0) {
        seen[m.revolutionId] = true;
      }
    });
    return Object.keys(seen).length;
  }

  function statRow(label, value) {
    return '<div class="player-stat-row">' +
      '<span class="player-stat-label">' + esc(label) + '</span>' +
      '<span class="player-stat-value">' + esc(String(value)) + '</span>' +
    '</div>';
  }

  function renderPartnershipCards(partnerships, playerMap) {
    var container = document.getElementById('partnership-grid');

    partnerships.forEach(function (p) {
      var nameA = playerMap[p.players[0]] ? playerMap[p.players[0]].split(' ')[0] : p.players[0];
      var nameB = playerMap[p.players[1]] ? playerMap[p.players[1]].split(' ')[0] : p.players[1];
      var rate = p.played ? Math.round((p.won / p.played) * 100) : 0;

      var card = document.createElement('div');
      card.className = 'partnership-card';
      card.innerHTML =
        '<div class="partnership-names">' + esc(nameA) + ' &amp; ' + esc(nameB) + '</div>' +
        '<div class="partnership-winrate">' + rate + '%</div>' +
        '<div class="partnership-record">' + p.won + 'W – ' + (p.played - p.won) + 'L (' + p.played + ' played)</div>';
      container.appendChild(card);
    });
  }

  function renderRevolutionTable(revolutions, playerMap) {
    var container = document.getElementById('revolution-table');

    // Find revolution winner per revolution (highest matches won, then highest score)
    var html = '<table><thead><tr>' +
      '<th>Date</th>';
    PLAYER_ORDER.forEach(function (p) {
      var firstName = playerMap[p] ? playerMap[p].split(' ')[0] : p;
      html += '<th>' + esc(firstName) + '</th>';
    });
    html += '<th>Notes</th></tr></thead><tbody>';

    revolutions.forEach(function (rev) {
      // Determine winner of this revolution
      var maxWon = -1;
      PLAYER_ORDER.forEach(function (p) {
        var r = rev.playerResults[p];
        if (r.matchesWon > maxWon) maxWon = r.matchesWon;
      });

      html += '<tr>';
      html += '<td>' + formatDate(rev.date) + '</td>';
      PLAYER_ORDER.forEach(function (p) {
        var r = rev.playerResults[p];
        var isWinner = r.matchesWon === maxWon && maxWon > 0;
        html += '<td' + (isWinner ? ' class="winner-cell"' : '') + '>' +
          r.matchesWon + ' (' + r.score + ')' + '</td>';
      });
      html += '<td>' + esc(rev.notes) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderMatchTable(matches, playerMap, filter) {
    var container = document.getElementById('match-table');

    var filtered = matches;
    if (filter) {
      filtered = matches.filter(function (m) {
        return m.teamA.indexOf(filter) >= 0 || m.teamB.indexOf(filter) >= 0;
      });
    }

    var html = '<table><thead><tr>' +
      '<th>Date</th><th>Set</th><th>Team A</th><th>Team B</th>' +
      '<th>Score</th><th>Winner</th><th>Notes</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function (m) {
      var teamANames = m.teamA.map(function (p) { return shortName(p, playerMap); }).join(' & ');
      var teamBNames = m.teamB.map(function (p) { return shortName(p, playerMap); }).join(' & ');
      var winnerNames = m.winner.split('/').map(function (p) { return shortName(p.trim(), playerMap); }).join(' & ');

      html += '<tr>';
      html += '<td>' + (m.date ? formatDate(m.date) : '') + '</td>';
      html += '<td>' + m.setNo + '</td>';
      html += '<td>' + esc(teamANames) + '</td>';
      html += '<td>' + esc(teamBNames) + '</td>';
      html += '<td>' + m.scoreA + ' – ' + m.scoreB + '</td>';
      html += '<td class="winner-cell">' + esc(winnerNames) + '</td>';
      html += '<td>' + esc(m.notes) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderMatchFilters(playerMap, matches) {
    var container = document.getElementById('match-filters');
    container.innerHTML = '<span class="filter-label">Filter:</span>';

    var allBtn = document.createElement('button');
    allBtn.className = 'filter-btn active';
    allBtn.textContent = 'All';
    allBtn.setAttribute('data-filter', '');
    container.appendChild(allBtn);

    PLAYER_ORDER.forEach(function (p) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = shortName(p, playerMap);
      btn.setAttribute('data-filter', p);
      container.appendChild(btn);
    });

    // Wire up filter clicks
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;

      container.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var filterVal = btn.getAttribute('data-filter');
      renderMatchTable(matches, playerMap, filterVal || null);
    });
  }

  function renderLastUpdated(revolutions) {
    var el = document.getElementById('last-updated');
    if (revolutions.length > 0) {
      el.textContent = 'Last updated: ' + formatDate(revolutions[0].date);
    }
  }

  // ===== Helpers =====

  function formatDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return DATE_FMT.format(d);
  }

  function shortName(initial, playerMap) {
    if (playerMap[initial]) return playerMap[initial].split(' ')[0];
    return initial;
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Init =====

  function init() {
    var loadingEl = document.getElementById('stats-loading');
    var errorEl = document.getElementById('stats-error');
    var mainEl = document.getElementById('stats-main');

    fetchAndParse()
      .then(function (data) {
        // Build player name map: initial → full name
        var playerMap = {};
        data.players.forEach(function (p) { playerMap[p.initial] = p.name; });

        var ranked = computeRankings(data.players);
        var partnerships = computePartnerships(data.matches, playerMap);

        // Render all sections
        renderHeroLeaderboard(ranked, data.matches);
        renderPlayerCards(ranked, data.matches, playerMap);
        renderPartnershipCards(partnerships, playerMap);
        renderRevolutionTable(data.revolutions, playerMap);
        renderMatchFilters(playerMap, data.matches);
        renderMatchTable(data.matches, playerMap, null);
        renderLastUpdated(data.revolutions);

        // Show content
        loadingEl.hidden = true;
        mainEl.hidden = false;
      })
      .catch(function (err) {
        console.error('Failed to load stats:', err);
        loadingEl.hidden = true;
        errorEl.hidden = false;
      });
  }

  init();
})();
