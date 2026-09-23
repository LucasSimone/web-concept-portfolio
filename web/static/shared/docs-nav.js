/**
 * Docs sidebar injection
 * -----------------------
 * Every docs page includes an empty `<nav class="docs-sidebar" data-docs-sidebar></nav>`
 * and this script, which fills it in from EFFECTS_MANIFEST grouped by
 * category. Centralizing this means a new effect's doc link shows up on
 * every docs page automatically instead of needing to be hand-added N times.
 *
 * On mobile the sidebar is an off-canvas drawer (see the mobile rules in
 * site.css) instead of sitting inline above the content, so this also
 * wires up its opener: a hamburger button added to .site-nav, a close
 * button inside the drawer, and a backdrop that closes it on tap. All
 * three just toggle a `docs-sidebar-open` class on <body> - closed by
 * default, and never persisted across loads.
 */
(function () {
  var CATEGORY_LABELS = {
    'text-effects': 'Text Effects',
    background: 'Background',
    transitions: 'Transitions',
    concepts: 'Concepts',
  };
  var CATEGORY_ORDER = ['text-effects', 'background', 'transitions', 'concepts'];

  var HAMBURGER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<line x1="3" y1="6" x2="21" y2="6"></line>'
    + '<line x1="3" y1="12" x2="21" y2="12"></line>'
    + '<line x1="3" y1="18" x2="21" y2="18"></line>'
    + '</svg>';

  function setupToggle(sidebar) {
    if (!sidebar.id) sidebar.id = 'docs-sidebar';

    var nav = document.querySelector('.site-nav');
    var toggle = null;
    if (nav && !nav.querySelector('.docs-nav-toggle')) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'docs-nav-toggle';
      toggle.innerHTML = HAMBURGER_ICON;
      toggle.setAttribute('aria-label', 'Open docs menu');
      toggle.setAttribute('aria-controls', sidebar.id);
      toggle.setAttribute('aria-expanded', 'false');
      nav.appendChild(toggle);
    }

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'docs-sidebar-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close docs menu');
    closeBtn.setAttribute('aria-controls', sidebar.id);
    sidebar.insertBefore(closeBtn, sidebar.firstChild);

    var backdrop = document.createElement('div');
    backdrop.className = 'docs-sidebar-backdrop';
    document.body.appendChild(backdrop);

    function setOpen(isOpen) {
      document.body.classList.toggle('docs-sidebar-open', isOpen);
      if (toggle) toggle.setAttribute('aria-expanded', String(isOpen));
    }

    if (toggle) toggle.addEventListener('click', function () { setOpen(true); });
    closeBtn.addEventListener('click', function () { setOpen(false); });
    backdrop.addEventListener('click', function () { setOpen(false); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mount = document.querySelector('[data-docs-sidebar]');
    if (!mount || !window.EFFECTS_MANIFEST) return;

    var groups = {};
    window.EFFECTS_MANIFEST.forEach(function (entry) {
      (groups[entry.category] = groups[entry.category] || []).push(entry);
    });

    var currentPath = window.location.pathname;
    var html = '<a href="/docs/index.html"' +
      (currentPath === '/docs/index.html' ? ' aria-current="page"' : '') +
      '>Overview</a>';

    CATEGORY_ORDER.forEach(function (category) {
      var entries = groups[category];
      if (!entries || !entries.length) return;
      html += '<div class="docs-sidebar-group"><h3>' + CATEGORY_LABELS[category] + '</h3>';
      entries.forEach(function (entry) {
        html += '<a href="' + entry.docsPath + '"' +
          (currentPath === entry.docsPath ? ' aria-current="page"' : '') +
          '>' + entry.name + '</a>';
      });
      html += '</div>';
    });

    mount.innerHTML = html;
    setupToggle(mount);
  });
})();
