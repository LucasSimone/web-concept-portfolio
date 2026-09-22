/**
 * Controls panel toggle
 * ----------------------
 * Any page with a `.controls` sidebar gets a close (x) button inline with
 * its header, a fixed edge tab at the panel's left edge to close it from
 * anywhere (useful once you've scrolled down inside a tall panel), and a
 * fixed edge tab to pull it back out when hidden (see the shared rules in
 * site.css). Open by default on desktop, closed by default on mobile -
 * every visit, for every demo. The one exception: the two-page transition
 * labs (Shutter, Aperture, Static), where a desktop visitor's choice on
 * Page One should still hold on Page Two rather than snapping back open.
 * Everywhere else nothing is persisted, so a demo's controls always start
 * fresh.
 */
(function () {
  var PERSISTED_FOLDERS = ['/transitions/shutter/', '/transitions/aperture/', '/transitions/static/'];
  var persistsAcrossPages = PERSISTED_FOLDERS.some(function (folder) {
    return window.location.pathname.indexOf(folder) === 0;
  });
  var STORAGE_KEY = 'controls-panel-open:' + window.location.pathname.replace(/[^/]*$/, '');
  var isPageTwo = /page-two\.html$/.test(window.location.pathname);

  document.addEventListener('DOMContentLoaded', function () {
    var controls = document.querySelector('.controls');
    if (!controls) return;

    if (!controls.id) controls.id = 'controls-panel';

    var isMobile = window.matchMedia('(max-width: 720px)').matches;
    var canPersist = persistsAcrossPages && !isMobile;

    // Only Page Two reads the saved choice, so arriving fresh at Page One
    // (from the homepage, a reload, etc.) always gets the normal default
    // instead of picking up a closed state left over from an earlier visit.
    var saved = null;
    if (canPersist && isPageTwo) {
      try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (e) {}
    }
    var isOpen = saved !== null ? saved === '1' : !isMobile;

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
      if (canPersist) {
        try { sessionStorage.setItem(STORAGE_KEY, isOpen ? '1' : '0'); } catch (e) {}
      }
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
