// Theme cycling: System → Dark → Light → System.
// The data-theme attribute is set as early as possible by an inline script
// in <head> to avoid a flash of the wrong palette; this file just owns the
// toggle button UI and persistence.
(function () {
  'use strict';

  var STORAGE_KEY = 'theme';
  var ICONS = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    light:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    dark:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  };
  var LABELS = {
    system: 'Theme: System (click for dark)',
    dark:   'Theme: Dark (click for light)',
    light:  'Theme: Light (click for system)',
  };
  var NEXT = { system: 'dark', dark: 'light', light: 'system' };

  // ?theme=dark|light overrides and persists.
  try {
    var qp = new URL(window.location.href).searchParams.get('theme');
    if (qp === 'dark' || qp === 'light') {
      try { localStorage.setItem(STORAGE_KEY, qp); } catch (e) {}
      document.documentElement.setAttribute('data-theme', qp);
    }
  } catch (e) { /* ignore */ }

  function read() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'dark' || v === 'light') return v;
    } catch (e) { /* ignore */ }
    return 'system';
  }

  function write(state) {
    try {
      if (state === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, state);
    } catch (e) { /* ignore */ }
    if (state === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state);
  }

  function paint(btn) {
    var s = read();
    btn.innerHTML = ICONS[s];
    btn.setAttribute('aria-label', LABELS[s]);
    btn.title = LABELS[s];
    btn.dataset.themeState = s;
  }

  function init() {
    var nav = document.querySelector('.site-nav-links');
    if (!nav) return;
    if (nav.querySelector('.theme-toggle')) return; // idempotent

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', function () {
      var s = read();
      write(NEXT[s]);
      paint(btn);
    });
    nav.appendChild(btn);
    paint(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
