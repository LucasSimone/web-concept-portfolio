/**
 * viewportProgress
 * ----------------
 * The shared math behind every effect's default 'scroll' driveMode: how
 * far `el` has traveled through the viewport, as 0 (its top just entering
 * from the bottom) to 1 (its top having reached the very top). Rolodex and
 * Type Pan both fed this straight into pushProgress() with byte-for-byte
 * identical math, just under different names - pulled out once here.
 *
 * Usage: call from the effect's own _onScroll, which still owns the
 * driveMode gate (only call this when driveMode is actually 'scroll'):
 *
 *   _onScroll() {
 *     if (this.options.driveMode !== 'scroll') return;
 *     this.pushProgress(viewportProgress(this.el));
 *   }
 */
(function (global) {
  function viewportProgress(el) {
    const rect = el.getBoundingClientRect();
    const range = global.innerHeight + rect.height;
    // range <= 0 only when the element's own height is more negative than
    // the viewport is tall - not reachable with normal CSS, but 0.5 (the
    // neutral middle) is a safer fallback than snapping to either end.
    return range > 0 ? global.SequenceStepper.clamp((global.innerHeight - rect.top) / range, 0, 1) : 0.5;
  }

  global.viewportProgress = viewportProgress;
})(window);
