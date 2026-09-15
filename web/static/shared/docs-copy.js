/**
 * Copy buttons for docs code blocks
 * -----------------------------------
 * Every `<pre><code>` block on a docs page gets an icon-only copy button in
 * its top-right corner, hidden until the block is hovered (or the button
 * receives focus) — see the `.docs-content pre .copy-btn` rules in
 * site.css. Reads the code element's own text so it copies exactly what's
 * rendered, not any surrounding markup.
 */
(function () {
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>'
    + '</svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<polyline points="20 6 9 17 4 12"></polyline>'
    + '</svg>';

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return Promise.resolve();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.docs-content pre').forEach(function (pre) {
      const code = pre.querySelector('code') || pre;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn copy-btn';
      button.innerHTML = COPY_ICON;
      button.setAttribute('aria-label', 'Copy');
      button.title = 'Copy';

      button.addEventListener('click', function () {
        copyText(code.textContent).then(function () {
          button.innerHTML = CHECK_ICON;
          button.setAttribute('aria-label', 'Copied');
          button.title = 'Copied';
          button.setAttribute('data-copied', '');
          setTimeout(function () {
            button.innerHTML = COPY_ICON;
            button.setAttribute('aria-label', 'Copy');
            button.title = 'Copy';
            button.removeAttribute('data-copied');
          }, 1500);
        });
      });

      pre.appendChild(button);
    });
  });
})();
