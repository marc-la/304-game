(function () {
  var p = document.querySelector('.hero-mantra-text');
  if (!p) return;

  var children = Array.prototype.slice.call(p.childNodes);
  var frag = document.createDocumentFragment();
  var idx = 0;

  children.forEach(function (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      var parts = node.textContent.split(/(\s+)/);
      parts.forEach(function (part) {
        if (part === '') return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          var span = document.createElement('span');
          span.className = 'hero-word';
          span.textContent = part;
          span.style.setProperty('--i', idx++);
          frag.appendChild(span);
        }
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Link nodes (and any other inline elements) animate as a single word
      // so underline and colour styling stay attached to the original element.
      node.classList.add('hero-word');
      node.style.setProperty('--i', idx++);
      frag.appendChild(node);
    }
  });

  p.innerHTML = '';
  p.appendChild(frag);

  // Force layout before adding .is-revealing so the animation triggers cleanly
  // even if the browser would otherwise batch the class change with the wrap.
  void p.offsetHeight;
  p.classList.add('is-revealing');
})();
