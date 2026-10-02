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
 * look almost identical on the page, but Reel settles with a spring and
 * Deck interpolates a timed step, and Sweep's phase model is different
 * again. Folding those into one loop with a configuration object for every
 * difference would be longer and harder to follow than the explicit copies,
 * so each effect keeps its own.
 *
 * The self-advancing timer, on the other hand, *is* here: every reason a
 * carousel should hold still (hovered, dragged, off screen, hidden tab,
 * reduced motion) and every way a non-looping one can behave when it runs
 * out of items are the same question four times over, and the answer has
 * no business differing between them. See createAutoplay.
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

  // Which item a public to()/jump() call actually lands on, for the
  // arbitrary number a caller is entitled to pass. A looping carousel
  // reduces it round the loop, which is what makes to(-1) mean "the last
  // one" and to(n) mean "back to the first". One with two ends must not:
  // wrapping there would answer an index past the end with the item at the
  // *other* end, which is the one move the mode exists to prevent - so it
  // clamps, and to(99) means "as far as this goes". Shared so the two
  // answers don't drift between the four, since nothing about either is
  // particular to a strip, a ring, a disc or a frame changer.
  function resolveIndex(index, n, loop) {
    return loop ? mod(Math.round(index), n) : clamp(Math.round(index), 0, n - 1);
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

  // Floor on the autoplay interval. A carousel asked to advance every 10ms
  // would spend its entire life mid-transition and read as a blur rather
  // than as a carousel, so the option is floored rather than trusted.
  const MIN_AUTOPLAY_MS = 200;

  // How long a 'rewind' is given to arrive before beats resume regardless.
  // A rewind crosses the whole carousel in one move, which takes longer
  // than the single step a beat normally issues, so at a short interval
  // the next beat would land mid-flight and cut the spool-back short a
  // card or two from the start. Beats are held until it lands - but only
  // for so long, because anything at all can happen to the position in
  // between (a drag, a click, a to() of the host's own), and a wait with
  // no deadline could be left holding for a landing that is never coming.
  //
  // It is a wall clock rather than anything that watches the carousel
  // move, which is the honest tradeoff to know about: a long carousel on a
  // deliberately lazy spring - a low `snapStrength` against a high
  // `friction`, the "floaty" end of the demo profiles - can still be
  // travelling when the deadline passes, and the beat that follows cuts
  // the rewind short. Deciding by progress instead would mean telling
  // "crawling" apart from "stopped" between two beats, and the index is
  // rounded to whole items, so a slow enough spring reads as stopped at
  // exactly the moment it most needs not to. The cure for a rewind that
  // gets cut off is a firmer spring or a longer `autoplay` interval, not a
  // longer deadline here - stretching this only widens the window in which
  // a carousel someone has grabbed sits waiting on a landing that isn't
  // coming.
  const REWIND_GRACE_MS = 2500;

  // The self-advancing timer, shared by all four carousels.
  //
  // `host` supplies the public surface this drives - `options.autoplay`
  // (milliseconds between advances; 0 is off), `options.autoplayEnd`, the
  // `length` and `index` getters, and step/to/jump. The two callbacks are
  // what genuinely differ per effect:
  //
  //   blocked()  whether this instant is a bad time to advance - hovered,
  //              mid-drag, mid-scroll, off screen, in a hidden tab. A
  //              blocked beat is *skipped* rather than rescheduled, which
  //              keeps the cadence steady across a hover that starts and
  //              ends mid-interval.
  //   looping()  whether the carousel currently wraps. A looping one just
  //              advances forever and `autoplayEnd` never comes up.
  //
  // What a non-looping one does on reaching the last item is
  // `options.autoplayEnd`:
  //
  //   'rewind'  travel continuously back through every item to the first,
  //             then carry on forward. The default - it reads as the strip
  //             spooling back, and it's what a visitor expects from a
  //             carousel that has visibly run out of cards.
  //   'bounce'  reverse and walk back one item per beat, ping-ponging
  //             between the two ends.
  //   'jump'    hold at the last item for one beat, then cut straight to
  //             the first with no travel through the middle.
  //   'stop'    park at the last item. The timer keeps running rather than
  //             being torn down, so moving the carousel off the end by hand
  //             - a click, a drag, a step() call - has it pick up again
  //             from there instead of needing play(). Anything
  //             unrecognized is treated as this, so a typo parks the
  //             carousel rather than throwing.
  //
  // prefers-reduced-motion is honored here, listener and all: an autoplay
  // timer is either created or not, so unlike the options that are re-read
  // every frame it can't track a live change to the query on its own.
  function createAutoplay(host, { blocked, looping }) {
    let timer = null;
    // Which way the next beat steps. Only ever -1 in 'bounce', and only
    // while walking back from the far end.
    let direction = 1;
    // Set by pause(), cleared by play(). Separate from "the timer happens
    // not to exist right now" so that a pause() survives the sync() that a
    // later update() or visibility change triggers.
    let paused = false;
    // Deadline for a 'rewind' in flight, or 0 when none is - see
    // REWIND_GRACE_MS.
    let rewindUntil = 0;

    const reduced = global.matchMedia
      ? global.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    function beat() {
      if (blocked()) return;
      const n = host.length;
      if (n < 2) return;

      if (rewindUntil) {
        if (host.index !== 0 && Date.now() < rewindUntil) return;
        rewindUntil = 0;
        // The beat that finds the rewind landed is spent on the arrival
        // rather than immediately stepping off it, so the first item gets
        // a full interval of its own - the same dwell every other item
        // got on the way out. Without this it holds the screen for only
        // whatever was left of the beat the landing happened to fall in.
        return;
      }

      if (looping()) {
        host.step(1);
        return;
      }

      const last = n - 1;
      if (direction > 0 && host.index >= last) {
        switch (host.options.autoplayEnd) {
          case 'bounce':
            direction = -1;
            host.step(-1);
            break;
          case 'rewind':
            host.to(0);
            rewindUntil = Date.now() + REWIND_GRACE_MS;
            break;
          case 'jump':
            host.jump(0);
            break;
          default:
            // 'stop' - hold here, see above.
        }
        return;
      }
      // Only 'bounce' ever gets here with direction -1, and this is the
      // other end of its swing.
      if (direction < 0 && host.index <= 0) direction = 1;
      host.step(direction);
    }

    const autoplay = {
      // Rebuilds the timer from the current options. Call after anything
      // that could change whether or how fast it should run - update(), an
      // item count change - and on a visibility change, which is a
      // different matter: the timer is left running in a hidden tab (its
      // beats are simply blocked), but the browser throttles the interval
      // itself to roughly once a minute there, so what it would resume on
      // is whatever phase the throttle happened to leave it in. Rebuilding
      // it on the way back gives the first visible beat a full interval.
      sync() {
        clearInterval(timer);
        timer = null;
        // While looping there are no ends, so a 'bounce' has no swing to
        // be part way through and `direction` means nothing - which makes
        // this the safe moment to forget it. It's also the necessary one:
        // `loop` only ever changes through the host's update(), which
        // lands here, so a carousel looped and then unlooped again would
        // otherwise resume an old swing and walk backwards out of the
        // middle of itself. Deliberately not done when it isn't looping -
        // sync() runs on a visibility change too, and a tab coming back
        // shouldn't forget which way the thing was going.
        if (looping()) direction = 1;
        const every = host.options.autoplay;
        // `!(every > 0)` rather than a pair of tests: it covers 0, a
        // negative, and the undefined/NaN a bad option value arrives as.
        if (paused || !(every > 0) || host.length < 2) return;
        if (reduced && reduced.matches) return;
        timer = setInterval(beat, Math.max(MIN_AUTOPLAY_MS, every));
      },

      // sync(), plus forgetting which way a 'bounce' was swinging. For
      // refresh(), which puts the carousel back at the start.
      reset() {
        direction = 1;
        rewindUntil = 0;
        autoplay.sync();
      },

      play() {
        paused = false;
        autoplay.sync();
      },

      pause() {
        paused = true;
        clearInterval(timer);
        timer = null;
      },

      // Whether the timer is actually running - false for an explicit
      // pause(), for `autoplay: 0`, under reduced motion, and on a
      // carousel with nothing to advance to. Note this says nothing about
      // whether a *beat* would currently be blocked: a hovered carousel is
      // still playing, it's just holding still.
      get playing() {
        return timer !== null;
      },

      destroy() {
        clearInterval(timer);
        timer = null;
        if (reduced && reduced.removeEventListener) {
          reduced.removeEventListener('change', onReducedChange);
        }
      },
    };

    function onReducedChange() {
      autoplay.sync();
    }
    if (reduced && reduced.addEventListener) {
      reduced.addEventListener('change', onReducedChange);
    }

    return autoplay;
  }

  // The navigation and playback methods that are pure derivations of what
  // each effect already implements for itself - `step`, `to`, `jump`, the
  // `length` getter and an autoplay controller parked on `_auto`. Mixed
  // into the prototype rather than written out four times, because there is
  // exactly one correct body for each of them and a host calling `.next()`
  // on one carousel should not have to check whether that particular one
  // got it.
  function addCommonApi(proto) {
    // Advance/retreat by whole items. `count` on top of direction so that
    // next(3) reads as "three forward" rather than needing step(1, 3).
    proto.next = function next(count = 1) {
      this.step(1, count);
    };

    proto.prev = function prev(count = 1) {
      this.step(-1, count);
    };

    // The ends, by whatever route `to` takes - which on a looping carousel
    // is the shortest way round, so `first()` from the last item is one
    // step forward rather than a full lap back.
    proto.first = function first() {
      this.to(0);
    };

    proto.last = function last() {
      this.to(this.length - 1);
    };

    proto.play = function play() {
      this._auto.play();
    };

    proto.pause = function pause() {
      this._auto.pause();
    };

    Object.defineProperty(proto, 'playing', {
      configurable: true,
      get() {
        return this._auto.playing;
      },
    });
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
    resolveIndex,
    ownsArrowKeys,
    createIndexMemory,
    createAutoplay,
    addCommonApi,
    registerEffect,
  };
})(window);
