// Rules dropdown: progressive enhancement.
// Desktop hover/focus-within already reveals the menu via CSS. This script
// adds (a) sticky open on chevron click for touch/keyboard, (b) outside-click
// dismiss, and (c) Escape to close.
(function () {
  'use strict';

  function init() {
    var root = document.querySelector('.site-nav-rules');
    if (!root) return;
    var toggle = root.querySelector('.site-nav-rules-toggle');
    if (!toggle) return;

    function close() {
      root.removeAttribute('data-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    function open() {
      root.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      if (root.getAttribute('data-open') === 'true') close();
      else open();
    });

    document.addEventListener('click', function (e) {
      if (root.getAttribute('data-open') !== 'true') return;
      if (root.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
