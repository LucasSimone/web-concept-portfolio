/**
 * Power Off
 * ---------
 * An old CRT switching off: the picture collapses from the top and bottom
 * into a single bright horizontal line, the line pulls in from both ends
 * to a glowing dot in the middle, and the dot fades out to a black
 * screen. Once whatever it's covering is ready, the reveal plays the same
 * motion back as the set powering on: dot, line, then the picture opening
 * out to full height. One continuous cover/reveal motion split across the
 * cover/reveal boundary, same shape as Shutter, Aperture, Static and
 * Inkblot.
 *
 * The overlay is one element, the "slot": the part of the screen still
 * lit. A box-shadow with a huge spread paints the screen color everywhere
 * outside it, so the slot is a clear window onto the page underneath. A
 * second, blurred shadow on top of that is the glow bleeding off the
 * line, and a layer inside the slot washes whatever is still showing
 * toward the glow color as it narrows, so by the time it's a line it's
 * pure light. Each frame is a pure function of progress (0 = open,
 * 1 = off), so the fully covered frame is always just the screen color
 * and the next page can pick up from it exactly with nothing but the
 * profile in the handoff.
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="power-off.js"></script>` in `<head>`
 *    (a plain, non-async/defer tag) on every page that should take part.
 *    Off by default: nothing is intercepted until you set `selector` (see
 *    Options in the docs). Once enabled, it listens for clicks on the
 *    whole document and intercepts any matching same-origin link (opt a
 *    link out with `data-no-transition`). The cover/reveal only ever plays
 *    across a navigation it intercepted itself: a direct load, refresh, or
 *    bookmark visit renders normally with no overlay at all, and a
 *    destination page that doesn't also load this script just appears
 *    once the exit cover finishes, with no reveal of its own.
 *
 * 2. Elements — mark any element `class="t-el"` and call
 *    `Transitions['power-off'].play(el, { swap })` to cover it, run
 *    `swap(el)` once it's off, then reveal. `cover(el)`/`reveal(el)` are
 *    also public on their own. Multiple elements (or repeated calls on the
 *    same one) each animate independently.
 *
 * Coexists with other transition effects on the same page: its public API
 * lives at `window.Transitions['power-off']` and its config reads from
 * `window.TransitionConfig['power-off']`, so a second effect's script can
 * register alongside it without either clobbering the other.
 *
 * A single call can override duration/easing/color/glow for just that one
 * transition: a link's `data-t-duration`/`-easing`/`-color`/`-glow`
 * attributes for navigation, or the same fields passed straight into
 * `cover`/`reveal`/`play` for elements. For navigation, the chosen profile
 * travels to the next page in the same one-shot sessionStorage handoff
 * that triggers the reveal, so a customized cover and its matching reveal
 * always agree, without persisting anything.
 */
(function (global, document) {
  var NAME = 'power-off';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var STYLE_ID = 't-power-off-styles';
  var PENDING_KEY = 't-power-off-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var root = document.documentElement;

  // Where each stage ends, as a share of the motion. Collapsing to the
  // line takes the first half; pulling the line in to a dot most of the
  // rest; the dot fading out the last stretch.
  var LINE_AT = 0.5;
  var DOT_AT = 0.8;

  var DEFAULTS = {
    duration: 1000, // ms for each half (power off or power on) of the motion
    easing: 'linear', // the stages already have their own pacing (see frame())
    color: '#000', // the switched-off screen
    glow: '#fff', // the line, the dot, and the light bleeding off them
    selector: null, // which links this page intercepts — off until set
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // --- Easing: progress is driven from rAF (every frame is computed from
  // it), so the CSS easing string the other transitions hand straight to
  // a `transition` is parsed into a function here instead, same as
  // inkblot.js: the keywords, plus any cubic-bezier(). Anything else
  // falls back to linear. ---
  var EASING_KEYWORDS = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  function cubicBezier(x1, y1, x2, y2) {
    function at(a, b, t) {
      return 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
    }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      // x(t) is monotonic for valid control points, so bisection always
      // converges; 20 steps is well past what a frame can show.
      var lo = 0;
      var hi = 1;
      for (var i = 0; i < 20; i++) {
        var mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < x) lo = mid; else hi = mid;
      }
      return at(y1, y2, (lo + hi) / 2);
    };
  }
  var easingCache = {};
  function easingFn(easing) {
    var key = String(easing || '').trim();
    if (easingCache[key]) return easingCache[key];
    var points = EASING_KEYWORDS[key];
    var m = /^cubic-bezier\(\s*([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(key);
    if (m) {
      var parsed = m.slice(1).map(Number);
      if (parsed.every(isFinite)) points = parsed;
    }
    if (!points) points = EASING_KEYWORDS.linear;
    easingCache[key] = cubicBezier(points[0], points[1], points[2], points[3]);
    return easingCache[key];
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function smoothstep(lo, hi, v) {
    var t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record — its own overlay, size, progress and animation — so
  // two targets never share or stomp each other. `progress` is how far
  // off the target is right now (0–1); a new cover()/reveal() picks up
  // from wherever the last one left it, so reversing mid-motion turns
  // around instead of jumping. `gen` is bumped on every call; a
  // superseded call's promise still resolves, it just stops touching
  // anything. ---
  var instances = new WeakMap();
  function instanceFor(el) {
    var inst = instances.get(el);
    if (!inst) {
      inst = { gen: 0, profile: options, overlay: null, size: null, progress: 0, animHandle: null };
      instances.set(el, inst);
    }
    return inst;
  }

  // Elements currently mid-cover/covered, tracked outside the WeakMap
  // (which isn't iterable) purely so bfcache restoration can snap every
  // one of them back to a clean state, not just the navigation target.
  var activeElements = new Set();

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      // Required host class for any element target: gives the overlay a
      // positioning context. Not needed by document.documentElement — a
      // `fixed` overlay is already viewport-relative.
      '.t-el{position:relative;}' +
      // Topmost by default, so the screen covers everything in the target.
      // A host that wants something of its own to show above it (e.g. a
      // label once it's off) lowers --t-power-off-z on the target and
      // raises that one thing above it (same hook as inkblot.js's).
      '.t-power-off-overlay{position:var(--t-power-off-position,fixed);inset:0;' +
      'z-index:var(--t-power-off-z,2147483647);display:none;pointer-events:none;overflow:hidden;}' +
      // Child combinator, not descendant: document.documentElement is an
      // ancestor of every element target, so a descendant match would
      // also show any element's leftover overlay whenever root is covered
      // (same reason as in static.js).
      '.t-power-off-active > .t-power-off-overlay{display:block;pointer-events:auto;}' +
      '.t-power-off-slot{position:absolute;left:0;top:0;}' +
      // The wash: the glow color laid over what's still showing through
      // the slot, faded in as it narrows.
      '.t-power-off-slot::before{content:"";position:absolute;inset:0;border-radius:inherit;' +
      'background:var(--t-power-off-glow,#fff);opacity:var(--t-power-off-wash,0);}';
    document.head.appendChild(style);
  }

  function isRootTarget(el) {
    return el === root;
  }

  // The overlay's own box, since the slot is centered in px inside it:
  // the viewport minus any scrollbar for the page-nav target, and el's
  // padding box (inside its border) for elements. Layout size, not
  // getBoundingClientRect(), so a scaled el (the homepage's Transition
  // Lab carousel scales its cards) doesn't get a slot sized to its
  // on-screen footprint, off-center and too small.
  function targetSize(el) {
    return { width: el.clientWidth, height: el.clientHeight };
  }

  function applyProfile(el) {
    // Viewport-relative for the page-nav target, container-relative
    // (against .t-el's position:relative) for everything else.
    el.style.setProperty('--t-power-off-position', isRootTarget(el) ? 'fixed' : 'absolute');
  }

  function createOverlay(el) {
    var overlayEl = document.createElement('div');
    overlayEl.className = 't-power-off-overlay';
    var slot = document.createElement('div');
    slot.className = 't-power-off-slot';
    overlayEl.appendChild(slot);
    el.appendChild(overlayEl);
    return { el: overlayEl, slot: slot, color: DEFAULTS.color, glow: [255, 255, 255] };
  }

  // Offscreen 1x1 canvas used to let the browser's own CSS color parser
  // turn any valid color string into RGB bytes (see static.js). Only the
  // glow needs this, for the halo's per-frame alpha.
  var colorParseCtx = null;
  function colorToRGB(color, fallback) {
    if (!colorParseCtx) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      colorParseCtx = c.getContext('2d', { willReadFrequently: true });
    }
    colorParseCtx.clearRect(0, 0, 1, 1);
    colorParseCtx.fillStyle = fallback;
    colorParseCtx.fillStyle = color;
    colorParseCtx.fillRect(0, 0, 1, 1);
    var d = colorParseCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  // Measures the target and applies the profile's colors. Rerun before
  // every cover/reveal rather than tracking resize: swap() may have
  // resized an element in between.
  function layoutOverlay(inst, el, profile) {
    if (!inst.overlay) inst.overlay = createOverlay(el);
    var overlay = inst.overlay;
    // A swap that replaces el's content wholesale takes the overlay node
    // with it; re-append the same node so reveal() picks up where cover()
    // left off (see static.js).
    if (overlay.el.parentNode !== el) el.appendChild(overlay.el);
    overlay.color = profile.color;
    overlay.glow = colorToRGB(profile.glow, DEFAULTS.glow);
    overlay.slot.style.setProperty('--t-power-off-glow', profile.glow);
    inst.size = targetSize(el);
  }

  // The slot at progress `p` (0 = open, 1 = off) in a W×H target: its
  // size, how far it's washed to the glow color, how strong the halo is,
  // and its corner radius. Each stage has its own pacing built in, so the
  // default easing is linear. Shared by cover and reveal, so the power-on
  // is exactly the power-off run backward.
  function frame(p, W, H) {
    var line = clamp(H * 0.006, 2, 6); // the line's thickness
    var dot = clamp(Math.min(W, H) * 0.025, 4, 16); // the dot's diameter
    var w;
    var h;
    var wash;
    var halo;
    var radius;
    if (p <= LINE_AT) {
      // Top and bottom collapse in, slow at first and then all at once,
      // washing out to light as the picture squeezes.
      var u = p / LINE_AT;
      w = W;
      h = H - (H - line) * u * u;
      wash = smoothstep(0.15, 0.9, u);
      halo = smoothstep(0.35, 1, u);
      radius = (line / 2) * smoothstep(0.85, 1, u);
    } else if (p <= DOT_AT) {
      // The line pulls in from both ends, thickening into the dot at the
      // very end.
      var v = (p - LINE_AT) / (DOT_AT - LINE_AT);
      w = W - (W - dot) * smoothstep(0, 1, v);
      h = line + (dot - line) * smoothstep(0.6, 1, v);
      wash = 1;
      halo = 1;
      radius = h / 2;
    } else {
      // The dot lingers, then shrinks away as its glow fades.
      var s = (p - DOT_AT) / (1 - DOT_AT);
      w = h = dot * (1 - s * s);
      wash = 1;
      halo = 1 - s;
      radius = h / 2;
    }
    return { w: w, h: h, wash: wash, halo: halo, radius: radius };
  }

  // Renders the target at progress `p`.
  function draw(inst, p) {
    var overlay = inst.overlay;
    var size = inst.size;
    if (!overlay || !size) return;
    var slot = overlay.slot;
    if (p >= 1) {
      // Fully off is always solid, whatever the slot would say.
      overlay.el.style.background = overlay.color;
      slot.style.display = 'none';
      return;
    }
    overlay.el.style.background = '';
    slot.style.display = '';
    var W = size.width;
    var H = size.height;
    var f = frame(p, W, H);
    var g = overlay.glow;
    var blur = clamp(Math.min(W, H) * 0.04, 6, 36);
    // Big enough that the screen color reaches every corner even around a
    // round dot: a rounded shadow's corners round off by its spread too,
    // so it has to reach past the target's diagonal from the center, and
    // the perimeter always does.
    var spread = Math.ceil(2 * (W + H));
    slot.style.left = (W - f.w) / 2 + 'px';
    slot.style.top = (H - f.h) / 2 + 'px';
    slot.style.width = f.w + 'px';
    slot.style.height = f.h + 'px';
    slot.style.borderRadius = f.radius + 'px';
    slot.style.setProperty('--t-power-off-wash', f.wash.toFixed(3));
    slot.style.boxShadow =
      // The halo's spread follows the line, never the slot: spread by a
      // tall slot, even a faint halo fogs the whole screen color gray.
      '0 0 ' + blur + 'px ' + (Math.min(f.h, blur) / 3) + 'px rgba(' + g[0] + ',' + g[1] + ',' + g[2] + ',' + (0.85 * f.halo).toFixed(3) + '),' +
      '0 0 0 ' + spread + 'px ' + overlay.color;
  }

  // Animates inst.progress from wherever it is now to `to`, over the
  // share of the profile's duration that distance represents, so a
  // reversal halfway through takes half as long rather than crawling.
  function animateTo(inst, to, myGen) {
    return new Promise(function (resolve) {
      if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
      var from = inst.progress;
      var duration = inst.profile.duration * Math.abs(to - from);
      var ease = easingFn(inst.profile.easing);
      var start = null;
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (myGen === inst.gen) {
          if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
          inst.animHandle = null;
          inst.progress = to;
          draw(inst, to);
        }
        resolve();
      }
      function tick(now) {
        if (finished) return;
        if (myGen !== inst.gen) { finish(); return; }
        if (start === null) start = now;
        var t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
        if (t >= 1) { finish(); return; }
        inst.progress = from + (to - from) * ease(t);
        draw(inst, inst.progress);
        inst.animHandle = requestAnimationFrame(tick);
      }
      inst.animHandle = requestAnimationFrame(tick);
      // Browsers stop running rAF in a background tab, so a link clicked
      // just before switching away would never finish covering and never
      // navigate. While frames are running in a visible tab the timer
      // waits out what's left instead of cutting the motion short (see
      // inkblot.js).
      function fallback() {
        if (finished) return;
        if (start !== null && document.visibilityState === 'visible') {
          var left = start + duration - performance.now();
          if (left > 0) {
            setTimeout(fallback, left + 150);
            return;
          }
        }
        finish();
      }
      setTimeout(fallback, duration + 150);
    });
  }

  injectStyles();
  applyProfile(root);

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
    var inst = instanceFor(el);
    if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
    inst.animHandle = null;
    inst.progress = 0;
    el.classList.remove('t-power-off-active');
    activeElements.delete(el);
  }

  function finiteOr(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  // A link's own data-t-* attributes, or an options object passed to
  // cover/reveal/play, win over the page's default profile field by field.
  function mergeProfile(overrides) {
    overrides = overrides || {};
    return {
      duration: Math.max(0, finiteOr(overrides.duration, options.duration)),
      easing: overrides.easing || options.easing,
      color: overrides.color || options.color,
      glow: overrides.glow || options.glow,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset;
    return {
      duration: ds.tDuration ? Number(ds.tDuration) : undefined,
      easing: ds.tEasing,
      color: ds.tColor,
      glow: ds.tGlow,
    };
  }

  // --- The two primitives every use is built from. Both resolve (never
  // reject) and tolerate being superseded mid-flight. ---

  function cover(el, overrides) {
    var inst = instanceFor(el);
    var profile = mergeProfile(overrides);
    inst.profile = profile;
    var myGen = ++inst.gen;

    if (prefersReducedMotion()) return Promise.resolve();

    applyProfile(el);
    layoutOverlay(inst, el, profile);
    el.classList.add('t-power-off-active');
    activeElements.add(el);
    draw(inst, inst.progress);
    return animateTo(inst, 1, myGen);
  }

  function reveal(el, overrides) {
    var inst = instanceFor(el);
    var profile = overrides ? mergeProfile(overrides) : (inst.profile || options);
    inst.profile = profile;
    var myGen = ++inst.gen;

    if (prefersReducedMotion()) {
      cleanupEl(el);
      return Promise.resolve();
    }

    applyProfile(el);
    layoutOverlay(inst, el, profile);
    // Called on its own (nothing covered yet), it powers on from off.
    // Keyed on the overlay being shown, not on progress being 0: a cover()
    // that hasn't drawn its first frame yet is also at 0, and reversing
    // that should do nothing, not jump to black (a pointer crossing a
    // homepage card fast does exactly this).
    if (!activeElements.has(el)) inst.progress = 1;
    el.classList.add('t-power-off-active');
    activeElements.add(el);
    draw(inst, inst.progress);
    return animateTo(inst, 0, myGen).then(function () {
      if (myGen === inst.gen) cleanupEl(el);
    });
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so the screen is already off
  // before the rest of the page paints. The departing page's profile
  // travels along, so this page powers on in the same colors. Skipped
  // under reduced motion, as the departure never covered either. ---
  var pending = readPending();
  var arrivingProfile = prefersReducedMotion() ? null : pending;
  if (arrivingProfile) {
    var rootInst = instanceFor(root);
    rootInst.profile = mergeProfile(arrivingProfile);
    layoutOverlay(rootInst, root, rootInst.profile);
    rootInst.progress = 1;
    root.classList.add('t-power-off-active');
    activeElements.add(root);
    draw(rootInst, 1);
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
    // still-active target back to a clean, uncovered state.
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
    // Merges new options into the page-wide default profile. Every
    // profile field is read at cover/reveal time, so this can't stomp an
    // arriving reveal (see inkblot.js).
    configure: function (opts) {
      Object.assign(options, opts || {});
    },
    // Switches `el` (any element with class="t-el", or
    // document.documentElement) off, resolving once it's fully off.
    // Leaves `el` covered — pair with reveal().
    cover: cover,
    // Powers `el` back on, resolving once fully revealed and cleaned up.
    reveal: reveal,
    // Cover el, run options.swap(el) (may return a promise) once covered,
    // then reveal. A stale play() superseded mid-cover skips its swap and
    // reveal, leaving them to the newer call (see static.js).
    play: function (el, overrides) {
      overrides = overrides || {};
      var inst = instanceFor(el);
      var coverPromise = cover(el, overrides);
      var myGen = inst.gen;
      return coverPromise.then(function () {
        if (inst.gen !== myGen) return;
        return overrides.swap ? overrides.swap(el) : undefined;
      }).then(function () {
        if (inst.gen !== myGen) return;
        return reveal(el, overrides);
      });
    },
  };
})(window, document);
