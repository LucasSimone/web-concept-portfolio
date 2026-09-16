/**
 * Site nav injection
 * -------------------
 * Every page includes the same static `.site-nav` markup (brand + Home
 * link) and then this script, which adds the parts that depend on where
 * you are: site-wide Docs and Contact links, and — only on a page whose
 * URL matches an entry in EFFECTS_MANIFEST — "Download JS" / "View Docs"
 * buttons on the right. Matching is by URL rather than per-page data
 * attributes so adding a new effect only ever means adding one manifest
 * entry.
 */
(function () {
  var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>'
    + '<polyline points="7 10 12 15 17 10"></polyline>'
    + '<line x1="12" y1="15" x2="12" y2="3"></line>'
    + '</svg>';
  var DOCS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>'
    + '<polyline points="14 2 14 8 20 8"></polyline>'
    + '<line x1="16" y1="13" x2="8" y2="13"></line>'
    + '<line x1="16" y1="17" x2="8" y2="17"></line>'
    + '</svg>';

  function normalize(path) {
    return path.replace(/index\.html$/, '');
  }

  function buildActionButton(href, icon, label, download) {
    var a = document.createElement('a');
    a.className = 'btn';
    a.href = href;
    if (download) a.setAttribute('download', '');
    a.setAttribute('aria-label', label);
    a.innerHTML = icon + '<span class="btn-label">' + label + '</span>';
    return a;
  }

  function currentEntry() {
    if (!window.EFFECTS_MANIFEST) return null;
    var path = window.location.pathname;
    return window.EFFECTS_MANIFEST.find(function (entry) {
      // Prefix match on the effect's own folder, not just its demoPath
      // exactly — a multi-page demo (e.g. Shutter's page-two.html) lives
      // alongside index.html in that same folder and should get the same
      // Download JS / View Docs buttons.
      return path.indexOf(normalize(entry.demoPath)) === 0;
    }) || null;
  }

  function addNavLink(links, href, label, dataAttr, activePrefix) {
    if (links.querySelector('[' + dataAttr + ']')) return;
    var link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    link.setAttribute(dataAttr, '');
    if (window.location.pathname.indexOf(activePrefix) === 0) {
      link.setAttribute('aria-current', 'page');
    }
    links.appendChild(link);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.site-nav');
    if (!nav) return;

    var links = nav.querySelector('.links');
    if (links) {
      addNavLink(links, '/docs/index.html', 'Docs', 'data-docs-link', '/docs/');
      addNavLink(links, '/contact/index.html', 'Contact', 'data-contact-link', '/contact/');
    }

    var entry = currentEntry();
    if (entry && !nav.querySelector('.actions')) {
      var actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(buildActionButton(entry.jsPath, DOWNLOAD_ICON, 'Download JS', true));
      actions.appendChild(buildActionButton(entry.docsPath, DOCS_ICON, 'View Docs', false));
      nav.appendChild(actions);
    }
  });
})();
