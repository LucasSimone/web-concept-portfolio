/**
 * bindHoverScrollSource
 * ----------------------
 * Shared wiring behind every effect's 'hover' driveMode ("static scroll"):
 * the effect's own element stays put on the page, and wheel/trackpad input
 * over it - or over any OTHER element elsewhere on the page tagged
 * `<data attribute>="<that element's id>"` - drives the effect directly
 * instead of scrolling the page. The tagged-element lookup is what lets a
 * page wire some other surface (a demo's own controls, a carousel card, ...)
 * to drive an effect it didn't create and doesn't otherwise know about.
 *
 * Each effect still owns its own wheel handler (what a delta actually means
 * - typed pixels, flip progress, whatever) and its own driveMode gating;
 * this only owns finding the target elements and attaching/detaching the
 * listener across all of them.
 *
 * Usage: call once from the constructor, after the element has whatever id
 * it's going to have -
 *
 *   this._hoverSource = bindHoverScrollSource(this.el, 'data-myeffect-hover', this._onWheel);
 *
 * and once from destroy() -
 *
 *   this._hoverSource.destroy();
 */
(function (global) {
  function bindHoverScrollSource(el, attr, handler) {
    const targets = [el];
    const id = el.id;
    if (id && global.CSS && typeof global.CSS.escape === 'function') {
      document.querySelectorAll(`[${attr}="${global.CSS.escape(id)}"]`).forEach((node) => {
        if (!targets.includes(node)) targets.push(node);
      });
    }
    targets.forEach((target) => {
      target.addEventListener('wheel', handler, { passive: false });
    });
    return {
      targets,
      destroy() {
        targets.forEach((target) => {
          target.removeEventListener('wheel', handler);
        });
      },
    };
  }

  global.bindHoverScrollSource = bindHoverScrollSource;
})(window);
