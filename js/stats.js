(function () {
  'use strict';

  // ===== Constants =====
  var PLAYER_ORDER = ['LX', 'ML', 'MN', 'VM'];
  var PLAYER_COLORS = {
    LX: '#e76f51',
    ML: '#2a9d8f',
    MN: '#e9c46a',
    VM: '#264653',
  };
  var DATE_FMT = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  var TOOLTIPS = {
    revolutionsWon:
      'Revolutions Won is the total number of revolutions a player has won. Within a revolution, the winner is whoever took the most matches; ties are broken by stone given. If players are still tied, every tied player receives a point.',
    matchesWon:
      'Matches Won is the total number of individual matches (sets) this player has won across all revolutions.',
    totalStoneGiven:
      'Total Stone Given is the sum of all stone this player has accumulated — the bracketed numbers in the per-revolution scores.',
    totalScore:
      'Total Score comes from revolution placement: 1st = 4 pts, 2nd = 3, 3rd = 2, 4th = 1. A tie in placement (same matches won AND same stone given) means each tied player receives that placement’s points.',
  };

  var PARTNERSHIP_PALETTE = [
    '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#b07aa1',
  ];

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

  function parseRevolutionId(id) {
    var m = String(id || '').match(/^R(\d{8})-(\d+)$/);
    if (!m) return { dateStr: '', num: 0 };
    return { dateStr: m[1], num: parseInt(m[2], 10) };
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
        if (b.date - a.date !== 0) return b.date - a.date;
        return parseRevolutionId(a.id).num - parseRevolutionId(b.id).num;
      });
  }

  function transformMatches(matchRows, revRows) {
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
        var an = parseRevolutionId(a.revolutionId).num;
        var bn = parseRevolutionId(b.revolutionId).num;
        if (an !== bn) return an - bn;
        return a.setNo - b.setNo;
      });
  }

  function parseExcelDate(val) {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date((val - 25569) * 86400000);
    if (typeof val === 'string') return new Date(val);
    return new Date();
  }

  function parsePlayerResult(str) {
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

  function pairKey(a, b) { return [a, b].sort().join('-'); }
  function sortedPair(a, b) { return [a, b].sort(); }

  function computePartnerships(matches) {
    var pairs = {};
    matches.forEach(function (m) {
      var keyA = pairKey(m.teamA[0], m.teamA[1]);
      var keyB = pairKey(m.teamB[0], m.teamB[1]);

      if (!pairs[keyA]) pairs[keyA] = { players: sortedPair(m.teamA[0], m.teamA[1]), played: 0, won: 0 };
      if (!pairs[keyB]) pairs[keyB] = { players: sortedPair(m.teamB[0], m.teamB[1]), played: 0, won: 0 };

      pairs[keyA].played++;
      pairs[keyB].played++;

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

  function totalMatchesPlayed(initial, matches) {
    return matches.filter(function (m) {
      return m.teamA.indexOf(initial) >= 0 || m.teamB.indexOf(initial) >= 0;
    }).length;
  }

  function countRevsPlayed(initial, matches) {
    var seen = {};
    matches.forEach(function (m) {
      if (m.teamA.indexOf(initial) >= 0 || m.teamB.indexOf(initial) >= 0) {
        seen[m.revolutionId] = true;
      }
    });
    return Object.keys(seen).length;
  }

  // ===== Bets CSV layer =====

  function csvUrlForRev(rev) {
    var d = rev.date;
    if (!(d instanceof Date) || isNaN(d)) return null;
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var revNum = String(parseRevolutionId(rev.id).num).padStart(2, '0');
    return 'docs/bets/' + yyyy + '-' + mm + '-' + dd + '_304_rev' + revNum + '.csv';
  }

  function fetchBetsForRevs(revs) {
    var jobs = revs.map(function (rev) {
      var url = csvUrlForRev(rev);
      if (!url) return Promise.resolve(null);
      return fetch(url)
        .then(function (res) {
          if (!res.ok) return null;
          return res.text().then(function (text) {
            return { revId: rev.id, url: url, data: parseBetsCSV(text), text: text };
          });
        })
        .catch(function () { return null; });
    });

    return Promise.all(jobs).then(function (results) {
      var byRev = {};
      results.forEach(function (r) { if (r) byRev[r.revId] = r; });
      return byRev;
    });
  }

  function parseBetsCSV(text) {
    var lines = text.split(/\r?\n/);
    var sets = [];
    var currentSet = null;
    var phase = 'sets';
    var notes = [];
    var overall = {};

    function splitCells(line) {
      // Simple split; CSVs in this format don't contain quoted commas.
      return line.split(',').map(function (s) { return s.trim(); });
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (raw == null) continue;
      var line = raw.replace(/﻿/, '');

      if (!line.trim() && phase !== 'notes') continue;

      var setMatch = line.match(/^Set\s+(\d+)\s+(\S+)\s+(\d+)\s*-\s*(\d+)\s+(\S+)/);
      if (setMatch) {
        currentSet = {
          setNo: parseInt(setMatch[1], 10),
          teamA: setMatch[2].split('/'),
          scoreA: parseInt(setMatch[3], 10),
          scoreB: parseInt(setMatch[4], 10),
          teamB: setMatch[5].split('/'),
          rounds: [],
          playerBets: {},
        };
        sets.push(currentSet);
        phase = 'sets';
        continue;
      }

      if (/^OVERALL\b/i.test(line)) { phase = 'overall'; continue; }
      if (/^NOTES\b/i.test(line))   { phase = 'notes';   continue; }

      var cells = splitCells(line);
      var first = cells[0];

      if (phase === 'sets' && currentSet) {
        if (first === '') {
          currentSet.rounds = cells.slice(1).filter(function (c) { return c !== ''; });
          continue;
        }
        if (PLAYER_ORDER.indexOf(first) >= 0) {
          currentSet.playerBets[first] = cells.slice(1);
        }
      } else if (phase === 'overall') {
        if (PLAYER_ORDER.indexOf(first) >= 0) {
          overall[first] = {
            sets: parseInt(cells[1], 10) || 0,
            stone: parseInt(cells[2], 10) || 0,
          };
        }
      } else if (phase === 'notes') {
        var trimmed = line.trim();
        if (trimmed) notes.push(trimmed.replace(/^-\s*/, ''));
      }
    }

    return { sets: sets, overall: overall, notes: notes };
  }

  // ===== Render Layer =====

  var TIER_CLASS = ['leaderboard-card--first', 'leaderboard-card--second', 'leaderboard-card--third', 'leaderboard-card--fourth'];

  function renderHeroLeaderboard(ranked, matches) {
    var container = document.getElementById('leaderboard-hero');
    container.innerHTML = '';
    var ordinals = ['1st', '2nd', '3rd', '4th'];

    ranked.forEach(function (player, i) {
      var played = totalMatchesPlayed(player.initial, matches);
      var winRate = played ? Math.round((player.matchesWon / played) * 100) : 0;
      var color = PLAYER_COLORS[player.initial] || '#888';

      var card = document.createElement('div');
      card.className = 'leaderboard-card ' + (TIER_CLASS[i] || 'leaderboard-card--fourth');
      card.style.setProperty('--player-color', color);
      card.innerHTML =
        '<div class="leaderboard-medal">' + (i + 1) + '</div>' +
        '<div class="leaderboard-rank">' + ordinals[i] + ' place</div>' +
        '<div class="leaderboard-name">' + esc(player.name.split(' ')[0]) + '</div>' +
        '<div class="leaderboard-initials">' + esc(player.initial) + '</div>' +
        '<div class="leaderboard-stats">' +
          '<div class="leaderboard-stat"><strong>' + player.revolutionsWon + '</strong> revolutions</div>' +
          '<div class="leaderboard-stat"><strong>' + player.matchesWon + '</strong> matches won</div>' +
          '<div class="leaderboard-stat"><strong>' + winRate + '%</strong> win rate</div>' +
        '</div>';
      container.appendChild(card);
    });
  }

  function infoIcon(text) {
    return '<span class="info-icon" tabindex="0" aria-label="More info">i' +
      '<span class="info-tooltip">' + esc(text) + '</span></span>';
  }

  function renderPlayerCards(players, matches, playerMap) {
    var container = document.getElementById('player-grid');
    container.innerHTML = '';

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
          '<h3>' + esc(player.name.split(' ')[0]) + '</h3>' +
          '<span class="player-initials">' + esc(player.initial) + '</span>' +
        '</div>' +
        '<div class="player-card-body">' +
          statRowWithInfo('Revolutions Won', player.revolutionsWon + ' / ' + revsPlayed + ' (' + revWinRate + '%)', TOOLTIPS.revolutionsWon) +
          statRowWithInfo('Matches Won', player.matchesWon + ' / ' + played + ' (' + matchWinRate + '%)', TOOLTIPS.matchesWon) +
          statRowWithInfo('Total Stone Given', player.totalStoneGiven, TOOLTIPS.totalStoneGiven) +
          statRowWithInfo('Total Score', player.totalScore, TOOLTIPS.totalScore) +
          statRow('Best Partner', bestPartnerName) +
        '</div>';
      container.appendChild(card);
    });
  }

  function statRow(label, value) {
    return '<div class="player-stat-row">' +
      '<span class="player-stat-label">' + esc(label) + '</span>' +
      '<span class="player-stat-value">' + esc(String(value)) + '</span>' +
    '</div>';
  }

  function statRowWithInfo(label, value, tooltip) {
    return '<div class="player-stat-row">' +
      '<span class="player-stat-label">' + esc(label) + infoIcon(tooltip) + '</span>' +
      '<span class="player-stat-value">' + esc(String(value)) + '</span>' +
    '</div>';
  }

  function renderPartnershipCards(partnerships, playerMap) {
    var container = document.getElementById('partnership-grid');
    container.innerHTML = '';

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

  // ===== History tree (cascading: revolution -> matches -> bets) =====

  function revWinnersForRow(rev) {
    var maxMatches = -1;
    PLAYER_ORDER.forEach(function (p) {
      var w = rev.playerResults[p].matchesWon;
      if (w > maxMatches) maxMatches = w;
    });
    if (maxMatches <= 0) return [];
    var topMatches = PLAYER_ORDER.filter(function (p) {
      return rev.playerResults[p].matchesWon === maxMatches;
    });
    var maxScore = -1;
    topMatches.forEach(function (p) {
      if (rev.playerResults[p].score > maxScore) maxScore = rev.playerResults[p].score;
    });
    return topMatches.filter(function (p) {
      return rev.playerResults[p].score === maxScore;
    });
  }

  function renderHistoryTree(state) {
    var container = document.getElementById('history-tree');
    container.innerHTML = '';

    var matchesByRev = {};
    state.matches.forEach(function (m) {
      (matchesByRev[m.revolutionId] = matchesByRev[m.revolutionId] || []).push(m);
    });

    state.revolutions.forEach(function (rev) {
      var winners = revWinnersForRow(rev);

      // Filter: show only revolutions this player won (sets, then stone, else tie).
      if (state.filter && winners.indexOf(state.filter) < 0) return;

      var revMatches = (matchesByRev[rev.id] || []).slice().sort(function (a, b) {
        return a.setNo - b.setNo;
      });

      var revEl = document.createElement('details');
      revEl.className = 'rev-node';
      var resultsHtml = PLAYER_ORDER.map(function (p) {
        var r = rev.playerResults[p];
        var isWin = winners.indexOf(p) >= 0;
        var name = state.playerMap[p] ? state.playerMap[p].split(' ')[0] : p;
        return '<span class="rev-summary-result' + (isWin ? ' is-winner' : '') + '" style="--player-color:' + PLAYER_COLORS[p] + '">' +
          '<span class="player-pip"></span>' + esc(name) + ' ' + r.matchesWon + ' (' + r.score + ')</span>';
      }).join('');

      var bets = state.betsByRev[rev.id];
      var downloadBtn = bets
        ? '<a class="rev-download-btn" href="' + bets.url + '" download title="Download betting CSV">↓ CSV</a>'
        : '';

      var summary = document.createElement('summary');
      summary.className = 'rev-summary';
      summary.innerHTML =
        '<span class="tree-chevron">▶</span>' +
        '<span class="rev-summary-date">' + formatDate(rev.date) + '</span>' +
        '<span class="rev-summary-num">Rev ' + parseRevolutionId(rev.id).num + '</span>' +
        '<span class="rev-summary-results">' + resultsHtml + '</span>' +
        downloadBtn;
      revEl.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'rev-body';
      if (rev.notes) {
        var notesEl = document.createElement('div');
        notesEl.className = 'rev-notes';
        notesEl.textContent = rev.notes;
        body.appendChild(notesEl);
      }

      var matchList = document.createElement('div');
      matchList.className = 'match-list';

      revMatches.forEach(function (m) {
        matchList.appendChild(buildMatchNode(m, state, bets));
      });

      body.appendChild(matchList);
      revEl.appendChild(body);
      container.appendChild(revEl);
    });

    if (!container.children.length) {
      container.innerHTML = '<p class="chart-caption">No revolutions won by this player yet.</p>';
    }
  }

  function buildMatchNode(m, state, bets) {
    var betSet = bets ? findBetSet(bets.data, m) : null;

    var teamAIsWinner = isWinnerTeam(m.winner, m.teamA);
    var teamBIsWinner = isWinnerTeam(m.winner, m.teamB);

    var teamAStr = m.teamA.map(function (p) { return shortName(p, state.playerMap); }).join(' & ');
    var teamBStr = m.teamB.map(function (p) { return shortName(p, state.playerMap); }).join(' & ');

    var match = document.createElement('details');
    match.className = 'match-node';

    var summary = document.createElement('summary');
    summary.className = 'match-summary';
    summary.innerHTML =
      '<span class="tree-chevron">▶</span>' +
      '<span class="match-summary-set">Set ' + m.setNo + '</span>' +
      '<span class="match-summary-teams">' +
        '<span class="match-team' + (teamAIsWinner ? ' is-winner' : '') + '">' + esc(teamAStr) + '</span>' +
        '<span class="match-vs">vs</span>' +
        '<span class="match-team' + (teamBIsWinner ? ' is-winner' : '') + '">' + esc(teamBStr) + '</span>' +
      '</span>' +
      '<span class="match-score">' +
        '<span class="' + (teamAIsWinner ? 'score-winner' : '') + '">' + m.scoreA + '</span>' +
        ' – ' +
        '<span class="' + (teamBIsWinner ? 'score-winner' : '') + '">' + m.scoreB + '</span>' +
      '</span>';
    match.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'match-body';

    if (m.notes) {
      var n = document.createElement('div');
      n.className = 'match-notes';
      n.textContent = 'Note: ' + m.notes;
      body.appendChild(n);
    }

    if (betSet) {
      body.appendChild(buildBetTable(betSet, m));
      var setNotes = filterNotesForSet(bets.data.notes, m.setNo);
      if (setNotes.length) {
        var ul = document.createElement('ul');
        ul.className = 'bets-notes';
        setNotes.forEach(function (note) {
          var li = document.createElement('li');
          li.textContent = note;
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
    } else if (!m.notes) {
      var empty = document.createElement('div');
      empty.className = 'match-bets-empty';
      empty.textContent = 'No betting data recorded for this match.';
      body.appendChild(empty);
    }

    match.appendChild(body);
    return match;
  }

  function isWinnerTeam(winner, team) {
    if (!winner) return false;
    var w = winner.split('/').map(function (s) { return s.trim(); }).sort();
    var t = team.slice().sort();
    return w[0] === t[0] && w[1] === t[1];
  }

  function findBetSet(betData, m) {
    if (!betData || !betData.sets) return null;
    for (var i = 0; i < betData.sets.length; i++) {
      if (betData.sets[i].setNo === m.setNo) return betData.sets[i];
    }
    return null;
  }

  function filterNotesForSet(notes, setNo) {
    if (!notes) return [];
    var rePrefix = new RegExp('^' + setNo + '\\.\\d');
    return notes.filter(function (n) { return rePrefix.test(n); });
  }

  function buildBetTable(setData, match) {
    var rounds = (setData.rounds && setData.rounds.length) ? setData.rounds : ['1','2','3','4','5','6','7','8','9','10','11','12'];
    var teamA = match.teamA, teamB = match.teamB;
    var winnerTeam = isWinnerTeam(match.winner, teamA) ? teamA : (isWinnerTeam(match.winner, teamB) ? teamB : []);

    var wrap = document.createElement('div');
    wrap.className = 'bets-table-wrap';

    var html = '<table class="bets-table"><thead><tr><th>Player</th>';
    rounds.forEach(function (r) { html += '<th>' + esc(String(r)) + '</th>'; });
    html += '</tr></thead><tbody>';

    PLAYER_ORDER.forEach(function (p) {
      var team = teamA.indexOf(p) >= 0 ? 'team-a' : (teamB.indexOf(p) >= 0 ? 'team-b' : '');
      var winCls = winnerTeam.indexOf(p) >= 0 ? ' is-winner' : '';
      html += '<tr class="' + team + winCls + '"><td>' + esc(p) + '</td>';
      var bets = setData.playerBets[p] || [];
      for (var i = 0; i < rounds.length; i++) {
        var v = (bets[i] || '').trim();
        html += v
          ? '<td class="bet-cell">' + esc(v) + '</td>'
          : '<td></td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;

    var pills = document.createElement('div');
    pills.className = 'bets-overall';
    var hasOverall = false;
    // overall comes from parent CSV; here we show set-level score totals for context
    pills.innerHTML =
      '<span class="bets-overall-pill"><strong>Set score:</strong> ' +
      setData.teamA.join('/') + ' ' + setData.scoreA + ' – ' + setData.scoreB + ' ' + setData.teamB.join('/') +
      '</span>';
    hasOverall = true;

    var container = document.createElement('div');
    container.appendChild(wrap);
    if (hasOverall) container.appendChild(pills);
    return container;
  }

  function renderMatchFilters(state) {
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
      btn.textContent = shortName(p, state.playerMap);
      btn.setAttribute('data-filter', p);
      container.appendChild(btn);
    });

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      container.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.filter = btn.getAttribute('data-filter') || null;
      renderHistoryTree(state);
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

  // ===== Charts =====

  function chronologicalRevs(revolutions) {
    return revolutions.slice().sort(function (a, b) {
      if (a.date - b.date !== 0) return a.date - b.date;
      return parseRevolutionId(a.id).num - parseRevolutionId(b.id).num;
    });
  }

  function chronologicalMatches(matches) {
    return matches.slice().sort(function (a, b) {
      if (!a.date || !b.date) return 0;
      if (a.date - b.date !== 0) return a.date - b.date;
      var an = parseRevolutionId(a.revolutionId).num;
      var bn = parseRevolutionId(b.revolutionId).num;
      if (an !== bn) return an - bn;
      return a.setNo - b.setNo;
    });
  }

  function revWinners(rev) {
    return revWinnersForRow(rev);
  }

  function renderCumulativeChart(revolutions, playerMap) {
    var canvas = document.getElementById('cumulative-revs-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    var chrono = chronologicalRevs(revolutions);
    var labels = chrono.map(function (r) {
      return formatDate(r.date) + ' #' + parseRevolutionId(r.id).num;
    });

    var running = {};
    PLAYER_ORDER.forEach(function (p) { running[p] = 0; });
    var series = {};
    PLAYER_ORDER.forEach(function (p) { series[p] = []; });

    chrono.forEach(function (rev) {
      var winners = revWinners(rev);
      winners.forEach(function (w) { running[w]++; });
      PLAYER_ORDER.forEach(function (p) { series[p].push(running[p]); });
    });

    var datasets = PLAYER_ORDER.map(function (p) {
      return {
        label: shortName(p, playerMap),
        data: series[p],
        borderColor: PLAYER_COLORS[p],
        backgroundColor: PLAYER_COLORS[p],
        tension: 0.15,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
      };
    });

    new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Revolutions won' } },
          x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 12 } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { title: function (items) { return items[0].label; } } },
        },
      },
    });
  }

  function renderPartnershipsChart(matches, playerMap) {
    var canvas = document.getElementById('partnerships-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    var chrono = chronologicalMatches(matches);
    var labels = chrono.map(function (m, idx) {
      return formatDate(m.date) + ' R' + parseRevolutionId(m.revolutionId).num + 'S' + m.setNo;
    });

    // Identify all distinct pairs
    var pairs = {};
    chrono.forEach(function (m) {
      [m.teamA, m.teamB].forEach(function (t) {
        var k = pairKey(t[0], t[1]);
        if (!pairs[k]) pairs[k] = { players: sortedPair(t[0], t[1]), played: 0, won: 0, series: [] };
      });
    });

    chrono.forEach(function (m) {
      var winSorted = m.winner.split('/').map(function (s) { return s.trim(); }).sort().join('-');

      Object.keys(pairs).forEach(function (k) {
        var pair = pairs[k];
        var onA = (m.teamA.indexOf(pair.players[0]) >= 0 && m.teamA.indexOf(pair.players[1]) >= 0);
        var onB = (m.teamB.indexOf(pair.players[0]) >= 0 && m.teamB.indexOf(pair.players[1]) >= 0);
        if (onA || onB) {
          pair.played++;
          if (winSorted === k) pair.won++;
        }
        // Show NaN until pair has played at least 2 matches; this hides early noise.
        var rate = pair.played >= 2 ? Math.round((pair.won / pair.played) * 1000) / 10 : null;
        pair.series.push(rate);
      });
    });

    var pairList = Object.values(pairs).sort(function (a, b) {
      var rA = a.played ? a.won / a.played : 0;
      var rB = b.played ? b.won / b.played : 0;
      return rB - rA;
    });

    var datasets = pairList.map(function (pair, i) {
      var nameA = playerMap[pair.players[0]] ? playerMap[pair.players[0]].split(' ')[0] : pair.players[0];
      var nameB = playerMap[pair.players[1]] ? playerMap[pair.players[1]].split(' ')[0] : pair.players[1];
      var color = PARTNERSHIP_PALETTE[i % PARTNERSHIP_PALETTE.length];
      return {
        label: nameA + ' & ' + nameB + ' (' + pair.won + '/' + pair.played + ')',
        data: pair.series,
        borderColor: color,
        backgroundColor: color,
        tension: 0.2,
        borderWidth: 2,
        pointRadius: 1.5,
        pointHoverRadius: 4,
        spanGaps: true,
      };
    });

    new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: function (v) { return v + '%'; } },
            title: { display: true, text: 'Win rate' },
          },
          x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 14 } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: {
              label: function (item) {
                if (item.parsed.y == null) return item.dataset.label + ': —';
                return item.dataset.label + ': ' + item.parsed.y + '%';
              },
            },
          },
        },
      },
    });
  }

  // ===== Init =====

  function init() {
    var loadingEl = document.getElementById('stats-loading');
    var errorEl = document.getElementById('stats-error');
    var mainEl = document.getElementById('stats-main');

    fetchAndParse()
      .then(function (data) {
        return fetchBetsForRevs(data.revolutions).then(function (betsByRev) {
          return Object.assign({}, data, { betsByRev: betsByRev });
        });
      })
      .then(function (data) {
        var playerMap = {};
        data.players.forEach(function (p) { playerMap[p.initial] = p.name; });

        var ranked = computeRankings(data.players);
        var partnerships = computePartnerships(data.matches);

        var state = {
          revolutions: data.revolutions,
          matches: data.matches,
          playerMap: playerMap,
          betsByRev: data.betsByRev || {},
          filter: null,
        };

        renderHeroLeaderboard(ranked, data.matches);
        renderCumulativeChart(data.revolutions, playerMap);
        renderPlayerCards(ranked, data.matches, playerMap);
        renderPartnershipCards(partnerships, playerMap);
        renderMatchFilters(state);
        renderHistoryTree(state);
        renderLastUpdated(data.revolutions);

        // The partnerships-over-time chart lives inside a collapsed <details>;
        // Chart.js needs a non-zero canvas size at init, so build it on first open.
        var trendDetails = document.querySelector('.partnership-trend');
        if (trendDetails) {
          var built = false;
          trendDetails.addEventListener('toggle', function () {
            if (trendDetails.open && !built) {
              renderPartnershipsChart(data.matches, playerMap);
              built = true;
            }
          });
        }

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
