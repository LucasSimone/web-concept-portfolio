/**
 * Aperture
 * --------
 * A ring of camera-iris blades — curved white panels seamed with black
 * lines, just like a real diaphragm — spirals inward from the edge of
 * the screen to the center when you click away to another page, their
 * curved tips sealing shut at a point, then spirals back outward from
 * that point once the next page loads, opening to reveal it. One
 * continuous motion split across the navigation boundary, same shape as
 * Shutter's rise/recede but a twisting iris in place of a sliding panel.
 *
 * The blades are real drawn shapes (not a mask trick): `blades` wedges
 * (default 8), each with two curved side edges (the seams shared with
 * its neighbors, stroked in `lineColor`) that sweep tangentially as they
 * run inward — the same look a real blade gets from pivoting around a
 * point out near the rim instead of the exact center — plus one curved
 * inner edge, a true circular arc, the same shape a real iris opening
 * traces. Filled in `color`. Their shared inner radius is driven by a
 * single registered custom property, `--pt-aperture-progress` (0 =
 * sealed, 1 = wide open),
 * which the browser transitions natively — a requestAnimationFrame loop
 * just samples its live computed value each frame and rebuilds all the
 * blade paths from it, since arbitrary path geometry can't be
 * CSS-transitioned directly. Built once per page as a plain DOM node
 * appended straight onto <html> (not <body>, which may not exist yet
 * when this script runs) so the blades are on screen before the rest of
 * the page ever paints — a fixed-position element doesn't need to live
 * inside <body> to render.
 *
 * Usage: drop `<script src="aperture.js"></script>` in `<head>` (a
 * plain, non-async/defer tag) on every page that should take part. No
 * class or markup is required — it listens for clicks on the whole
 * document and intercepts any same-origin link (opt a link out with
 * `data-no-transition`). The cover/reveal only ever plays across a
 * navigation it intercepted itself: a direct load, refresh, or bookmark
 * visit renders normally with no overlay at all, and a destination page
 * that doesn't also load this script just appears underneath once the
 * exit cover finishes, with no reveal animation of its own.
 *
 * Coexists with other page-transition effects on the same page: its
 * public API lives at `window.PageTransitions.aperture`, not a shared
 * name, and its config reads from `window.PageTransitionConfig.aperture`
 * — so a second effect's script (e.g. Shutter) can register alongside
 * it without either clobbering the other.
 *
 * A single link can override duration/easing/color/lineColor/blades/spin
 * for just its own transition with `data-pt-duration`, `data-pt-easing`,
 * `data-pt-color`, `data-pt-line-color`, `data-pt-blades`,
 * `data-pt-spin` — every other link keeps using the page's default
 * profile. The chosen profile travels to the next page in the same
 * one-shot sessionStorage handoff already used to trigger the reveal, so
 * a customized cover and its matching reveal always agree, without
 * persisting anything.
 */
(function (global, document) {
  var NAME = 'aperture';
  global.PageTransitions = global.PageTransitions || {};
  if (global.PageTransitions[NAME]) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'pt-aperture-styles';
  var PROGRESS_PROP = '--pt-aperture-progress';
  var PENDING_KEY = 'pt-aperture-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var DEG2RAD = Math.PI / 180;
  var root = document.documentElement;

  var DEFAULTS = {
    duration: 600, // ms for each half (close or open) of the motion
    easing: 'cubic-bezier(.65,0,.35,1)',
    color: '#fff', // blade panel fill
    lineColor: '#000', // blade seam / edge stroke
    spin: 70, // degrees the ring twists through as it opens/closes — the "spiral"
    blades: 8, // number of iris blades
    selector: 'a[href]', // which links this page intercepts
  };
  var pageConfig = (global.PageTransitionConfig && global.PageTransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);
  var activeProfile = options; // whichever profile is currently animating

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '@property ' + PROGRESS_PROP + '{syntax:"<number>";inherits:true;initial-value:0;}' +
      '.pt-aperture-overlay{position:fixed;inset:0;z-index:2147483647;display:none;pointer-events:none;}' +
      'html.pt-aperture-active .pt-aperture-overlay{display:block;pointer-events:auto;}' +
      '.pt-aperture-overlay svg{display:block;width:100%;height:100%;}' +
      '.pt-aperture-blade{fill:var(--pt-aperture-color,#fff);stroke:var(--pt-aperture-line-color,#000);' +
      'stroke-width:2px;stroke-linejoin:round;}' +
      'html.pt-aperture-active{' + PROGRESS_PROP + ':0;}' + // 0 = sealed shut
      'html.pt-aperture-anim{transition:' + PROGRESS_PROP + ' var(--pt-aperture-duration,600ms) ' +
      'var(--pt-aperture-easing,cubic-bezier(.65,0,.35,1));}' +
      'html.pt-aperture-open{' + PROGRESS_PROP + ':1;}'; // 1 = wide open
    document.head.appendChild(style);
  }

  function applyProfile(profile) {
    root.style.setProperty('--pt-aperture-duration', profile.duration + 'ms');
    root.style.setProperty('--pt-aperture-easing', profile.easing);
    root.style.setProperty('--pt-aperture-color', profile.color);
    root.style.setProperty('--pt-aperture-line-color', profile.lineColor);
  }

  // --- Overlay DOM: a ring of blade <path> elements, rebuilt to match
  // the active profile's blade count and recomputed every animation
  // frame from the live --pt-aperture-progress value. ---
  var overlayEl, svg, bladesGroup, blades = [];
  var geometry = { cx: 0, cy: 0, maxR: 0 };

  function createOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'pt-aperture-overlay';
    svg = document.createElementNS(SVG_NS, 'svg');
    bladesGroup = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(bladesGroup);
    overlayEl.appendChild(svg);

    // Appended to <html> rather than <body> — this can run before <body>
    // exists at all (a non-deferred <head> script), and a fixed-position
    // element renders correctly regardless of where in the tree it sits.
    root.appendChild(overlayEl);
  }

  // Recomputes geometry for the current viewport and rebuilds the blade
  // elements if the profile's blade count changed. Cheap enough to just
  // rerun before every activation rather than track resize — this only
  // ever runs once per navigation anyway.
  function layoutOverlay(profile) {
    if (!overlayEl) createOverlay();
    var w = global.innerWidth;
    var h = global.innerHeight;
    geometry.cx = w / 2;
    geometry.cy = h / 2;
    var n = Math.max(3, profile.blades | 0 || DEFAULTS.blades);
    // Corner distance plus a buffer, then inflated by 1/cos(half the
    // sector angle) — a blade's outer edge is a straight chord across
    // its sector, and a chord's midpoint sits closer to center than its
    // radius by exactly that factor, so without this a chord can dip
    // inside the corner and leave a sliver of the page showing through.
    var cornerDist = Math.hypot(w / 2, h / 2) + 24;
    geometry.maxR = cornerDist / Math.cos(Math.PI / n);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    if (blades.length !== n) {
      bladesGroup.textContent = '';
      blades = [];
      for (var i = 0; i < n; i++) {
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('class', 'pt-aperture-blade');
        bladesGroup.appendChild(p);
        blades.push(p);
      }
    }
  }

  // Rebuilds every blade's path for the given progress (0 = sealed shut,
  // 1 = wide open). A real iris blade doesn't pivot around the exact
  // center — it pivots around a point out near the rim, which is what
  // makes its edges curve as they sweep toward their neighbor instead of
  // radiating out as straight spokes. Each blade's two side edges are a
  // quadratic curve from an outer anchor — offset backward from its
  // inner point by a fixed `skew` angle — into that inner point, so the
  // curve sweeps sideways (tangentially) as well as inward. Both blades
  // sharing a seam compute that shared curve from the same absolute
  // angle, so they always meet exactly with no gap. The inner edge
  // between a blade's own two points is a true circular arc, so the
  // opening it traces reads as the rounded polygon/near-circle a real
  // iris forms. At progress 0 the arc's radius hits zero and everything
  // collapses onto the center point, giving the sealed blades their
  // curved tips.
  function renderBlades(progress) {
    var n = blades.length;
    if (!n) return;
    // Clamp: a custom easing (e.g. an overshooting "back" curve, valid via
    // data-pt-easing) can carry the transitioning value outside [0, 1]
    // mid-flight, which would otherwise hand the SVG arc command below a
    // negative radius.
    progress = Math.min(1, Math.max(0, progress));
    var cx = geometry.cx;
    var cy = geometry.cy;
    var maxR = geometry.maxR;
    var innerR = progress * maxR;
    var r = innerR.toFixed(2);
    var spinRad = activeProfile.spin * (1 - progress) * DEG2RAD;
    var step = (Math.PI * 2) / n;
    var skew = step * 0.5; // how far the outer anchor trails its inner point — the pivot sweep
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

      blades[i].setAttribute('d',
        'M' + outer(a0) +
        'Q' + ctrl(a0) + ' ' + inner(a0) +
        'A' + r + ' ' + r + ' 0 0 1 ' + inner(a1) +
        'Q' + ctrl(a1) + ' ' + outer(a1) + 'Z');
    }
  }

  // The custom property's live computed value is the only thing that
  // actually animates (the browser tweens it natively per `anim`'s
  // transition); this loop just samples it every frame and rebuilds the
  // blade geometry to match, since path data itself can't be
  // CSS-transitioned. Runs for `durationMs` plus a small buffer, then
  // stops on its own.
  var renderHandle = null;
  function stopRender() {
    if (renderHandle) {
      cancelAnimationFrame(renderHandle);
      renderHandle = null;
    }
  }
  function startRender(durationMs) {
    stopRender();
    var deadline = performance.now() + durationMs + 80;
    function tick() {
      var raw = getComputedStyle(root).getPropertyValue(PROGRESS_PROP);
      var progress = parseFloat(raw);
      renderBlades(isFinite(progress) ? progress : 0);
      renderHandle = performance.now() < deadline ? requestAnimationFrame(tick) : null;
    }
    renderHandle = requestAnimationFrame(tick);
  }

  injectStyles();
  applyProfile(options);

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

  function cleanup() {
    stopRender();
    root.classList.remove('pt-aperture-active', 'pt-aperture-anim', 'pt-aperture-open');
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
    activeProfile = arrivingProfile;
    applyProfile(activeProfile);
    layoutOverlay(activeProfile);
    root.classList.add('pt-aperture-active');
    renderBlades(0); // sealed, before any transition has run
  }

  function reveal() {
    if (prefersReducedMotion()) {
      cleanup();
      return;
    }
    requestAnimationFrame(function () {
      root.classList.add('pt-aperture-anim');
      requestAnimationFrame(function () {
        root.classList.add('pt-aperture-open');
        startRender(activeProfile.duration);
        setTimeout(cleanup, activeProfile.duration + 60);
      });
    });
  }

  function onReady() {
    if (arrivingProfile) reveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  global.addEventListener('pageshow', function (event) {
    // Returning via bfcache can restore the DOM mid-animation; snap back
    // to a clean, uncovered state instead of replaying anything.
    if (event.persisted) cleanup();
  });

  // --- Departure: close the iris, then hand off to the next page. ---
  function closeThenNavigate(url, profile) {
    activeProfile = profile;

    if (prefersReducedMotion()) {
      setPending(profile);
      global.location.href = url;
      return;
    }

    applyProfile(profile);
    layoutOverlay(profile);
    root.classList.add('pt-aperture-active', 'pt-aperture-open'); // start fully open, no transition yet
    renderBlades(1);
    requestAnimationFrame(function () {
      root.classList.add('pt-aperture-anim');
      requestAnimationFrame(function () {
        root.classList.remove('pt-aperture-open'); // animates progress 1->0: seals shut
        startRender(profile.duration);
      });
    });

    var navigated = false;
    function go() {
      if (navigated) return;
      navigated = true;
      setPending(profile);
      global.location.href = url;
    }
    root.addEventListener('transitionend', function handler(e) {
      // transitionend bubbles, so without the target check some unrelated
      // descendant finishing a transition on a same-named property (e.g.
      // a future page-specific animation) could fire this early.
      if (e.target !== root || e.propertyName !== PROGRESS_PROP) return;
      root.removeEventListener('transitionend', handler);
      go();
    });
    setTimeout(go, profile.duration + 150); // fallback if transitionend never fires
  }

  // A link's own data-pt-duration/-easing/-color/-line-color/-blades/-spin
  // win over the page's default profile, but only for that one link —
  // every other link keeps using `options` untouched.
  function resolveProfile(a) {
    var ds = a.dataset;
    var duration = ds.ptDuration ? Number(ds.ptDuration) : NaN;
    var spin = ds.ptSpin ? Number(ds.ptSpin) : NaN;
    var blades_ = ds.ptBlades ? Number(ds.ptBlades) : NaN;
    return {
      duration: Number.isFinite(duration) ? duration : options.duration,
      easing: ds.ptEasing || options.easing,
      color: ds.ptColor || options.color,
      lineColor: ds.ptLineColor || options.lineColor,
      spin: Number.isFinite(spin) ? spin : options.spin,
      blades: Number.isFinite(blades_) ? blades_ : options.blades,
    };
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
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target.closest && event.target.closest(options.selector);
    if (!eligible(a)) return;
    event.preventDefault();
    closeThenNavigate(a.href, resolveProfile(a));
  });

  global.PageTransitions[NAME] = {
    configure: function (opts) {
      Object.assign(options, opts || {});
      // A page's own <head> fragment typically calls this just to widen
      // `selector` (see the demo pages) — it runs before DOMContentLoaded,
      // right after an arriving page has already applied the profile it's
      // mid-handoff with. Re-applying the page's default profile here
      // would stomp that arriving profile before its reveal ever plays, so
      // skip it while one is in flight; the reveal itself never touches
      // these properties again once it's running.
      if (!arrivingProfile) applyProfile(options);
    },
  };
})(window, document);
