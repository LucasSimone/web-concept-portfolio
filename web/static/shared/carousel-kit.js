/**
 * Carousel kit
 * ------------
 * The parts every carousel in this category is built out of. Sweep, Reel,
 * Deck and Dial are four genuinely different mechanisms - a strip, a ring,
 * a frame changer, a disc - but all four are "a set of things with one of
 * them in front", and that much they share exactly: the same wrap-around
 * arithmetic, the same per-tab memory of which item was in front, the same
 * rule about when to keep their hands off the arrow keys, and the same
 * auto-init/lookup surface. This file is the single copy of those, so a fix
 * lands in all four at once instead of in whichever one someone happened to
 * be reading.
 *
 * What is deliberately *not* here is the animation loop. Reel's and Dial's
 * look almost identical on the page, but Reel clamps position at the ends
 * when `loop` is off and Dial never clamps at all, Reel carries an
 * auto-advance timer and Dial doesn't, and Sweep's phase model is different
 * again. Folding those into one loop with a configuration object for every
 * difference would be longer and harder to follow than the explicit copies,
 * so each effect keeps its own.
 *
 * Nobody loading an effect needs to know this file exists: each effect's
 * URL serves this concatenated ahead of it as one self-contained script
 * (see internal/httpserver/bundle.go and the `bundled` map in routes.go).
 * Building from this repo's source instead, load it before the effect's own
 * file.
 */
(function (global) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Proper (always non-negative) modulo, unlike JS's remainder operator,
  // which keeps the sign of the dividend: (-1 % 8) is -1, mod(-1, 8) is 7.
  // Every "which item is this, counting round the loop" calculation here
  // wants the second answer.
  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  // Shortest signed distance from 0 to `raw` around a loop of size `n`,
  // e.g. wrapDelta(7, 8) === -1 (one step back beats seven steps forward).
  // This is what makes "go to item 2" turn the short way round rather than
  // unwinding every lap already travelled.
  function wrapDelta(raw, n) {
    let d = raw % n;
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    return d;
  }

  // The same idea in degrees: folds any angle into -180..180.
  function wrapAngle(degrees) {
    return wrapDelta(degrees, 360);
  }

  // Whether a key event landed somewhere that wants the arrow keys for
  // itself, so a carousel's own key handling can stand down. A card or a
  // frame can hold arbitrary content, text fields and selects included, and
  // a carousel stealing Left/Right out from under a caret - preventDefault
  // included, so the caret doesn't even move - is a real bug rather than a
  // theoretical one. Home/End matter for the same reason.
  //
  // `closest` rather than an identity check, because the focused element may
  // be inside a contenteditable region rather than being the region itself.
  function ownsArrowKeys(target) {
    return !!(target && target.closest && target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ));
  }

  // Remembers one index per instance for the rest of the tab's session, so
  // navigating to an effect and back doesn't dump the visitor at item 0.
  // sessionStorage rather than localStorage: it should fade when the tab
  // does, not linger for weeks. Keyed off the root's own `id`, and an
  // element without one simply doesn't persist - there'd be nothing stable
  // to key on.
  //
  // `legacyPrefix` reads a second, older key as a fallback. Sweep is the one
  // that needs it: that effect was renamed from "carousel", and a tab left
  // open across the deploy still has its position saved under the old name.
  //
  // Every access is wrapped, because sessionStorage throws outright when
  // storage is disabled or full and failing to remember a scroll position is
  // never worth taking the whole effect down for.
  function createIndexMemory(root, prefix, legacyPrefix) {
    const key = root.id ? `${prefix}-pos:${root.id}` : null;
    const legacyKey = legacyPrefix && root.id ? `${legacyPrefix}-pos:${root.id}` : null;

    return {
      // The stored index, or null for "nothing remembered" - including when
      // what was stored isn't a number any more. Callers still have to clamp
      // or wrap it themselves: the item count may well have changed since.
      read() {
        if (!key) return null;
        try {
          let raw = sessionStorage.getItem(key);
          if (raw === null && legacyKey) raw = sessionStorage.getItem(legacyKey);
          if (raw === null) return null;
          const index = parseInt(raw, 10);
          return Number.isFinite(index) ? index : null;
        } catch (e) {
          return null;
        }
      },

      write(index) {
        if (!key) return;
        try {
          sessionStorage.setItem(key, String(index));
        } catch (e) {
          // Ignore - just means this one won't persist.
        }
      },
    };
  }

  // Hangs the static surface every effect here exposes off its constructor:
  // initAll/get/getAll, plus auto-init on DOMContentLoaded.
  //
  // `prepare` runs once per initAll call, before the page is scanned - each
  // effect passes its own style injection (and Deck its delegated
  // data-deck-* listeners). It runs even when nothing matches, which is the
  // point: a page whose only carousel is an empty placeholder still needs
  // the stylesheet that makes the placeholder look right.
  //
  // Instances are parked on the element itself (`__<slug>Instance`) rather
  // than in a module-level map, so an element removed from the page takes
  // its instance with it instead of leaking into a registry nothing prunes.
  // One consequence worth knowing: an element that was initialized and then
  // destroyed stays marked as claimed, so a later initAll() skips it rather
  // than quietly building a second instance over the first one's leftovers.
  //
  // Called at the very bottom of each effect's file, which is what puts its
  // DOMContentLoaded listener ahead of the demo page's own - the demos rely
  // on calling initAll() defensively after the effect already claimed
  // everything.
  function registerEffect(Ctor, { slug, selector, prepare }) {
    const prop = `__${slug}Instance`;

    Ctor.initAll = function initAll(sel = selector, options = {}) {
      if (prepare) prepare();
      return Array.from(document.querySelectorAll(sel))
        .filter((el) => !el[prop])
        .map((el) => {
          const instance = new Ctor(el, options);
          el[prop] = instance;
          return instance;
        });
    };

    Ctor.get = function get(elOrSelector) {
      if (!elOrSelector) return null;
      const el = typeof elOrSelector === 'string'
        ? document.querySelector(elOrSelector)
        : elOrSelector;
      return el ? el[prop] || null : null;
    };

    Ctor.getAll = function getAll(sel = selector) {
      return Array.from(document.querySelectorAll(sel))
        .map((el) => el[prop])
        .filter(Boolean);
    };

    document.addEventListener('DOMContentLoaded', () => Ctor.initAll());
  }

  global.CarouselKit = {
    clamp,
    mod,
    wrapDelta,
    wrapAngle,
    ownsArrowKeys,
    createIndexMemory,
    registerEffect,
  };
})(window);
