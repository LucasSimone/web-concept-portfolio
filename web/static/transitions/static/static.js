/**
 * Static
 * ------
 * Old tube-TV channel static: a layer of animated black-and-white noise
 * that fades in over whatever it's animating until the screen is nothing
 * but flickering snow, then — once whatever it's covering is ready — fades
 * back out to reveal what's underneath. Unlike Shutter/Aperture's panels
 * and iris (which sit still once fully closed), the noise itself keeps
 * flickering the entire time it's covering something, not just during the
 * two fades — same continuous-motion feel a real dead channel has. One
 * continuous cover/reveal motion split across the cover/reveal boundary,
 * same shape as Shutter and Aperture, just built from opacity instead of
 * a transform or a custom property.
 *
 * The noise is real per-pixel randomness drawn into a low-resolution
 * `<canvas>` (`grain` px per cell, upscaled with `image-rendering:
 * pixelated` for the blocky look) rather than a CSS trick: each cell is
 * independently rolled to be either `colorA` or `colorB` (defaulting to
 * white and black, the classic dead-channel look), weighted by `ratio` —
 * the fraction of cells that land on `colorA` — so dragging the ratio
 * shifts the whole field from mostly-white snow to mostly-black and back.
 * Topped with an optional scanline layer (`scanlines`).
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="static.js"></script>` in `<head>`
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
 *    `Transitions.static.play(el, { swap })` to cover it, run `swap(el)`
 *    once it's fully covered, then reveal — e.g. to swap that element's
 *    content in place. `cover(el)`/`reveal(el)` are also public on their
 *    own for finer-grained control than `play`'s cover→swap→reveal shape.
 *    Multiple elements (or repeated calls on the same one, e.g. to loop
 *    it) each animate independently — nothing is shared between them.
 *
 * Coexists with other transition effects on the same page (e.g. a site
 * demoing several): its public API lives at `window.Transitions.static`,
 * not a shared name, and its config reads from
 * `window.TransitionConfig.static`, not a shared object — so a second
 * effect's script can register alongside it without either clobbering
 * the other.
 *
 * A single call can override duration/easing/colorA/colorB/ratio/grain/
 * scanlines/scanlineSpacing/scanlineThickness/scanlineBlur for just that
 * one transition, leaving every other link/call using the page's default
 * profile: a link's
 * `data-t-duration`/`-easing`/`-color-a`/`-color-b`/`-ratio`/`-grain`/`-scanlines`/
 * `-scanline-spacing`/`-scanline-thickness`/`-scanline-blur` attributes
 * for navigation, or the same fields
 * passed straight into `cover`/`reveal`/
 * `play` for elements. For navigation, the chosen profile travels to the
 * next page in the same one-shot sessionStorage handoff already used to
 * trigger the reveal, so a customized cover and its matching reveal
 * always agree, without persisting anything.
 */
(function (global, document) {
  var NAME = 'static';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var STYLE_ID = 't-static-styles';
  var PENDING_KEY = 't-static-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var SCAN_SPEED = 20; // px/s the scanlines scroll at, regardless of spacing — see applyProfile
  var root = document.documentElement;

  var DEFAULTS = {
    duration: 1000, // ms for each half (fade in or fade out) of the motion
    easing: 'ease-in-out',
    colorA: '#fff', // first noise color — defaults (with colorB) to the classic black-and-white look
    colorB: '#000', // second noise color
    ratio: 0.5, // fraction of noise cells that land on colorA rather than colorB (0 = all colorB, 1 = all colorA)
    grain: 2, // px per noise cell before the canvas is scaled up (pixelated) — bigger = blockier, more retro
    scanlines: true, // overlay faint horizontal CRT scanlines on top of the noise
    scanlineSpacing: 5, // px between the start of one scanline and the next
    scanlineThickness: 2, // px width of each scanline itself
    scanlineBlur: true, // soften the scanlines' edges instead of the default hard cutoff
    selector: null, // which links this page intercepts — off until set
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record — its own overlay/canvas, its own render loop, its
  // own profile — so two targets, or two overlapping calls on the same
  // one, never share or stomp each other. `gen` is bumped on every
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
      // Required host class for any element target: gives the overlay a
      // positioning context. Not applied to (or needed by)
      // document.documentElement — a `fixed` overlay is already
      // viewport-relative regardless of its position.
      '.t-el{position:relative;}' +
      '.t-static-overlay{position:var(--t-static-position,fixed);inset:0;' +
      'z-index:2147483647;display:none;pointer-events:none;overflow:hidden;opacity:0;}' +
      // Order matters: this sets opacity:1 as the "covered" default, and
      // the .t-static-open rule far below (equal specificity, later in
      // source order) overrides it back to 0 for the "revealed" end state
      // — same equal-specificity/source-order trick used to flip the
      // panels in shutter.js. Child combinator (>), not descendant: the
      // overlay is always el's own direct child (see layoutOverlay), and
      // document.documentElement — the navigation target — is an ancestor
      // of every element on the page, so a plain descendant selector would
      // also match any other target's leftover overlay (e.g. an el that
      // played and was cleaned up earlier) anywhere in the DOM, flashing
      // its last, now-frozen frame back in for the whole time root is
      // covered/animating.
      '.t-static-active > .t-static-overlay{display:block;pointer-events:auto;opacity:1;}' +
      '.t-static-overlay canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;}' +
      // A 1px-per-3px line was the same order of size as a couple of grain
      // cells, so it just read as more noise instead of a distinct banding
      // pattern. Wider, higher-contrast bands (and multiply, so they darken
      // reliably instead of just alpha-blending into whatever's already
      // bright/dark underneath) keep them legible against the noise.
      // Scrolls the pattern upward one full period per cycle, driven by a
      // plain CSS animation rather than the canvas's own rAF loop — it's a
      // fixed, seamless loop (0 and -spacing are the same frame, since the
      // gradient repeats every `spacing` px) so the browser can run it off
      // the main thread instead of needing a redraw every frame like the
      // noise does. A dead channel's scanlines drift like this rather than
      // sitting still, so it reads as part of the same rolling texture
      // instead of a static grid stamped on top of it. Duration scales with
      // spacing (set alongside it in applyProfile) so the scroll speed in
      // px/s stays constant regardless of how far apart the lines are —
      // otherwise wider spacing would visibly speed up for the same period.
      '.t-static-scanlines{position:absolute;inset:0;mix-blend-mode:multiply;' +
      'background-image:repeating-linear-gradient(' +
      'to bottom,rgba(0,0,0,.55) 0,rgba(0,0,0,.55) var(--t-static-scan-thickness,2px),' +
      'transparent var(--t-static-scan-thickness,2px),transparent var(--t-static-scan-spacing,5px));' +
      'animation:t-static-scanline-scroll var(--t-static-scan-duration,.25s) linear infinite;}' +
      '@keyframes t-static-scanline-scroll{from{background-position-y:0;}' +
      'to{background-position-y:calc(var(--t-static-scan-spacing,5px) * -1);}}' +
      '@media (prefers-reduced-motion:reduce){.t-static-scanlines{animation:none;}}' +
      // > .t-static-overlay, not a bare descendant match, for the same
      // cross-target leak reason as .t-static-active above.
      '[data-t-static-scanlines="false"] > .t-static-overlay .t-static-scanlines{display:none;}' +
      // Softens each line's own edges by feathering the gradient's alpha
      // ramp inward from a 1px margin on either side of the line, instead
      // of the hard instant cutoff above. Deliberately NOT a CSS
      // filter:blur() — blur spreads across the whole rasterized pattern,
      // not just one line's edges, so at small spacing it bleeds into the
      // neighboring gap and washes the whole thing out to a uniform haze
      // (confirmed: even 1px of blur erased the default 5px-spacing
      // pattern entirely). Feathering inside each repeat's own footprint
      // stays soft without ever touching its neighbors, however tight the
      // spacing.
      '[data-t-static-scan-blur="true"] > .t-static-overlay .t-static-scanlines{background-image:repeating-linear-gradient(' +
      'to bottom,transparent 0,rgba(0,0,0,.55) 1px,' +
      'rgba(0,0,0,.55) calc(var(--t-static-scan-thickness,2px) - 1px),' +
      'transparent var(--t-static-scan-thickness,2px),transparent var(--t-static-scan-spacing,5px));}' +
      '.t-static-anim > .t-static-overlay{transition:opacity ' +
      'var(--t-static-duration,1000ms) var(--t-static-easing,ease-in-out);}' +
      '.t-static-open > .t-static-overlay{opacity:0;}';
    document.head.appendChild(style);
  }

  // Whether `el` is the page-nav target (document.documentElement) or an
  // arbitrary element — the one distinction applyProfile()/targetSize()
  // each need to make.
  function isRootTarget(el) {
    return el === root;
  }

  // The box to fit the noise canvas to: the viewport for the page-nav
  // target, or the element's own bounding box for everything else.
  function targetSize(el) {
    if (isRootTarget(el)) return { width: global.innerWidth, height: global.innerHeight };
    var rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function applyProfile(el, profile) {
    el.style.setProperty('--t-static-duration', profile.duration + 'ms');
    el.style.setProperty('--t-static-easing', profile.easing);
    el.setAttribute('data-t-static-scanlines', String(profile.scanlines));
    el.style.setProperty('--t-static-scan-spacing', profile.scanlineSpacing + 'px');
    // Keeps scroll speed constant (see SCAN_SPEED) instead of the scanline
    // animation's fixed-duration loop just taking longer strides as spacing
    // grows, which would read as speeding up.
    el.style.setProperty('--t-static-scan-duration', (profile.scanlineSpacing / SCAN_SPEED) + 's');
    el.style.setProperty('--t-static-scan-thickness', profile.scanlineThickness + 'px');
    el.setAttribute('data-t-static-scan-blur', String(profile.scanlineBlur));
    // Viewport-relative for the page-nav target, container-relative
    // (against .t-el's position:relative) for everything else.
    el.style.setProperty('--t-static-position', isRootTarget(el) ? 'fixed' : 'absolute');
  }

  // --- Overlay DOM: one canvas (the noise) plus a tint layer and a
  // scanline layer per instance, rebuilt/resized to match that instance's
  // target size and profile.grain before every activation. ---
  function createOverlay(el) {
    var overlayEl = document.createElement('div');
    overlayEl.className = 't-static-overlay';
    var canvas = document.createElement('canvas');
    var scanlines = document.createElement('div');
    scanlines.className = 't-static-scanlines';
    overlayEl.appendChild(canvas);
    overlayEl.appendChild(scanlines);
    el.appendChild(overlayEl); // child of the target itself, root or element alike
    return {
      el: overlayEl,
      canvas: canvas,
      ctx: canvas.getContext('2d', { alpha: false }),
      resW: 0,
      resH: 0,
      imageData: null,
      buf32: null,
      colorAInt: 0,
      colorBInt: 0,
      ratio: 0.5,
    };
  }

  // Offscreen 1x1 canvas used purely to let the browser's own CSS color
  // parser turn any valid color string (hex, named, rgb()/hsl(), ...) into
  // concrete RGB bytes, rather than writing a parser for it ourselves.
  var colorParseCtx = null;
  function colorToInt(color, fallback) {
    if (!colorParseCtx) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      colorParseCtx = c.getContext('2d', { willReadFrequently: true });
    }
    colorParseCtx.fillStyle = fallback; // reset first: an invalid `color` leaves fillStyle unchanged, so this is what it falls back to
    colorParseCtx.fillStyle = color;
    colorParseCtx.fillRect(0, 0, 1, 1);
    var d = colorParseCtx.getImageData(0, 0, 1, 1).data;
    // Uint32Array is little-endian, so the byte order that lands each
    // channel in the right place is R,G,B,A low-to-high — same packing
    // drawNoise() relies on.
    return (255 << 24) | (d[2] << 16) | (d[1] << 8) | d[0];
  }

  // Recomputes the canvas's backing resolution for the target's current
  // size and profile.grain, resizing (and reallocating its pixel buffer)
  // only when that resolution actually changed. Cheap enough to just
  // rerun before every activation rather than track resize — this only
  // ever runs once per cover/reveal anyway.
  function layoutOverlay(inst, el, profile) {
    if (!inst.overlay) inst.overlay = createOverlay(el);
    var overlay = inst.overlay;
    // A play() swap that replaces el's content wholesale (el.textContent =
    // ..., el.innerHTML = ...) takes the overlay node down with it, even
    // though `overlay` is still alive in memory — just detached. Re-append
    // the same node rather than rebuilding it, so reveal() picks up
    // exactly where cover() left off, and still paints above whatever the
    // swap added.
    if (overlay.el.parentNode !== el) el.appendChild(overlay.el);
    // Recomputed every call, not just on resize — colorA/colorB/ratio can
    // change between cover() and reveal() (or across calls) independently
    // of size, and this is cheap enough to just always redo.
    overlay.colorAInt = colorToInt(profile.colorA, DEFAULTS.colorA);
    overlay.colorBInt = colorToInt(profile.colorB, DEFAULTS.colorB);
    overlay.ratio = profile.ratio;
    var size = targetSize(el);
    var grain = profile.grain > 0 ? profile.grain : DEFAULTS.grain;
    var resW = Math.max(1, Math.round(size.width / grain));
    var resH = Math.max(1, Math.round(size.height / grain));
    if (resW !== overlay.resW || resH !== overlay.resH) {
      overlay.canvas.width = resW;
      overlay.canvas.height = resH;
      overlay.resW = resW;
      overlay.resH = resH;
      overlay.imageData = overlay.ctx.createImageData(resW, resH);
      // A Uint32Array view over the same buffer as imageData.data lets
      // drawNoise() write one pixel per 32-bit store (RGBA packed into a
      // single int, little-endian so byte order comes out R,G,B,A) instead
      // of four separate byte writes — the difference matters here since
      // it runs on every animation frame for as long as the target stays
      // covered, not just during the two fades.
      overlay.buf32 = new Uint32Array(overlay.imageData.data.buffer);
    }
  }

  function drawNoise(overlay) {
    if (!overlay || !overlay.buf32) return;
    var buf = overlay.buf32;
    var colorA = overlay.colorAInt;
    var colorB = overlay.colorBInt;
    var ratio = overlay.ratio;
    for (var i = 0; i < buf.length; i++) {
      buf[i] = Math.random() < ratio ? colorA : colorB;
    }
    overlay.ctx.putImageData(overlay.imageData, 0, 0);
  }

  // The render loop runs continuously for as long as a target is
  // covered — through the fade in, the full hold while whatever it's
  // covering happens, and into the fade out — not just while the opacity
  // transition itself is running, since a real dead channel keeps
  // flickering the whole time the screen is static. cover() starts it;
  // only cleanupEl() (i.e. reveal() finishing, or a bfcache reset) stops
  // it.
  function stopRender(inst) {
    if (inst.renderHandle) {
      cancelAnimationFrame(inst.renderHandle);
      inst.renderHandle = null;
    }
  }
  function startRender(inst) {
    if (inst.renderHandle) return; // already running
    function tick() {
      drawNoise(inst.overlay);
      inst.renderHandle = requestAnimationFrame(tick);
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
    el.classList.remove('t-static-active', 't-static-anim', 't-static-open');
    activeElements.delete(el);
  }

  // A link's own data-t-duration/-easing/-color-a/-color-b/-ratio/-grain/
  // -scanlines/-scanline-spacing/-scanline-thickness/-scanline-blur, or an options
  // object passed straight to cover/reveal/play, win over the
  // page's default profile field-by-field — every other field keeps using
  // `options`.
  function mergeProfile(overrides) {
    overrides = overrides || {};
    var duration = overrides.duration;
    var grain = overrides.grain;
    var ratio = overrides.ratio;
    var scanlineSpacing = overrides.scanlineSpacing;
    var scanlineThickness = overrides.scanlineThickness;
    return {
      duration: (typeof duration === 'number' && isFinite(duration)) ? duration : options.duration,
      easing: overrides.easing || options.easing,
      colorA: overrides.colorA || options.colorA,
      colorB: overrides.colorB || options.colorB,
      ratio: (typeof ratio === 'number' && isFinite(ratio)) ? Math.min(1, Math.max(0, ratio)) : options.ratio,
      grain: (typeof grain === 'number' && isFinite(grain) && grain > 0) ? grain : options.grain,
      scanlines: overrides.scanlines !== undefined ? overrides.scanlines : options.scanlines,
      scanlineSpacing: (typeof scanlineSpacing === 'number' && isFinite(scanlineSpacing) && scanlineSpacing > 0)
        ? scanlineSpacing : options.scanlineSpacing,
      scanlineThickness: (typeof scanlineThickness === 'number' && isFinite(scanlineThickness) && scanlineThickness > 0)
        ? scanlineThickness : options.scanlineThickness,
      scanlineBlur: overrides.scanlineBlur !== undefined ? overrides.scanlineBlur : options.scanlineBlur,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset;
    return {
      duration: ds.tDuration ? Number(ds.tDuration) : undefined,
      easing: ds.tEasing,
      colorA: ds.tColorA,
      colorB: ds.tColorB,
      ratio: ds.tRatio ? Number(ds.tRatio) : undefined,
      grain: ds.tGrain ? Number(ds.tGrain) : undefined,
      scanlines: ds.tScanlines === undefined ? undefined : ds.tScanlines !== 'false',
      scanlineSpacing: ds.tScanlineSpacing ? Number(ds.tScanlineSpacing) : undefined,
      scanlineThickness: ds.tScanlineThickness ? Number(ds.tScanlineThickness) : undefined,
      scanlineBlur: ds.tScanlineBlur === undefined ? undefined : ds.tScanlineBlur !== 'false',
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
      el.classList.add('t-static-active', 't-static-open'); // start revealed (opacity 0), no transition yet
      activeElements.add(el);
      startRender(inst); // flicker starts immediately, even before the fade-in itself

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-static-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.remove('t-static-open'); // animates opacity 0 -> 1: fades in to full static
        });
      });

      var resolved = false;
      function finish() {
        if (resolved) return;
        resolved = true;
        resolve();
      }
      el.addEventListener('transitionend', function handler(e) {
        // transitionend bubbles from the overlay div (where the opacity
        // transition actually lives) up through el, so target-check
        // against the overlay rather than el itself.
        if (e.target !== inst.overlay.el || e.propertyName !== 'opacity') return;
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
      // el between cover() and reveal(), and this is what lets the noise
      // canvas match el's current size rather than its stale one.
      layoutOverlay(inst, el, profile);
      el.classList.add('t-static-active'); // harmless no-op if cover() already set this
      activeElements.add(el);
      startRender(inst); // no-op if cover() already started it; needed when reveal() is called on its own

      requestAnimationFrame(function () {
        if (myGen !== inst.gen) return;
        el.classList.add('t-static-anim');
        requestAnimationFrame(function () {
          if (myGen !== inst.gen) return;
          el.classList.add('t-static-open'); // animates opacity 1 -> 0: fades the static out, revealing el
        });
      });

      setTimeout(function () {
        if (myGen === inst.gen) cleanupEl(el);
        resolve();
      }, profile.duration + 60);
    });
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so the static (if any) is on
  // screen before the rest of the page ever paints. Whatever profile the
  // departing page used travels along in the same handoff, so the reveal
  // matches the cover even if it was a customized one. Skipped entirely
  // under reduced motion — the departure side never showed a cover for
  // the same reason, so there's nothing here to reveal either; showing
  // the overlay just to immediately clean it up at DOMContentLoaded would
  // be a static frame flash with no motion to justify it. ---
  // readPending() always runs (it also clears the flag) — reduced motion
  // just means we ignore what it found instead of acting on it.
  var pending = readPending();
  var arrivingProfile = prefersReducedMotion() ? null : pending;
  if (arrivingProfile) {
    var rootInst = instanceFor(root);
    rootInst.profile = arrivingProfile;
    applyProfile(root, arrivingProfile);
    layoutOverlay(rootInst, root, arrivingProfile);
    root.classList.add('t-static-active');
    activeElements.add(root);
    drawNoise(rootInst.overlay); // one immediate frame so the first paint isn't blank
    startRender(rootInst); // keep flickering while the rest of the page loads
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
    // resolving once fully covered in static. Leaves `el` covered — pair
    // with reveal().
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
      var inst = instanceFor(el);
      var coverPromise = cover(el, overrides);
      // Captured the instant cover() returns, i.e. still the gen it just
      // claimed — a later, overlapping play()/cover()/reveal() call on the
      // same el (e.g. a second click before this one finished covering)
      // bumps inst.gen past this value. cover() itself always resolves
      // regardless of being superseded (see its own comment), so without
      // this check a stale play() call would still run swap() here — and
      // swap() typically replaces el's content wholesale, which tears the
      // newer call's live overlay out of the DOM mid-fade. A transition
      // interrupted that way doesn't resume on reattach, so it was getting
      // stuck showing full static with nothing left to animate it back out.
      var myGen = inst.gen;
      return coverPromise.then(function () {
        if (inst.gen !== myGen) return; // superseded - let the newer call own swap/reveal
        return overrides.swap ? overrides.swap(el) : undefined;
      }).then(function () {
        if (inst.gen !== myGen) return;
        return reveal(el, overrides);
      });
    },
  };
})(window, document);
