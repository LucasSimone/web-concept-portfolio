/**
 * Docs sidebar injection
 * -----------------------
 * Every docs page includes an empty `<nav class="docs-sidebar" data-docs-sidebar></nav>`
 * and this script, which fills it in from EFFECTS_MANIFEST grouped by
 * category. Centralizing this means a new effect's doc link shows up on
 * every docs page automatically instead of needing to be hand-added N times.
 */
(function () {
  var CATEGORY_LABELS = {
    'text-effects': 'Text Effects',
    background: 'Background',
    'page-transitions': 'Page Transitions',
  };
  var CATEGORY_ORDER = ['text-effects', 'background', 'page-transitions'];

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
  });
})();
