/**
 * bindHoverDelegate
 * ------------------
 * Tracks which descendant of `container` matching `selector` the pointer is
 * currently over, using mousemove rather than mouseenter/mouseleave/
 * mouseover: once something inside the container is moved by a CSS
 * transform, the browser re-hit-tests hover state on every frame that
 * shifts an element under a *stationary* cursor, which would retarget
 * mouseenter/mouseleave onto whatever element the motion itself just slid
 * into place - a feedback loop that never settles on the element actually
 * under the cursor. mousemove only fires on genuine pointer movement, so
 * delegating through it instead stays correct regardless of what's
 * animating underneath. Delegated (not bound per-item) so it keeps working
 * across any later re-render of the container's children.
 *
 * Calls onChange(newEl, oldEl) whenever the matched element changes,
 * including to/from null when the pointer moves onto a non-matching area
 * or leaves the container entirely.
 */
(function (global) {
  function bindHoverDelegate(container, selector, onChange) {
    let current = null;

    function setCurrent(next) {
      if (next === current) return;
      const prev = current;
      current = next;
      onChange(next, prev);
    }

    function onMove(event) {
      const el = event.target.closest(selector);
      setCurrent(el && container.contains(el) ? el : null);
    }

    function onLeave() {
      setCurrent(null);
    }

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);

    return {
      destroy() {
        container.removeEventListener('mousemove', onMove);
        container.removeEventListener('mouseleave', onLeave);
      },
    };
  }

  global.bindHoverDelegate = bindHoverDelegate;
})(window);
