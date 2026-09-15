/**
 * Site nav injection
 * -------------------
 * Every page includes the same static `.site-nav` markup (brand + Home
 * link) and then this script, which adds the parts that depend on where
 * you are: a site-wide Docs link, and — only on a page whose URL matches
 * an entry in EFFECTS_MANIFEST — "Download JS" / "View Docs" buttons on
 * the right. Matching is by URL rather than per-page data attributes so
 * adding a new effect only ever means adding one manifest entry.
 */
(function () {
  function normalize(path) {
    return path.replace(/index\.html$/, '');
  }

  function currentEntry() {
    if (!window.EFFECTS_MANIFEST) return null;
    var path = normalize(window.location.pathname);
    return window.EFFECTS_MANIFEST.find(function (entry) {
      return normalize(entry.demoPath) === path;
    }) || null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.site-nav');
    if (!nav) return;

    var links = nav.querySelector('.links');
    if (links && !links.querySelector('[data-docs-link]')) {
      var docsLink = document.createElement('a');
      docsLink.href = '/docs/index.html';
      docsLink.textContent = 'Docs';
      docsLink.setAttribute('data-docs-link', '');
      if (window.location.pathname.indexOf('/docs/') === 0) {
        docsLink.setAttribute('aria-current', 'page');
      }
      links.appendChild(docsLink);
    }

    var entry = currentEntry();
    if (entry && !nav.querySelector('.actions')) {
      var actions = document.createElement('div');
      actions.className = 'actions';

      var downloadLink = document.createElement('a');
      downloadLink.className = 'btn';
      downloadLink.href = entry.jsPath;
      downloadLink.setAttribute('download', '');
      downloadLink.textContent = 'Download JS';

      var docsButton = document.createElement('a');
      docsButton.className = 'btn';
      docsButton.href = entry.docsPath;
      docsButton.textContent = 'View Docs';

      actions.appendChild(downloadLink);
      actions.appendChild(docsButton);
      nav.appendChild(actions);
    }
  });
})();
