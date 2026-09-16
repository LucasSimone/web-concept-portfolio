/**
 * Shutter
 * -------
 * A black panel that rises from one edge to cover whatever it's animating
 * — the whole page during a navigation, or a single element in place —
 * then recedes back down to reveal what's underneath, once whatever it's
 * covering is ready. One continuous vertical motion split across the
 * cover/reveal boundary.
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="shutter.js"></script>` in `<head>`
 *    (a plain, non-async/defer tag) on every page that should take part.
 *    Off by default: nothing is intercepted until you set `selector` (see
 *    Options in the docs), since most sites want this opt-in rather than
 *    every link on the page suddenly navigating through an overlay. Once
 *    enabled, it listens for clicks on the whole document and intercepts
 *    any matching same-origin link (opt a link out with
 *    `data-no-transition`). The cover/reveal only ever plays across a
 *    navigation it intercepted itself: a direct load, refresh, or bookmark
 *    visit renders normally with no overlay at all, and a destination page
 *    that doesn't also load this script just appears underneath once the
 *    exit cover finishes, with no reveal animation of its own.
 *
 * 2. Elements — mark any element `class="t-el"` and call
 *    `Transitions.shutter.play(el, { swap })` to cover it, run `swap(el)`
 *    once it's fully covered, then reveal — e.g. to swap that element's
 *    content in place. `cover(el)`/`reveal(el)` are also public on their
 *    own for finer-grained control than `play`'s cover→swap→reveal shape.
 *    Multiple elements (or repeated calls on the same one, e.g. to loop
 *    it) each animate independently — nothing is shared between them.
 *
 * Coexists with other transition effects on the same page (e.g. a site
 * demoing several): its public API lives at `window.Transitions.shutter`,
 * not a shared name, and its config reads from
 * `window.TransitionConfig.shutter`, not a shared object — so a second
 * effect's script can register alongside it without either clobbering
 * the other.
 *
 * A single call can override duration/easing/color for just that one
 * transition, leaving every other link/call using the page's default
 * profile: a link's `data-t-duration`/`-easing`/`-color` attributes for
 * navigation, or the same fields passed straight into
 * `cover`/`reveal`/`play` for elements. For navigation, the chosen profile
 * travels to the next page in the same one-shot sessionStorage handoff
 * already used to trigger the reveal, so a customized cover and its
 * matching reveal always agree, without persisting anything.
 */
(function (global, document) {
  var NAME = 'shutter';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var STYLE_ID = 't-shutter-styles';
  var PENDING_KEY = 't-shutter-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var root = document.documentElement;

  var DEFAULTS = {
    duration: 550, // ms for each half (cover or reveal) of the motion
    easing: 'cubic-bezier(.65,0,.35,1)',
    color: '#000',
    selector: null, // which links this page intercepts — off until set
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record, so two targets — or two overlapping calls on the
  // same one — never share or stomp each other's profile/animation
  // state. `gen` is bumped on every cover()/reveal() call on that
  // target; async steps check it's still current before mutating
  // anything, so a call superseded by a newer one on the same target
  // just fizzles instead of fighting it — see cover()/reveal(). ---
  var instances = new WeakMap();
  function instanceFor(el) {
    var inst = instances.get(el);
    if (!inst) {
      inst = { gen: 0, profile: options };
      instances.set(el, inst);
    }
    return inst;
  }

  // Elements currently mid-cover/covered, tracked outside the WeakMap
  // (which isn't iterable) purely so bfcache restoration (see the
  // `pageshow` listener below) can snap every one of them back to a
  // clean state, not just the navigation target.
  var activeElements = new Set();

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      // Required host class for any element target: gives the overlay's
      // ::before a positioning context to size itself against. Not
      // applied to (or needed by) document.documentElement — a `fixed`
      // overlay is already viewport-relative regardless of its position.
      '.t-el{position:relative;}' +
      '.t-shutter-active::before{content:"";position:var(--t-shutter-position,fixed);inset:0;' +
      'background:var(--t-shutter-color,#000);z-index:2147483647;pointer-events:auto;' +
      'transform:scaleY(1);transform-origin:bottom;}' +
      '.t-shutter-anim::before{transition:transform var(--t-shutter-duration,550ms) ' +
      'var(--t-shutter-easing,cubic-bezier(.65,0,.35,1));}' +
      '.t-shutter-open::before{transform:scaleY(0);}';
    document.head.appendChild(style);
  }

  function applyProfile(el, profile) {
    el.style.setProperty('--t-shutter-duration', profile.duration + 'ms');
    el.style.setProperty('--t-shutter-easing', profile.easing);
    el.style.setProperty('--t-shutter-color', profile.color);
    // Viewport-relative for the page-nav target, container-relative
    // (against .t-el's position:relative) for everything else.
    el.style.setProperty('--t-shutter-position', el === root ? 'fixed' : 'absolute');
  }

  injectStyles();
  applyProfile(root, options);

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function readPending() {
    try {
      var raw = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.ts >= PENDING_TTL) return null;
      return data.profile;
    } catch (e) {
      return null;
    }
  }

  function setPending(profile) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now(), profile: profile }));
    } catch (e) {}
  }

  function cleanupEl(el) {
    el.classList.remove('t-shutter-active', 't-shutter-anim', 't-shutter-open');
    activeElements.delete(el);
  }

  // A link's own data-t-duration/-easing/-color, or an options object
  // passed straight to cover/reveal/play, win over the page's default
  // profile field-by-field — every other field keeps using `options`.
  function mergeProfile(overrides) {
    overrides = overrides || {};
    var duration = overrides.duration;
    return {
      duration: (typeof duration === 'number' && isFinite(duration)) ? duration : options.duration,
      easing: overrides.easing || options.easing,
      color: overrides.color || options.color,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset;
    return {
      duration: ds.tDuration ? Number(ds.tDuration) : undefined,
      easing: ds.tEasing,
      color: ds.tColor,
    };
  }

  // --- The two primitives every use (navigation or element) is built
  // from. Both resolve (never reject) and both tolerate being superseded
  // by a newer call on the same target mid-flight: the stale call's
  // promise still resolves (bounded by its own fallback timer below), it
  // just stops short of mutating anything once a newer `gen` has taken
  // over. ---

  function cover(el, overrides) {
    var inst = instanceFor(el);
    var profile = mergeProfile(overrides);
    inst.profile = profile;
    var myGen = ++inst.gen;

    return new Promise(function (resolve) {
      if (prefersReducedMotion()) {
        applyProfile(el, profile);
        resolve();
        return;
      }

      applyProfile(el, profile);
      el.classList.add('t-shutter-active', 't-shutter-open'); // start hidden, no transition yet
      activeElements.add(el);

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-shutter-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.remove('t-shutter-open'); // animates scaleY 0 -> 1: covers
        });
      });

      var resolved = false;
      function finish() {
        if (resolved) return;
        resolved = true;
        resolve();
      }
      el.addEventListener('transitionend', function handler(e) {
        // transitionend bubbles, so without the target check a transform
        // transition finishing on some unrelated descendant (e.g. the
        // controls panel opening/closing mid-cover) would fire this early.
        if (e.target !== el || e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', handler);
        finish();
      });
      setTimeout(finish, profile.duration + 150); // fallback if transitionend never fires (also bounds a superseded call)
    });
  }

  function reveal(el, overrides) {
    var inst = instanceFor(el);
    var profile = overrides ? mergeProfile(overrides) : (inst.profile || options);
    inst.profile = profile;
    var myGen = ++inst.gen;

    return new Promise(function (resolve) {
      if (prefersReducedMotion()) {
        cleanupEl(el);
        resolve();
        return;
      }

      el.classList.add('t-shutter-active'); // harmless no-op if cover() already set this
      activeElements.add(el);

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-shutter-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.add('t-shutter-open');
        });
      });

      setTimeout(function () {
        if (myGen === inst.gen) cleanupEl(el);
        resolve();
      }, profile.duration + 60);
    });
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so the cover (if any) is on
  // screen before the rest of the page ever paints. Whatever profile the
  // departing page used travels along in the same handoff, so the reveal
  // matches the cover even if it was a customized one. Skipped entirely
  // under reduced motion — the departure side never showed a cover for
  // the same reason, so there's nothing here to reveal either; showing
  // the overlay just to immediately clean it up at DOMContentLoaded would
  // be a static color flash with no motion to justify it. ---
  // readPending() always runs (it also clears the flag) — reduced motion
  // just means we ignore what it found instead of acting on it.
  var pending = readPending();
  var arrivingProfile = prefersReducedMotion() ? null : pending;
  if (arrivingProfile) {
    var rootInst = instanceFor(root);
    rootInst.profile = arrivingProfile;
    applyProfile(root, arrivingProfile);
    root.classList.add('t-shutter-active');
    activeElements.add(root);
  }

  function onReady() {
    if (arrivingProfile) reveal(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  global.addEventListener('pageshow', function (event) {
    // Returning via bfcache can restore the DOM mid-animation; snap every
    // still-active target (not just the navigation one) back to a clean,
    // uncovered state instead of replaying anything.
    if (!event.persisted) return;
    Array.from(activeElements).forEach(cleanupEl);
  });

  // --- Departure: cover, then hand off to the next page. ---
  function coverThenNavigate(url, overrides) {
    cover(root, overrides).then(function () {
      setPending(instanceFor(root).profile);
      global.location.href = url;
    });
  }

  function eligible(a) {
    if (!a || !a.href) return false;
    if (a.hasAttribute('data-no-transition')) return false;
    if (a.hasAttribute('download')) return false;
    if (a.target && a.target !== '' && a.target !== '_self') return false;
    var url;
    try { url = new URL(a.href, global.location.href); } catch (e) { return false; }
    if (url.origin !== global.location.origin) return false;
    // same-page hash link: leave it to the browser
    if (url.hash && url.pathname === global.location.pathname && url.search === global.location.search) return false;
    return true;
  }

  document.addEventListener('click', function (event) {
    if (!options.selector) return; // navigation is off until a page sets one
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target.closest && event.target.closest(options.selector);
    if (!eligible(a)) return;
    event.preventDefault();
    coverThenNavigate(a.href, datasetToOverrides(a));
  });

  global.Transitions[NAME] = {
    configure: function (opts) {
      Object.assign(options, opts || {});
      // A page's own <head> fragment typically calls this just to widen
      // `selector` (see the demo pages) — it runs before DOMContentLoaded,
      // right after an arriving page has already applied the profile it's
      // mid-handoff with. Re-applying the page's default profile here
      // would stomp that arriving profile before its reveal ever plays, so
      // skip it while one is in flight; the reveal itself never touches
      // these properties again once it's running.
      if (!arrivingProfile) applyProfile(root, options);
    },
    // Covers `el` (any element with class="t-el", or document.documentElement),
    // resolving once fully covered. Leaves `el` covered — pair with reveal().
    cover: cover,
    // Reveals `el`, resolving once fully revealed and cleaned up.
    reveal: reveal,
    // Sugar for "transition this element's content in place": cover el,
    // run options.swap(el) (may return a promise) once covered, then
    // reveal. Not part of the navigation flow above — that has no
    // same-document reveal to chain into, so it uses cover()/reveal()
    // directly instead.
    play: function (el, overrides) {
      overrides = overrides || {};
      return cover(el, overrides).then(function () {
        return overrides.swap ? overrides.swap(el) : undefined;
      }).then(function () {
        return reveal(el, overrides);
      });
    },
  };
})(window, document);
