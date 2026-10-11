/**
 * Inkblot
 * -------
 * Ink dropped on paper: a few drops land, soak outward into irregular,
 * bleeding blots, throw off small satellite spatter, and merge into each
 * other as they grow until the whole screen is solid ink. Once whatever
 * it's covering is ready, the same blots recede the way they came,
 * breaking up at the edges as they dry, to reveal what's underneath. One
 * continuous cover/reveal motion split across the cover/reveal boundary,
 * same shape as Shutter, Aperture and Static.
 *
 * The blots are a metaball field drawn into a low-resolution `<canvas>`
 * and smoothed up to full size. Every drop is a small cluster of
 * overlapping circles ("lumps"); each circle adds a soft, finite falloff
 * to the field, and a cell is ink wherever the summed field crosses a
 * threshold. Summing rather than unioning is what makes neighbours reach
 * for each other and fuse with a neck between them instead of overlapping
 * as separate discs, and the lumps give each drop a lobed outline rather
 * than a circle. A fixed paper-grain noise texture nudges the field near
 * every edge, so the boundary is ragged and fibrous like ink wicking into
 * paper, and a pale fringe just outside the threshold (`bleed`) reads as
 * the wet halo ahead of the ink. Toward the end of the cover every blot
 * keeps soaking outward past its drop's size, so the last gaps close from
 * the ink around them, rather than some corner the drops never reached
 * fading in flat.
 *
 * Where the drops land and how big they get is the extension point:
 * `style` takes a built-in layout ('splatter', 'rain', 'pool') or a
 * function returning your own list of drops (see STYLES below for the
 * shape).
 *
 * Where the ink starts is separate from that, so it works with any
 * style: `origin: 'cursor'` lands the first drop where the click was and
 * lands the rest in order of distance from it, so the ink runs outward
 * from the click; `origin: 'element'` wells ink up in the shape of the
 * button or link that was pressed first, then runs outward from that.
 * The default, 'scatter', lands drops wherever the style says.
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="inkblot.js"></script>` in `<head>`
 *    (a plain, non-async/defer tag) on every page that should take part.
 *    Off by default: nothing is intercepted until you set `selector` (see
 *    Options in the docs). Once enabled, it listens for clicks on the
 *    whole document and intercepts any matching same-origin link (opt a
 *    link out with `data-no-transition`). The cover/reveal only ever plays
 *    across a navigation it intercepted itself: a direct load, refresh, or
 *    bookmark visit renders normally with no overlay at all, and a
 *    destination page that doesn't also load this script just appears
 *    underneath once the exit cover finishes, with no reveal of its own.
 *
 * 2. Elements — mark any element `class="t-el"` and call
 *    `Transitions.inkblot.play(el, { swap })` to cover it, run `swap(el)`
 *    once it's fully covered, then reveal. `cover(el)`/`reveal(el)` are
 *    also public on their own. Multiple elements (or repeated calls on the
 *    same one) each animate independently — nothing is shared between
 *    them.
 *
 * Coexists with other transition effects on the same page: its public API
 * lives at `window.Transitions.inkblot` and its config reads from
 * `window.TransitionConfig.inkblot`, so neither clobbers another effect's.
 *
 * A single call can override duration/easing/color/style/drops/splatter/
 * bleed/origin for just that one transition: a link's `data-t-duration`/
 * `-easing`/`-color`/`-style`/`-drops`/`-splatter`/`-bleed`/`-origin`
 * attributes for navigation, or the same fields passed straight into
 * `cover`/`reveal`/`play` for elements — plus `from` (the click event,
 * or an element) to say where 'cursor'/'element' start; a clicked link
 * supplies that itself. For navigation, the chosen profile, and the exact
 * drops the cover laid down, travel to the next page in the same one-shot
 * sessionStorage handoff that triggers the reveal, so the next page
 * recedes the same blots the last one spread, without persisting
 * anything. (A function `style` can't survive that trip as JSON, but it
 * doesn't need to: the drops it already produced are what travel.)
 */
(function (global, document) {
  var NAME = 'inkblot';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var STYLE_ID = 't-inkblot-styles';
  var PENDING_KEY = 't-inkblot-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var root = document.documentElement;

  // The field is computed per cell, not per pixel, then smoothed up by the
  // browser when the canvas is scaled to the target — that upscale is also
  // part of what softens the edges. Cells are at least MIN_CELL px, which
  // keeps a card-sized element target from looking blocky, and grow on
  // big targets so the grid never exceeds MAX_CELLS: past that the
  // per-frame cost outgrows a 60fps budget on a full-screen overlay
  // without the blots looking any better.
  var MIN_CELL = 2;
  var MAX_CELLS = 120000;
  // A cell is ink where the summed field reaches THRESHOLD. Each circle's
  // falloff, (1 - d²/S²)², only reaches it at d ≈ 0.54·S, so its support S
  // is SUPPORT × its radius: an isolated circle's ink edge then lands
  // exactly on the radius it was given, and the rest of the support is the
  // reach that lets neighbours pull toward each other and merge.
  var THRESHOLD = 0.5;
  var SUPPORT = 1 / Math.sqrt(1 - Math.sqrt(THRESHOLD));
  // How hard the paper-grain texture pushes the edge in or out, as a
  // fraction of THRESHOLD. Higher while receding, so drying ink breaks up
  // into islands at its edge instead of shrinking as a clean outline.
  var GRAIN_COVER = 0.6;
  var GRAIN_REVEAL = 0.9;
  // Peak opacity of the wet halo just outside the ink's edge.
  var FRINGE_ALPHA = 0.4;
  // Width, as a fraction of THRESHOLD, of the ramp from the halo up to
  // solid ink. Without it the edge jumps from halo to solid in a single
  // cell, and the upscale shows that as a staircase.
  var EDGE_RAMP = 0.12;
  // From SWELL_START on, every blot keeps soaking outward past the size
  // its drop asked for, up to (1 + SWELL)×, so the gaps the drops didn't
  // reach close from the blots bordering them. Only past FLOOD_START, for
  // whatever a sparse custom style still leaves open, is the whole field
  // lifted toward solid. A uniform lift any earlier fills bare paper as
  // speckled grain rather than as ink arriving from somewhere.
  var SWELL_START = 0.5;
  var SWELL = 1.6;
  var FLOOD_START = 0.9;

  var DEFAULTS = {
    duration: 1200, // ms for each half (spread or recede) of the motion
    easing: 'ease-in-out',
    color: '#000', // the ink
    style: 'splatter', // where drops land and how big they grow — a built-in name or a function (see STYLES)
    drops: 4, // how many main drops a built-in style lays down
    splatter: 0.5, // 0–1: how much satellite spatter a built-in style throws around its drops
    bleed: 0.5, // 0–1: width of the pale wet fringe ahead of the ink's edge (0 = crisp)
    origin: 'scatter', // where the ink starts: 'scatter' (wherever the style lands it), 'cursor', or 'element' — see fromOrigin
    selector: null, // which links this page intercepts — off until set
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // --- Styles. Each one is called with
  //   { width, height, drops, splatter, random, origin }
  // (target size in px, the profile's drops/splatter, Math.random, and
  // the resolved origin — { x, y, rect } in px, or null; see fromOrigin,
  // which re-times whatever a style returns around it anyway) and
  // returns the drops to lay down, each as
  //   { x, y, r, at, grow?, lumps? }
  // in px: the drop's center, the radius it soaks out to, and `at`, when
  // in the cover (0–1) it lands. `grow` is how much of the rest of the
  // cover it spends spreading (default: all of it for a big drop, a short
  // burst for small spatter), and `lumps` how many extra lobes to give its
  // outline (default: a few for big drops, none or one for spatter; 0 for
  // a plain round drop). Drops don't have to cover the target: the closing
  // flood fills whatever they miss. ---

  function diagonal(info) {
    return Math.sqrt(info.width * info.width + info.height * info.height);
  }

  // Mitchell's best-candidate sampling: of a few random points, keep the
  // one farthest from everything placed so far. Spreads drops across the
  // target without the visible regularity of a jittered grid.
  function spreadPoints(count, info) {
    var points = [];
    for (var i = 0; i < count; i++) {
      var best = null;
      var bestDist = -1;
      for (var c = 0; c < 10; c++) {
        var p = { x: info.random() * info.width, y: info.random() * info.height };
        var nearest = Infinity;
        for (var j = 0; j < points.length; j++) {
          var dx = points[j].x - p.x;
          var dy = points[j].y - p.y;
          nearest = Math.min(nearest, dx * dx + dy * dy);
        }
        if (nearest > bestDist) { best = p; bestDist = nearest; }
      }
      points.push(best);
    }
    return points;
  }

  // Small drops flung outward from a parent's impact, landing just after
  // it. Placed past the parent's early size so they read as separate
  // specks at first, then get swallowed as the parent soaks out to them.
  function spatter(parent, count, info) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var a = info.random() * Math.PI * 2;
      var dist = parent.r * (0.7 + info.random() * 0.9);
      out.push({
        x: parent.x + Math.cos(a) * dist,
        y: parent.y + Math.sin(a) * dist,
        r: parent.r * (0.03 + info.random() * 0.1),
        at: Math.min(0.95, parent.at + info.random() * 0.08),
      });
    }
    return out;
  }

  var STYLES = {
    // A few big drops landing early, each with a spray of spatter.
    splatter: function (info) {
      var n = Math.max(1, Math.round(info.drops));
      var r = Math.sqrt((info.width * info.height) / (n * Math.PI));
      var out = [];
      spreadPoints(n, info).forEach(function (p) {
        var drop = { x: p.x, y: p.y, r: r * (0.75 + info.random() * 0.4), at: info.random() * 0.3 };
        out.push(drop);
        out = out.concat(spatter(drop, Math.round(info.splatter * 10), info));
      });
      return out;
    },
    // Many medium drops, landing one after another, like a shower on a
    // page left out in it.
    rain: function (info) {
      var n = Math.max(1, Math.round(info.drops * 5));
      var r = Math.sqrt((info.width * info.height) / (n * Math.PI));
      var out = [];
      spreadPoints(n, info).forEach(function (p) {
        var drop = { x: p.x, y: p.y, r: r * (0.8 + info.random() * 0.5), at: info.random() * 0.6, lumps: 1 };
        out.push(drop);
        out = out.concat(spatter(drop, Math.round(info.splatter * 3), info));
      });
      return out;
    },
    // One drop in the middle that keeps spreading, ringed by the rest
    // landing around it, so the cover closes from the center out.
    pool: function (info) {
      var d = diagonal(info);
      var cx = info.width / 2;
      var cy = info.height / 2;
      var center = { x: cx, y: cy, r: d * 0.45, at: 0 };
      var out = [center];
      var ring = Math.max(0, Math.round(info.drops) - 1);
      var turn = info.random() * Math.PI * 2;
      for (var i = 0; i < ring; i++) {
        var a = turn + (i / ring) * Math.PI * 2;
        var dist = d * (0.28 + info.random() * 0.12);
        out.push({
          x: cx + Math.cos(a) * dist,
          y: cy + Math.sin(a) * dist,
          r: d * (0.1 + info.random() * 0.06),
          at: 0.15 + info.random() * 0.3,
        });
      }
      return out.concat(spatter({ x: cx, y: cy, r: d * 0.2, at: 0.05 }, Math.round(info.splatter * 24), info));
    },
  };

  // Resolves `style` to the drops for a target of this size. A custom
  // style that throws or returns something unusable falls back to
  // splatter rather than leaving the cover with nothing to draw — an empty
  // list would still flood closed at the end, but as a flat fade.
  function layDrops(profile, size, origin) {
    var info = {
      width: size.width,
      height: size.height,
      drops: profile.drops,
      splatter: profile.splatter,
      random: Math.random,
      origin: origin || null,
    };
    var style = typeof profile.style === 'function' ? profile.style : STYLES[profile.style] || STYLES.splatter;
    var drops;
    try {
      drops = style(info);
    } catch (e) {
      drops = null;
    }
    if (!Array.isArray(drops) || !drops.length) drops = STYLES.splatter(info);
    if (origin) drops = fromOrigin(drops, origin, info);
    return toCircles(drops, size);
  }

  // How much of the cover it takes for the ink to travel from the origin
  // to the farthest corner. The rest is the drops soaking out once landed.
  var ORIGIN_TRAVEL = 0.55;

  // Starts the ink at `origin` rather than wherever the style scattered
  // it, in two parts. First a source: one big drop at the click point,
  // throwing spatter outward, or, with a rect (the pressed element), a
  // row of drops filling that element's outline almost at once, so the
  // button itself reads as the thing that burst, with the big drop
  // behind it. Then the style's own drops keep their positions and sizes
  // but land in order of distance from the origin, with a little of the
  // style's own timing kept as jitter so the front isn't a perfect
  // circle. Done after the style rather than inside each one, so it works
  // the same for a custom style that knows nothing about origins.
  function fromOrigin(drops, origin, info) {
    var w = info.width;
    var h = info.height;
    var far = Math.max(
      Math.hypot(origin.x, origin.y), Math.hypot(w - origin.x, origin.y),
      Math.hypot(origin.x, h - origin.y), Math.hypot(w - origin.x, h - origin.y)
    ) || 1;
    var timed = drops.map(function (drop) {
      if (!drop) return drop;
      var dist = Math.hypot(drop.x - origin.x, drop.y - origin.y);
      var own = isFinite(drop.at) ? drop.at : 0;
      return Object.assign({}, drop, { at: 0.04 + ORIGIN_TRAVEL * (dist / far) + 0.08 * own });
    });
    var big = Math.sqrt((w * h) / (Math.max(1, info.drops) * Math.PI));
    var source = [];
    var rect = origin.rect;
    if (rect) {
      var long = Math.max(rect.width, rect.height);
      var short = Math.max(4, Math.min(rect.width, rect.height));
      var count = Math.max(1, Math.round(long / short));
      var horizontal = rect.width >= rect.height;
      for (var i = 0; i < count; i++) {
        var along = (i + 0.5) / count;
        source.push({
          x: horizontal ? rect.x + along * rect.width : rect.x + rect.width / 2,
          y: horizontal ? rect.y + rect.height / 2 : rect.y + along * rect.height,
          r: short * 0.65,
          at: 0,
          grow: 0.15,
          lumps: 0,
        });
      }
      source.push({ x: origin.x, y: origin.y, r: Math.max(big, long * 0.6), at: 0.03 });
    } else {
      source.push({ x: origin.x, y: origin.y, r: big, at: 0 });
    }
    var burst = { x: origin.x, y: origin.y, r: big * 0.6, at: 0.02 };
    return source.concat(spatter(burst, Math.round(info.splatter * 14), info), timed);
  }

  // Turns a cover's `from` into an origin in the target's own px, or null
  // to fall back to scattering. `from` is a click event, an element, or
  // { x, y, element? } in viewport px. With origin 'element', the element
  // is the pressed thing — the one passed, or the event's currentTarget /
  // target — unless it's the target itself or holds it, since ink can't
  // well up out of the very thing it's covering. Keyboard-triggered
  // clicks report 0,0 (and key events no position at all), so they start
  // from the element's center instead.
  function resolveOrigin(el, kind, from) {
    if ((kind !== 'cursor' && kind !== 'element') || !from) return null;
    var point = null;
    var source = null;
    if (from.nodeType === 1) {
      source = from;
    } else {
      var isEvent = typeof global.Event === 'function' && from instanceof global.Event;
      if (from.element && from.element.nodeType === 1) source = from.element;
      else if (isEvent) {
        if (from.currentTarget && from.currentTarget.nodeType === 1) source = from.currentTarget;
        else if (from.target && from.target.nodeType === 1) source = from.target;
      }
      var x = isEvent ? from.clientX : from.x;
      var y = isEvent ? from.clientY : from.y;
      var keyboard = isEvent && from.detail === 0 && x === 0 && y === 0;
      if (isFinite(x) && isFinite(y) && !keyboard) point = { x: x, y: y };
    }
    var box = source ? source.getBoundingClientRect() : null;
    if (box && !box.width && !box.height) box = null;
    if (!point && box) point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // Pressing the covered element itself still gives a point (its center,
    // for a keypress), just no outline to burst from.
    if (source && (source === el || source.contains(el))) box = null;
    if (!point) return null;
    var base = isRootTarget(el) ? { left: 0, top: 0 } : el.getBoundingClientRect();
    return {
      x: point.x - base.left,
      y: point.y - base.top,
      rect: kind === 'element' && box
        ? { x: box.left - base.left, y: box.top - base.top, width: box.width, height: box.height }
        : null,
    };
  }

  // Expands drops into the flat list of circles the field is summed from,
  // stored relative to the target (x/y as fractions of its size, r as a
  // fraction of its diagonal) so a handoff to a differently sized
  // viewport still lands them in the same places.
  function toCircles(drops, size) {
    var d = Math.sqrt(size.width * size.width + size.height * size.height) || 1;
    var circles = [];
    drops.forEach(function (drop) {
      if (!drop || !isFinite(drop.x) || !isFinite(drop.y) || !(drop.r > 0)) return;
      var at = isFinite(drop.at) ? Math.min(0.95, Math.max(0, drop.at)) : 0;
      var small = drop.r < d * 0.03;
      var grow = isFinite(drop.grow) && drop.grow > 0 ? Math.min(1, drop.grow) : (small ? 0.3 : 1);
      var lumps = isFinite(drop.lumps) ? Math.max(0, Math.round(drop.lumps))
        : (small ? (Math.random() < 0.4 ? 1 : 0) : 3 + Math.floor(Math.random() * 3));
      function add(x, y, r) {
        circles.push([x / size.width, y / size.height, r / d, at, grow]);
      }
      // With lumps, the core shrinks a little so the lobes, not the core,
      // set the outline; without, it's the drop as given.
      add(drop.x, drop.y, lumps ? drop.r * 0.75 : drop.r);
      var turn = Math.random() * Math.PI * 2;
      for (var i = 0; i < lumps; i++) {
        var a = turn + (i / lumps) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
        var off = drop.r * (0.3 + Math.random() * 0.3);
        add(drop.x + Math.cos(a) * off, drop.y + Math.sin(a) * off, drop.r * (0.4 + Math.random() * 0.3));
      }
    });
    return circles;
  }

  // --- Easing. The motion runs in JS (the field has to be recomputed
  // every frame anyway), so the CSS easing string the other transitions
  // hand straight to a `transition` is parsed into a function here
  // instead: the keywords, plus any cubic-bezier(). Anything else falls
  // back to ease-in-out. ---
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
    if (!points) points = EASING_KEYWORDS['ease-in-out'];
    easingCache[key] = cubicBezier(points[0], points[1], points[2], points[3]);
    return easingCache[key];
  }

  function smoothstep(lo, hi, v) {
    var t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  }

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record — its own overlay, drops, progress and animation — so
  // two targets never share or stomp each other. `progress` is how
  // covered the target is right now (0–1); a new cover()/reveal() picks up
  // from wherever the last one left it, so reversing mid-motion turns the
  // same blots around instead of jumping. `gen` is bumped on every call;
  // a superseded call's promise still resolves, it just stops touching
  // anything. ---
  var instances = new WeakMap();
  function instanceFor(el) {
    var inst = instances.get(el);
    if (!inst) {
      inst = { gen: 0, profile: options, overlay: null, circles: null, progress: 0, animHandle: null };
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
      // Topmost by default, so the ink covers everything in the target.
      // A host that wants something of its own to show above the ink
      // (e.g. a label once it's covered) lowers --t-inkblot-z on the
      // target and raises that one thing above it.
      '.t-inkblot-overlay{position:var(--t-inkblot-position,fixed);inset:0;' +
      'z-index:var(--t-inkblot-z,2147483647);display:none;pointer-events:none;overflow:hidden;}' +
      // Child combinator, not descendant: document.documentElement is an
      // ancestor of every element target, so a descendant match would
      // also show any element's leftover overlay whenever root is covered
      // (same reason as in static.js).
      '.t-inkblot-active > .t-inkblot-overlay{display:block;pointer-events:auto;}' +
      // Left at the default smooth upscaling on purpose (unlike Static's
      // pixelated noise): blurring the coarse field up to full size is
      // part of what makes the edge read as soft and wet.
      '.t-inkblot-overlay canvas{position:absolute;inset:0;width:100%;height:100%;}';
    document.head.appendChild(style);
  }

  function isRootTarget(el) {
    return el === root;
  }

  function targetSize(el) {
    if (isRootTarget(el)) return { width: global.innerWidth, height: global.innerHeight };
    var rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function applyProfile(el) {
    // Viewport-relative for the page-nav target, container-relative
    // (against .t-el's position:relative) for everything else.
    el.style.setProperty('--t-inkblot-position', isRootTarget(el) ? 'fixed' : 'absolute');
  }

  function createOverlay(el) {
    var overlayEl = document.createElement('div');
    overlayEl.className = 't-inkblot-overlay';
    var canvas = document.createElement('canvas');
    overlayEl.appendChild(canvas);
    el.appendChild(overlayEl);
    return {
      el: overlayEl,
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      gw: 0,
      gh: 0,
      cell: MIN_CELL,
      imageData: null,
      buf32: null,
      field: null,
      grain: null,
      inkRGB: 0,
    };
  }

  // Offscreen 1x1 canvas used to let the browser's own CSS color parser
  // turn any valid color string into RGB bytes (see static.js).
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
    // Packed little-endian without alpha, so drawField() only has to OR
    // each cell's alpha into the top byte.
    return (d[2] << 16) | (d[1] << 8) | d[0];
  }

  // Paper grain: three octaves of value noise over the cell grid, in
  // -0.5..0.5. The coarse one bends the outline; the finer two fray it.
  // Fixed for as long as the overlay keeps this size, so edges creep
  // along the same fibres frame to frame instead of boiling.
  function makeGrain(gw, gh) {
    var out = new Float32Array(gw * gh);
    [[12, 0.5], [4, 0.3], [2, 0.2]].forEach(function (octave) {
      var step = octave[0];
      var weight = octave[1];
      var lw = Math.ceil(gw / step) + 2;
      var lh = Math.ceil(gh / step) + 2;
      var lattice = new Float32Array(lw * lh);
      for (var i = 0; i < lattice.length; i++) lattice[i] = Math.random() - 0.5;
      for (var y = 0; y < gh; y++) {
        var fy = y / step;
        var y0 = Math.floor(fy);
        var ty = fy - y0;
        ty = ty * ty * (3 - 2 * ty);
        for (var x = 0; x < gw; x++) {
          var fx = x / step;
          var x0 = Math.floor(fx);
          var tx = fx - x0;
          tx = tx * tx * (3 - 2 * tx);
          var a = lattice[y0 * lw + x0];
          var b = lattice[y0 * lw + x0 + 1];
          var c = lattice[(y0 + 1) * lw + x0];
          var d = lattice[(y0 + 1) * lw + x0 + 1];
          out[y * gw + x] += weight * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        }
      }
    });
    return out;
  }

  // Sizes the cell grid to the target, reallocating only when it actually
  // changed. Rerun before every cover/reveal rather than tracking resize:
  // swap() may have resized an element in between.
  function layoutOverlay(inst, el, profile) {
    if (!inst.overlay) inst.overlay = createOverlay(el);
    var overlay = inst.overlay;
    // A swap that replaces el's content wholesale takes the overlay node
    // with it; re-append the same node so reveal() picks up where cover()
    // left off (see static.js).
    if (overlay.el.parentNode !== el) el.appendChild(overlay.el);
    overlay.inkRGB = colorToRGB(profile.color, DEFAULTS.color);
    var size = targetSize(el);
    var cell = Math.max(MIN_CELL, Math.sqrt((size.width * size.height) / MAX_CELLS));
    var gw = Math.max(1, Math.ceil(size.width / cell));
    var gh = Math.max(1, Math.ceil(size.height / cell));
    overlay.cell = cell;
    if (gw !== overlay.gw || gh !== overlay.gh) {
      overlay.canvas.width = gw;
      overlay.canvas.height = gh;
      overlay.gw = gw;
      overlay.gh = gh;
      overlay.imageData = overlay.ctx.createImageData(gw, gh);
      overlay.buf32 = new Uint32Array(overlay.imageData.data.buffer);
      overlay.field = new Float32Array(gw * gh);
      overlay.grain = makeGrain(gw, gh);
    }
    return size;
  }

  // Renders the target at coverage `p` (0–1). `receding` only changes how
  // much the grain breaks up the edge, so the reveal reads as drying
  // rather than the cover played backward.
  function drawField(inst, p, receding) {
    var overlay = inst.overlay;
    if (!overlay || !overlay.buf32) return;
    var ctx = overlay.ctx;
    var buf = overlay.buf32;
    var ink = overlay.inkRGB;
    if (p >= 1) {
      // Fully covered is always solid, whatever the field would say.
      var solid = ((255 << 24) | ink) >>> 0;
      buf.fill(solid);
      ctx.putImageData(overlay.imageData, 0, 0);
      return;
    }
    var gw = overlay.gw;
    var gh = overlay.gh;
    var field = overlay.field;
    var grain = overlay.grain;
    field.fill(0);

    // Grid units: positions and radii converted from the stored
    // target-relative values into cells.
    var diagCells = Math.sqrt(gw * gw + gh * gh);
    var swell = 1 + SWELL * smoothstep(SWELL_START, 1, p);
    var circles = inst.circles || [];
    for (var i = 0; i < circles.length; i++) {
      var c = circles[i];
      var local = (p - c[3]) / ((1 - c[3]) * c[4]);
      if (local <= 0) continue;
      if (local > 1) local = 1;
      // Ease-out quart: ink lands and runs fast, then slows as the paper
      // soaks it up.
      var grown = 1 - Math.pow(1 - local, 4);
      var s = c[2] * diagCells * grown * swell * SUPPORT;
      if (s < 0.5) continue;
      var cx = c[0] * gw;
      var cy = c[1] * gh;
      var x0 = Math.max(0, Math.floor(cx - s));
      var x1 = Math.min(gw - 1, Math.ceil(cx + s));
      var y0 = Math.max(0, Math.floor(cy - s));
      var y1 = Math.min(gh - 1, Math.ceil(cy + s));
      var inv = 1 / (s * s);
      for (var y = y0; y <= y1; y++) {
        var dy = y + 0.5 - cy;
        var dy2 = dy * dy * inv;
        if (dy2 >= 1) continue;
        var row = y * gw;
        for (var x = x0; x <= x1; x++) {
          var dx = x + 0.5 - cx;
          var k = 1 - dx * dx * inv - dy2;
          if (k > 0) field[row + x] += k * k;
        }
      }
    }

    // The closing flood (see FLOOD_START).
    var flood = smoothstep(FLOOD_START, 1, p) * THRESHOLD * 1.2;
    var grainAmp = THRESHOLD * (receding ? GRAIN_REVEAL : GRAIN_COVER);
    var bleed = Math.min(1, Math.max(0, inst.profile.bleed));
    var lo = THRESHOLD * (1 - 0.7 * bleed);
    var fringeSpan = THRESHOLD - lo;
    var fringeAlpha = FRINGE_ALPHA * 255;
    var rampLo = THRESHOLD * (1 - EDGE_RAMP);
    var solidInk = ((255 << 24) | ink) >>> 0;
    for (var j = 0; j < buf.length; j++) {
      var v = field[j] + flood;
      if (v <= 0) { buf[j] = 0; continue; }
      // Grain only acts where there's ink to move; bare paper stays bare
      // rather than sprouting specks of noise.
      v += grain[j] * grainAmp * Math.min(1, (2 * v) / THRESHOLD);
      if (v >= THRESHOLD) {
        buf[j] = solidInk;
        continue;
      }
      var alpha = 0;
      if (fringeSpan > 0 && v > lo) {
        var t = (v - lo) / fringeSpan;
        alpha = fringeAlpha * t * t;
      }
      if (v > rampLo) alpha = Math.max(alpha, (255 * (v - rampLo)) / (THRESHOLD - rampLo));
      buf[j] = alpha > 0 ? (((alpha | 0) << 24) | ink) >>> 0 : 0;
    }
    ctx.putImageData(overlay.imageData, 0, 0);
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
      var receding = to < from;
      var start = null;
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (myGen === inst.gen) {
          if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
          inst.animHandle = null;
          inst.progress = to;
          drawField(inst, to, receding);
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
        drawField(inst, inst.progress, receding);
        inst.animHandle = requestAnimationFrame(tick);
      }
      inst.animHandle = requestAnimationFrame(tick);
      // Browsers stop running rAF in a background tab. Without this, a
      // link clicked just before switching away would never finish
      // covering, so it would never navigate (same fallback as static.js's
      // transitionend timer). The motion's own clock starts at its first
      // frame, which can land well after this call on a busy page (an
      // arrival's reveal at DOMContentLoaded), so while frames are running
      // in a visible tab the timer waits out what's left instead of
      // cutting the motion short.
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
      return data;
    } catch (e) {
      return null;
    }
  }

  function setPending(profile, circles) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now(), profile: profile, circles: circles }));
    } catch (e) {}
  }

  function cleanupEl(el) {
    var inst = instanceFor(el);
    if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
    inst.animHandle = null;
    inst.progress = 0;
    inst.circles = null;
    el.classList.remove('t-inkblot-active');
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
      duration: finiteOr(overrides.duration, options.duration),
      easing: overrides.easing || options.easing,
      color: overrides.color || options.color,
      style: overrides.style || options.style,
      drops: Math.max(1, finiteOr(overrides.drops, options.drops)),
      splatter: Math.min(1, Math.max(0, finiteOr(overrides.splatter, options.splatter))),
      bleed: Math.min(1, Math.max(0, finiteOr(overrides.bleed, options.bleed))),
      origin: overrides.origin || options.origin,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset;
    return {
      duration: ds.tDuration ? Number(ds.tDuration) : undefined,
      easing: ds.tEasing,
      color: ds.tColor,
      style: ds.tStyle,
      drops: ds.tDrops ? Number(ds.tDrops) : undefined,
      splatter: ds.tSplatter ? Number(ds.tSplatter) : undefined,
      bleed: ds.tBleed ? Number(ds.tBleed) : undefined,
      origin: ds.tOrigin,
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
    var size = layoutOverlay(inst, el, profile);
    // A fresh cover lays fresh drops; one that interrupts a reveal keeps
    // the blots already on screen and turns them back around. `from` is
    // read here, not kept on the profile: it's this one click, and the
    // profile travels to the next page as JSON.
    if (!inst.circles || inst.progress === 0) {
      inst.circles = layDrops(profile, size, resolveOrigin(el, profile.origin, overrides && overrides.from));
    }
    el.classList.add('t-inkblot-active');
    activeElements.add(el);
    drawField(inst, inst.progress, false);
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
    var size = layoutOverlay(inst, el, profile);
    // Called on its own (nothing covered yet), there's nothing to recede:
    // start from solid ink with drops of its own. Keyed on the drops, not
    // on progress being 0: a cover() that hasn't drawn its first frame yet
    // is also at 0, and reversing that should recede nothing, not jump to
    // solid (a pointer crossing a card fast does exactly this).
    if (!inst.circles) {
      inst.circles = layDrops(profile, size);
      inst.progress = 1;
    }
    el.classList.add('t-inkblot-active');
    activeElements.add(el);
    drawField(inst, inst.progress, true);
    return animateTo(inst, 0, myGen).then(function () {
      if (myGen === inst.gen) cleanupEl(el);
    });
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so solid ink is on screen before
  // the rest of the page paints. The departing page's profile and drops
  // travel along, so this page recedes the blots that page spread.
  // Skipped under reduced motion, as the departure never covered either. ---
  var pending = readPending();
  var arriving = prefersReducedMotion() ? null : pending;
  if (arriving && arriving.profile) {
    var rootInst = instanceFor(root);
    rootInst.profile = mergeProfile(arriving.profile);
    layoutOverlay(rootInst, root, rootInst.profile);
    rootInst.circles = Array.isArray(arriving.circles) ? arriving.circles : null;
    rootInst.progress = 1;
    root.classList.add('t-inkblot-active');
    activeElements.add(root);
    drawField(rootInst, 1, true);
  } else {
    arriving = null;
  }

  function onReady() {
    if (arriving) reveal(root);
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
      var inst = instanceFor(root);
      setPending(inst.profile, inst.circles);
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
    var overrides = datasetToOverrides(a);
    // The link, not event.currentTarget (that's the document here), is
    // what was pressed.
    overrides.from = { x: event.clientX, y: event.clientY, element: a };
    // A keyboard-activated link reports 0,0: start from the link instead.
    if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) overrides.from = a;
    coverThenNavigate(a.href, overrides);
  });

  global.Transitions[NAME] = {
    // Merges new options into the page-wide default profile. Unlike
    // static.js there's nothing to re-apply to root here — every profile
    // field is read at cover/reveal time — so it can't stomp an arriving
    // reveal either.
    configure: function (opts) {
      Object.assign(options, opts || {});
    },
    // Covers `el` (any element with class="t-el", or
    // document.documentElement), resolving once it's solid ink. Leaves
    // `el` covered — pair with reveal().
    cover: cover,
    // Recedes the ink, resolving once `el` is fully revealed and cleaned up.
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
    // The built-in styles, so a custom one can wrap or extend them.
    styles: STYLES,
  };
})(window, document);
