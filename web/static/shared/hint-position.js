/**
 * Hint tooltip flip
 * ------------------
 * Every `.hint-toggle` opens a small tooltip below itself on hover/focus
 * (see the `.hint-toggle .hint` rules in each demo's own style.css). Near
 * the bottom of a scrolling `.controls` panel, that tooltip can run past
 * the panel's edge and get clipped by its `overflow-y: auto`. This flips
 * it to open upward instead whenever it would overflow, by toggling a
 * `hint-flip` class each style.css already knows how to render.
 */
(function () {
  function reposition(toggle) {
    var hint = toggle.querySelector('.hint');
    var controls = toggle.closest('.controls');
    if (!hint || !controls) return;

    toggle.classList.remove('hint-flip');
    var hintRect = hint.getBoundingClientRect();
    var controlsRect = controls.getBoundingClientRect();
    if (hintRect.bottom > controlsRect.bottom) {
      toggle.classList.add('hint-flip');
    }
  }

  document.addEventListener('mouseover', function (e) {
    var toggle = e.target.closest && e.target.closest('.hint-toggle');
    if (toggle) reposition(toggle);
  });

  document.addEventListener('focusin', function (e) {
    var toggle = e.target.closest && e.target.closest('.hint-toggle');
    if (toggle) reposition(toggle);
  });
})();
