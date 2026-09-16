/**
 * Controls panel toggle
 * ----------------------
 * Any page with a `.controls` sidebar gets a close (x) button inline with
 * its header, a fixed edge tab at the panel's left edge to close it from
 * anywhere (useful once you've scrolled down inside a tall panel), and a
 * fixed edge tab to pull it back out when hidden (see the shared rules in
 * site.css). Open by default on desktop, closed by default on mobile —
 * unless the visitor already chose one or the other this session, in
 * which case that choice follows them to another page in the same effect's
 * folder too (e.g. the Shutter demo's Page One and Page Two). Scoped per
 * folder rather than site-wide, so closing it on one demo doesn't also
 * close it on an unrelated one.
 */
(function () {
  var STORAGE_KEY = 'controls-panel-open:' + window.location.pathname.replace(/[^/]*$/, '');

  document.addEventListener('DOMContentLoaded', function () {
    var controls = document.querySelector('.controls');
    if (!controls) return;

    if (!controls.id) controls.id = 'controls-panel';

    var saved = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (e) {}
    var isOpen = saved !== null
      ? saved === '1'
      : !window.matchMedia('(max-width: 720px)').matches;

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'controls-close';
    closeBtn.setAttribute('aria-label', 'Hide controls');
    closeBtn.setAttribute('aria-controls', controls.id);
    closeBtn.textContent = '×';
    controls.insertBefore(closeBtn, controls.firstChild);

    var openTab = document.createElement('button');
    openTab.type = 'button';
    openTab.className = 'controls-open-tab';
    openTab.setAttribute('aria-label', 'Show controls');
    openTab.setAttribute('aria-controls', controls.id);
    openTab.textContent = '‹';
    document.body.appendChild(openTab);

    var closeTab = document.createElement('button');
    closeTab.type = 'button';
    closeTab.className = 'controls-close-tab';
    closeTab.setAttribute('aria-label', 'Hide controls');
    closeTab.setAttribute('aria-controls', controls.id);
    closeTab.textContent = '›';
    document.body.appendChild(closeTab);

    function render() {
      document.body.classList.toggle('controls-open', isOpen);
      document.body.classList.toggle('controls-closed', !isOpen);
      closeBtn.setAttribute('aria-expanded', String(isOpen));
      openTab.setAttribute('aria-expanded', String(isOpen));
      closeTab.setAttribute('aria-expanded', String(isOpen));
      try { sessionStorage.setItem(STORAGE_KEY, isOpen ? '1' : '0'); } catch (e) {}
    }

    closeBtn.addEventListener('click', function () {
      isOpen = false;
      render();
    });

    closeTab.addEventListener('click', function () {
      isOpen = false;
      render();
    });

    openTab.addEventListener('click', function () {
      isOpen = true;
      render();
    });

    render();
  });
})();
