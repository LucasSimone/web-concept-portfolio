/**
 * Aperture
 * --------
 * A ring of camera-iris blades — curved white panels seamed with black
 * lines, just like a real diaphragm — spirals inward to seal shut over
 * whatever it's animating — the whole page during a navigation, or a
 * single element in place — then spirals back outward once whatever
 * it's covering is ready. One continuous motion split across the
 * cover/reveal boundary, same shape as Shutter's rise/recede but a
 * twisting iris in place of a sliding panel.
 *
 * The blades are real drawn shapes (not a mask trick): `blades` wedges
 * (default 8), each with two curved side edges (the seams shared with
 * its neighbors, stroked in `lineColor`) that sweep tangentially as they
 * run inward — the same look a real blade gets from pivoting around a
 * point out near the rim instead of the exact center — plus one curved
 * inner edge, a true circular arc, the same shape a real iris opening
 * traces. Filled in `color`. Their shared inner radius is driven by a
 * single registered custom property, `--t-aperture-progress` (0 =
 * sealed, 1 = wide open), which the browser transitions natively — a
 * requestAnimationFrame loop just samples its live computed value each
 * frame and rebuilds all the blade paths from it, since arbitrary path
 * geometry can't be CSS-transitioned directly. Each target (the page, or
 * an element) gets its own overlay `<div>`+`<svg>`, appended as a child
 * of that target — for the page-navigation target,
 * `document.documentElement`, that's built before `<body>` exists at
 * all (a non-deferred `<head>` script), which a fixed-position element
 * tolerates fine regardless of where in the tree it sits.
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="aperture.js"></script>` in `<head>`
 *    (a plain, non-async/defer tag) on every page that should take part.
 *    Off by default: nothing is intercepted until you set `selector` (see
 *    Options in the docs). Once enabled, it listens for clicks on the
 *    whole document and intercepts any matching same-origin link (opt a
 *    link out with `data-no-transition`). The cover/reveal only ever
 *    plays across a navigation it intercepted itself: a direct load,
 *    refresh, or bookmark visit renders normally with no overlay at all,
 *    and a destination page that doesn't also load this script just
 *    appears underneath once the exit cover finishes, with no reveal
 *    animation of its own.
 *
 * 2. Elements — mark any element `class="t-el"` and call
 *    `Transitions.aperture.play(el, { swap })` to seal it shut, run
 *    `swap(el)` once fully sealed, then spiral open again — e.g. to swap
 *    that element's content in place. `cover(el)`/`reveal(el)` are also
 *    public on their own for finer-grained control than `play`'s
 *    cover→swap→reveal shape. Blade geometry is derived from the target
 *    element's own size, and `overflow: hidden` is applied only while
 *    animating, so it never clips the element's normal content. Multiple
 *    elements (or repeated calls on the same one, e.g. to loop it) each
 *    animate independently — nothing is shared between them.
 *
 * Coexists with other transition effects on the same page: its
 * public API lives at `window.Transitions.aperture`, not a shared
 * name, and its config reads from `window.TransitionConfig.aperture`
 * — so a second effect's script (e.g. Shutter) can register alongside
 * it without either clobbering the other.
 *
 * A single call can override duration/easing/color/lineColor/blades/spin/
 * style for just that one transition, leaving every other link/call
 * using the page's default profile: a link's `data-t-duration`,
 * `data-t-easing`, `data-t-color`, `data-t-line-color`, `data-t-blades`,
 * `data-t-spin`, `data-t-style` attributes for navigation, or the same
 * fields passed straight into `cover`/`reveal`/`play` for elements. For
 * navigation, the chosen profile travels to the next page in the same
 * one-shot sessionStorage handoff already used to trigger the reveal, so
 * a customized cover and its matching reveal always agree, without
 * persisting anything.
 */
(function (global, document) {
  var NAME = 'aperture';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 't-aperture-styles';
  var PROGRESS_PROP = '--t-aperture-progress';
  var PENDING_KEY = 't-aperture-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var DEG2RAD = Math.PI / 180;
  var root = document.documentElement;

  // Per-style geometry: `skew` is how far a blade's outer anchor trails
  // its inner point (as a fraction of one blade's angular width) — the
  // pivot sweep described below — and `arcInner` is whether the inner
  // edge is a true circular arc (a rounded, near-circular opening) or a
  // straight chord (a faceted, more angular one, closer to a printed
  // lens-icon graphic).
  var BLADE_STYLES = {
    curved: { skew: 0.5, arcInner: true },
    sharp: { skew: 0.78, arcInner: false },
  };

  var DEFAULTS = {
    duration: 600, // ms for each half (close or open) of the motion
    easing: 'cubic-bezier(.65,0,.35,1)',
    color: '#fff', // blade panel fill
    lineColor: '#000', // blade seam / edge stroke
    spin: 70, // degrees the ring twists through as it opens/closes — the "spiral"
    blades: 8, // number of iris blades
    style: 'sharp', // 'curved' or 'sharp' — see BLADE_STYLES
    selector: null, // which links this page intercepts — off until set
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record — its own overlay/blade DOM, its own render loop,
  // its own profile — so two targets, or two overlapping calls on the
  // same one, never share or stomp each other. `gen` is bumped on every
  // cover()/reveal() call on that target; async steps check it's still
  // current before mutating anything, so a call superseded by a newer
  // one on the same target just fizzles instead of fighting it. ---
  var instances = new WeakMap();
  function instanceFor(el) {
    var inst = instances.get(el);
    if (!inst) {
      inst = { gen: 0, profile: options, overlay: null, renderHandle: null };
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
      '@property ' + PROGRESS_PROP + '{syntax:"<number>";inherits:true;initial-value:0;}' +
      // Required host class for any element target: gives the overlay a
      // positioning context, and clips blade overshoot at the element's
      // edge — but only while actually animating, so it never clips the
      // element's normal content the rest of the time. Neither rule is
      // needed by (or applied to) document.documentElement.
      '.t-el{position:relative;}' +
      '.t-el.t-aperture-active{overflow:hidden;}' +
      '.t-aperture-overlay{position:var(--t-aperture-position,fixed);inset:0;z-index:2147483647;display:none;pointer-events:none;}' +
      '.t-aperture-active .t-aperture-overlay{display:block;pointer-events:auto;}' +
      '.t-aperture-overlay svg{display:block;width:100%;height:100%;}' +
      '.t-aperture-blade{fill:var(--t-aperture-color,#fff);stroke:var(--t-aperture-line-color,#000);' +
      'stroke-width:2px;stroke-linejoin:round;}' +
      '.t-aperture-active{' + PROGRESS_PROP + ':0;}' + // 0 = sealed shut
      '.t-aperture-anim{transition:' + PROGRESS_PROP + ' var(--t-aperture-duration,600ms) ' +
      'var(--t-aperture-easing,cubic-bezier(.65,0,.35,1));}' +
      '.t-aperture-open{' + PROGRESS_PROP + ':1;}'; // 1 = wide open
    document.head.appendChild(style);
  }

  // Whether `el` is the page-nav target (document.documentElement) or an
  // arbitrary element — the one distinction applyProfile() and
  // layoutOverlay() each need to make, kept here so there's a single
  // place to change if that distinction ever grows a third case.
  function isRootTarget(el) {
    return el === root;
  }

  // The box to fit blades to: the viewport for the page-nav target
  // (unchanged from before elements existed), or the element's own
  // bounding box for everything else.
  function targetSize(el) {
    if (isRootTarget(el)) return { width: global.innerWidth, height: global.innerHeight };
    var rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function applyProfile(el, profile) {
    el.style.setProperty('--t-aperture-duration', profile.duration + 'ms');
    el.style.setProperty('--t-aperture-easing', profile.easing);
    el.style.setProperty('--t-aperture-color', profile.color);
    el.style.setProperty('--t-aperture-line-color', profile.lineColor);
    // Viewport-relative for the page-nav target, container-relative
    // (against .t-el's position:relative) for everything else.
    el.style.setProperty('--t-aperture-position', isRootTarget(el) ? 'fixed' : 'absolute');
  }

  // --- Overlay DOM: a ring of blade <path> elements per instance,
  // rebuilt to match that instance's profile's blade count and
  // recomputed every animation frame from the live
  // --t-aperture-progress value read off that instance's own target. ---
  function createOverlay(el) {
    var overlayEl = document.createElement('div');
    overlayEl.className = 't-aperture-overlay';
    var svg = document.createElementNS(SVG_NS, 'svg');
    var bladesGroup = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(bladesGroup);
    overlayEl.appendChild(svg);
    el.appendChild(overlayEl); // child of the target itself, root or element alike
    return { el: overlayEl, svg: svg, bladesGroup: bladesGroup, blades: [], geometry: { cx: 0, cy: 0, maxR: 0 } };
  }

  // Recomputes geometry for the target's current size and rebuilds the
  // blade elements if the profile's blade count changed. Cheap enough to
  // just rerun before every activation rather than track resize — this
  // only ever runs once per cover/reveal anyway. Root's overlay is sized
  // to the viewport (unchanged from before elements existed); any other
  // target is sized to its own bounding box.
  function layoutOverlay(inst, el, profile) {
    if (!inst.overlay) inst.overlay = createOverlay(el);
    var overlay = inst.overlay;
    // A play() swap that replaces el's content wholesale (el.textContent =
    // ..., el.innerHTML = ...) takes the overlay node down with it, even
    // though `overlay` (and its blade elements) are still alive in memory —
    // just detached. Re-append the same node rather than rebuilding it, so
    // reveal() picks up exactly where cover() left off. appendChild also
    // re-establishes it as the last child, so it still paints above
    // whatever the swap added, regardless of where that landed.
    if (overlay.el.parentNode !== el) el.appendChild(overlay.el);
    var size = targetSize(el);
    var w = size.width;
    var h = size.height;
    overlay.geometry.cx = w / 2;
    overlay.geometry.cy = h / 2;
    var n = Math.max(3, profile.blades | 0 || DEFAULTS.blades);
    // Corner distance plus a buffer, then inflated by 1/cos(half the
    // sector angle) — a blade's outer edge is a straight chord across
    // its sector, and a chord's midpoint sits closer to center than its
    // radius by exactly that factor, so without this a chord can dip
    // inside the corner and leave a sliver showing through.
    var cornerDist = Math.hypot(w / 2, h / 2) + 24;
    overlay.geometry.maxR = cornerDist / Math.cos(Math.PI / n);
    overlay.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    if (overlay.blades.length !== n) {
      overlay.bladesGroup.textContent = '';
      overlay.blades = [];
      for (var i = 0; i < n; i++) {
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('class', 't-aperture-blade');
        overlay.bladesGroup.appendChild(p);
        overlay.blades.push(p);
      }
    }
  }

  // Rebuilds every blade's path for the given progress (0 = sealed shut,
  // 1 = wide open). A real iris blade doesn't pivot around the exact
  // center — it pivots around a point out near the rim, which is what
  // makes its edges curve as they sweep toward their neighbor instead of
  // radiating out as straight spokes. Each blade's two side edges are a
  // quadratic curve from an outer anchor — offset backward from its
  // inner point by a `skew` angle (how far that trails, set per
  // `profile.style` — see BLADE_STYLES) — into that inner point, so the
  // curve sweeps sideways (tangentially) as well as inward. Both blades
  // sharing a seam compute that shared curve from the same absolute
  // angle, so they always meet exactly with no gap. The inner edge
  // between a blade's own two points is either a true circular arc (a
  // rounded, near-circular opening) or a straight chord (a faceted, more
  // angular one), again per style. At progress 0 that inner edge's
  // radius hits zero and everything collapses onto the center point,
  // giving the sealed blades their pointed tips.
  function renderBlades(inst, profile, progress) {
    var overlay = inst.overlay;
    if (!overlay) return;
    var blades = overlay.blades;
    var n = blades.length;
    if (!n) return;
    // Clamp: a custom easing (e.g. an overshooting "back" curve, valid via
    // a custom easing option) can carry the transitioning value outside
    // [0, 1] mid-flight, which would otherwise hand the SVG arc command
    // below a negative radius.
    progress = Math.min(1, Math.max(0, progress));
    var styleDef = BLADE_STYLES[profile.style] || BLADE_STYLES.curved;
    var cx = overlay.geometry.cx;
    var cy = overlay.geometry.cy;
    var maxR = overlay.geometry.maxR;
    var innerR = progress * maxR;
    var r = innerR.toFixed(2);
    var spinRad = profile.spin * (1 - progress) * DEG2RAD;
    var step = (Math.PI * 2) / n;
    var skew = step * styleDef.skew; // how far the outer anchor trails its inner point — the pivot sweep
    var midR = (maxR + innerR) / 2;

    function outer(angle) {
      var a = angle - skew;
      return (cx + maxR * Math.cos(a)).toFixed(1) + ',' + (cy + maxR * Math.sin(a)).toFixed(1);
    }
    function ctrl(angle) {
      var a = angle - skew / 2;
      return (cx + midR * Math.cos(a)).toFixed(1) + ',' + (cy + midR * Math.sin(a)).toFixed(1);
    }
    function inner(angle) {
      return (cx + innerR * Math.cos(angle)).toFixed(1) + ',' + (cy + innerR * Math.sin(angle)).toFixed(1);
    }

    for (var i = 0; i < n; i++) {
      var a0 = i * step - Math.PI / 2 + spinRad;
      var a1 = a0 + step;
      var innerEdge = styleDef.arcInner
        ? 'A' + r + ' ' + r + ' 0 0 1 ' + inner(a1)
        : 'L' + inner(a1);

      blades[i].setAttribute('d',
        'M' + outer(a0) +
        'Q' + ctrl(a0) + ' ' + inner(a0) +
        innerEdge +
        'Q' + ctrl(a1) + ' ' + outer(a1) + 'Z');
    }
  }

  // The custom property's live computed value is the only thing that
  // actually animates (the browser tweens it natively per `anim`'s
  // transition); this loop just samples it every frame — off the
  // instance's own target, since each target's classes/properties are
  // independent — and rebuilds the blade geometry to match, since path
  // data itself can't be CSS-transitioned. Runs for `durationMs` plus a
  // small buffer, then stops on its own.
  function stopRender(inst) {
    if (inst.renderHandle) {
      cancelAnimationFrame(inst.renderHandle);
      inst.renderHandle = null;
    }
  }
  function startRender(inst, el, profile) {
    stopRender(inst);
    var deadline = performance.now() + profile.duration + 80;
    function tick() {
      var raw = getComputedStyle(el).getPropertyValue(PROGRESS_PROP);
      var progress = parseFloat(raw);
      renderBlades(inst, profile, isFinite(progress) ? progress : 0);
      inst.renderHandle = performance.now() < deadline ? requestAnimationFrame(tick) : null;
    }
    inst.renderHandle = requestAnimationFrame(tick);
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
    stopRender(instanceFor(el));
    el.classList.remove('t-aperture-active', 't-aperture-anim', 't-aperture-open');
    activeElements.delete(el);
  }

  // A link's own data-t-duration/-easing/-color/-line-color/-blades/-spin/
  // -style, or an options object passed straight to cover/reveal/play,
  // win over the page's default profile field-by-field — every other
  // field keeps using `options`.
  function mergeProfile(overrides) {
    overrides = overrides || {};
    var duration = overrides.duration;
    var spin = overrides.spin;
    var bladeCount = overrides.blades;
    return {
      duration: (typeof duration === 'number' && isFinite(duration)) ? duration : options.duration,
      easing: overrides.easing || options.easing,
      color: overrides.color || options.color,
      lineColor: overrides.lineColor || options.lineColor,
      spin: (typeof spin === 'number' && isFinite(spin)) ? spin : options.spin,
      blades: (typeof bladeCount === 'number' && isFinite(bladeCount)) ? bladeCount : options.blades,
      style: (overrides.style && BLADE_STYLES[overrides.style]) ? overrides.style : options.style,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset;
    return {
      duration: ds.tDuration ? Number(ds.tDuration) : undefined,
      easing: ds.tEasing,
      color: ds.tColor,
      lineColor: ds.tLineColor,
      spin: ds.tSpin ? Number(ds.tSpin) : undefined,
      blades: ds.tBlades ? Number(ds.tBlades) : undefined,
      style: ds.tStyle,
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
      layoutOverlay(inst, el, profile);
      el.classList.add('t-aperture-active', 't-aperture-open'); // start fully open, no transition yet
      activeElements.add(el);
      renderBlades(inst, profile, 1);

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-aperture-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.remove('t-aperture-open'); // animates progress 1 -> 0: seals shut
          startRender(inst, el, profile);
        });
      });

      var resolved = false;
      function finish() {
        if (resolved) return;
        resolved = true;
        resolve();
      }
      el.addEventListener('transitionend', function handler(e) {
        // transitionend bubbles, so without the target check some unrelated
        // descendant finishing a transition on a same-named property (e.g.
        // a future page-specific animation) could fire this early.
        if (e.target !== el || e.propertyName !== PROGRESS_PROP) return;
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

      applyProfile(el, profile);
      // Re-measures el even if cover() just did the same thing moments
      // ago — not a no-op, but a deliberate one: swap() may have resized
      // el between cover() and reveal(), and this is what lets the iris
      // open back up against el's current size rather than its stale one.
      layoutOverlay(inst, el, profile);
      el.classList.add('t-aperture-active'); // harmless no-op if cover() already set this
      activeElements.add(el);
      renderBlades(inst, profile, 0); // sealed, before any transition has run

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-aperture-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.add('t-aperture-open');
          startRender(inst, el, profile);
        });
      });

      setTimeout(function () {
        if (myGen === inst.gen) cleanupEl(el);
        resolve();
      }, profile.duration + 60);
    });
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so the sealed iris (if any) is
  // on screen before the rest of the page ever paints. Whatever profile
  // the departing page used travels along in the same handoff, so the
  // reveal matches the cover even if it was a customized one. Skipped
  // entirely under reduced motion, same as the departure side. ---
  var pending = readPending();
  var arrivingProfile = prefersReducedMotion() ? null : pending;
  if (arrivingProfile) {
    var rootInst = instanceFor(root);
    rootInst.profile = arrivingProfile;
    applyProfile(root, arrivingProfile);
    layoutOverlay(rootInst, root, arrivingProfile);
    root.classList.add('t-aperture-active');
    activeElements.add(root);
    renderBlades(rootInst, arrivingProfile, 0); // sealed, before any transition has run
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

  // --- Departure: close the iris, then hand off to the next page. ---
  function closeThenNavigate(url, overrides) {
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
    closeThenNavigate(a.href, datasetToOverrides(a));
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
    // resolving once fully sealed. Leaves `el` covered — pair with reveal().
    cover: cover,
    // Reveals `el`, resolving once fully open and cleaned up.
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
