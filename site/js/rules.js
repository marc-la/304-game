// ===== Sidebar scroll-spy =====
// Observes every element a sidebar link points at (sections, sub-headings,
// tables) and highlights the link for the last target above the viewport's
// 25% line. This lets nested sub-links and "Quick lookups" entries highlight,
// not just top-level sections.
(function () {
  const navLinks = Array.from(document.querySelectorAll('.sidebar nav a[href^="#"]'));
  const targets = [];
  const seen = new Set();
  navLinks.forEach((link) => {
    const id = link.getAttribute('href').slice(1);
    if (seen.has(id)) return;
    seen.add(id);
    const el = document.getElementById(id);
    if (el) targets.push(el);
  });
  if (!targets.length) return;

  let ticking = false;

  function update() {
    ticking = false;
    const line = window.innerHeight * 0.25;
    let current = null;
    let best = -Infinity;
    targets.forEach((el) => {
      const top = el.getBoundingClientRect().top;
      if (top <= line && top > best) {
        best = top;
        current = el;
      }
    });
    navLinks.forEach((link) => {
      link.classList.toggle(
        'active',
        current !== null && link.getAttribute('href') === '#' + current.id
      );
    });
  }

  function requestUpdate() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  update();
})();

// ===== Worked examples =====
// Examples are native <details> elements (collapsed by default). Open them
// all for printing, then restore whatever was closed.
(function () {
  const examples = document.querySelectorAll('details.example');
  if (!examples.length) return;

  const autoOpened = [];
  window.addEventListener('beforeprint', () => {
    examples.forEach((d) => {
      if (!d.open) {
        d.open = true;
        autoOpened.push(d);
      }
    });
  });
  window.addEventListener('afterprint', () => {
    autoOpened.forEach((d) => {
      d.open = false;
    });
    autoOpened.length = 0;
  });
})();

// ===== Mobile sidebar toggle =====
(function () {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // Close sidebar when clicking a link (mobile)
  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) {
        sidebar.classList.remove('open');
      }
    });
  });

  // Close sidebar when clicking outside
  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 900 &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== toggle
    ) {
      sidebar.classList.remove('open');
    }
  });
})();
