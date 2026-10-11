/**
 * Sonar
 * -----
 * A canvas background where a click sends out a ping: a ring that spreads
 * from the cursor and bounces off whatever is visible inside the element,
 * lighting up each surface it strikes the way a sonar return paints an
 * outline. It fades with distance and loses some strength at every bounce.
 *
 * What counts as a surface comes from the page itself, read fresh on every
 * ping. A visible border is a wall, so a bordered box turns the ring away
 * and nothing inside it is reached from outside; a box with no visible
 * border isn't there at all, so the ring passes in to whatever it holds,
 * and so on down. A box that's filled in (a background that differs from
 * what's behind it, a gradient, a shadow), an image or a form control is
 * solid, and so is each word of text. Hidden things are skipped, and
 * anything clipped by an `overflow` ancestor is clipped here too.
 *
 * The ring is a few thousand rays, each reflected off the first wall in
 * its way, angle in equal to angle out. The front is drawn by joining
 * neighboring rays while they stay close, so it folds where it bounces
 * and tears apart at corners.
 *
 * Usage: give any element `class="bg-sonar"` — this file injects its own
 * CSS and auto-initializes every matching element on load, so dropping the
 * `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'sonar-styles';
  const CSS = `
.bg-sonar {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.bg-sonar.bg-sonar--dark {
  color: #fff;
}

.sonar__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  display: block;
  pointer-events: none;
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const DEFAULTS = {
    // How fast the ring spreads, in px/sec.
    speed: 380,
    // How far a ping travels, bounces included, before it has faded out.
    range: 800,
    // Share of its strength the ring keeps at each bounce.
    reflectivity: 0.7,
    // Seconds the points a ping leaves on what it hits take to fade to
    // about 5%.
    fade: 1.5,
    // What text is to the ring: 'glyphs' traces each letter's own outline,
    // 'words' puts a box round each word, and 'auto' traces letters in
    // text at least GLYPH_SIZE px and boxes words in anything smaller,
    // where letter outlines would only shatter the ring.
    text: 'auto',
    // Strength of a soft glow under the ring's line, 0 for none.
    glow: 0,
    // Seconds between pings sent out on their own from random spots, or 0
    // for none.
    autoPing: 0,
    clickToPing: true,
    // Where a click sends the ring out from: 'cursor', the point clicked,
    // or 'element', the outline of whatever was clicked (a button, a
    // bordered or filled box, a traced letter), so the ring grows out of
    // its shape. A click on empty space pings from the cursor either way.
    origin: 'cursor',
    // Draws the walls the ring can hit, to see what counts as visible.
    showWalls: false,
    color: '#000000',
    background: '#ffffff',
    lineWidth: 1,
  };

  const TAU = Math.PI * 2;
  // Gap between neighboring rays at the end of a ping's range, in px, which
  // sets how many rays a ping has.
  const RAY_SPACING = 3;
  const MIN_RAYS = 90;
  const MAX_RAYS = 1600;
  // The most pings in flight at once; a new one past this drops the oldest.
  const MAX_PINGS = 8;
  // Bounces handled within one ray's step, so a ray that lands in a tight
  // corner can't spin there forever.
  const MAX_BOUNCES_PER_STEP = 6;
  // How far a ray is set back off a wall it bounced from, in px.
  const NUDGE = 0.01;
  // Cell size of the grid walls are filed in, in px.
  const CELL = 48;
  // Strength under which a ray isn't drawn and an echo isn't left.
  const MIN_ALPHA = 0.02;
  // A turn sharper than this between one wall and the next along an
  // outline is a corner, where a front splits; anything gentler (the
  // steps round a rounded corner or a circle) is one smooth surface.
  const CORNER = (25 * Math.PI) / 180;
  // The furthest apart two neighboring rays are still joined into one
  // front after bouncing off the same surfaces, in px. Refining (see
  // _refine) normally keeps them much closer; this only matters once a
  // ping has used up its extra rays.
  const MAX_JOIN = 80;
  // Refining: how far apart two neighbors on one front may get before a
  // ray is added between them, in px; how many may be added per ping per
  // frame; and the most rays a ping may grow to.
  const REFINE_GAP = 5;
  // Two rays this close in param (radians round a point, px along an
  // outline) that still land far apart straddle a tear rather than a
  // stretch: one clipped a vertex the other missed. No ray between them
  // would land between them, so they're left torn.
  const MIN_REFINE_SPAN = 1e-4;
  const REFINE_PER_FRAME = 300;
  const MAX_REFINED = 6000;
  // A ray traced out from the start in one go is moved this far at a
  // time, in px, so each stretch can bounce up to MAX_BOUNCES_PER_STEP
  // times.
  const TRACE_CHUNK = 40;
  // How much wider than the line the glow is.
  const GLOW_WIDTH = 4;
  // How far off a surface, toward the side the ring came from, the point
  // it leaves there sits, so it isn't hidden under the page's own border.
  const ECHO_OFFSET = 1.5;
  // The smallest text 'auto' traces letter by letter, in px.
  const GLYPH_SIZE = 24;
  // How far out from its source a ray starts, in px, so a ray leaving an
  // outline doesn't strike that outline on its way out.
  const START_OFFSET = 0.05;
  // An outline's corners take this much of its param per radian they
  // turn, so a corner starts out with a few rays of its own; refining
  // fills in more as it spreads (see outlineSource).
  const FAN_WEIGHT = 12;
  // An outline gets one ray per this many px of param to start with.
  const OUTLINE_SPACING = 2;
  // The smallest share of the trails erased in one go; see Fireworks.
  const MIN_FADE = 0.12;
  // Elements that are solid however they're styled.
  const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'PROGRESS', 'METER']);
  const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];

  // Any CSS color as [r, g, b, a], 0-255, by painting it into one pixel
  // and reading that back, the same way Fireworks and Gears do. Results are
  // remembered, since a scan reads a handful of colors per element and
  // most pages only use a few.
  let probe = null;
  const parsed = new Map();
  function parseRgba(color) {
    if (parsed.has(color)) return parsed.get(color);
    if (parsed.size > 256) parsed.clear();
    if (!probe) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true });
    }
    probe.fillStyle = '#000000';
    probe.fillStyle = color;
    probe.globalCompositeOperation = 'copy';
    probe.fillRect(0, 0, 1, 1);
    probe.globalCompositeOperation = 'source-over';
    const rgba = Array.from(probe.getImageData(0, 0, 1, 1).data);
    parsed.set(color, rgba);
    return rgba;
  }

  // A parsed [r, g, b, a] laid over an opaque [r, g, b] backdrop, as the
  // eye would see it.
  function over([r, g, b, a], backdrop) {
    const k = a / 255;
    return [r, g, b].map((c, i) => c * k + backdrop[i] * (1 - k));
  }

  function differs(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 6;
  }

  function lengthOf(value, reference) {
    const n = parseFloat(value) || 0;
    return value.endsWith('%') ? (n / 100) * reference : n;
  }

  // The element's border-box outline, rounded corners included, as a
  // clockwise list of points. Radii are scaled down together when they
  // add up to more than a side, the way CSS does it.
  function outline(rect, style) {
    const { left: l, top: t, width: w, height: h } = rect;
    const radii = CORNERS.map((corner) => {
      const parts = style[`border${corner}Radius`].split(' ');
      return [lengthOf(parts[0], w), lengthOf(parts[1] || parts[0], h)];
    });
    const [tl, tr, br, bl] = radii;
    const fit = (size, a, b) => (a + b > size ? size / (a + b) : 1);
    const f = Math.min(fit(w, tl[0], tr[0]), fit(w, bl[0], br[0]), fit(h, tl[1], bl[1]), fit(h, tr[1], br[1]));
    const centers = [
      [l + tl[0] * f, t + tl[1] * f, Math.PI],
      [l + w - tr[0] * f, t + tr[1] * f, Math.PI * 1.5],
      [l + w - br[0] * f, t + h - br[1] * f, 0],
      [l + bl[0] * f, t + h - bl[1] * f, Math.PI * 0.5],
    ];
    const corners = [[l, t], [l + w, t], [l + w, t + h], [l, t + h]];
    const points = [];
    radii.forEach(([rx, ry], i) => {
      const [cx, cy, start] = centers[i];
      rx *= f;
      ry *= f;
      // Square if either radius is: `10px / 0` is a square corner, and
      // its arc's center would sit 10px along the side from it.
      if (rx < 0.5 || ry < 0.5) {
        points.push(corners[i]);
        return;
      }
      // Fine steps: a curve reflects a front, and spreads it, so each flat
      // step shows up in the reflection as a flat facet.
      const steps = Math.max(2, Math.min(40, Math.ceil(Math.max(rx, ry) / 1.2)));
      for (let k = 0; k <= steps; k++) {
        const a = start + (k / steps) * (Math.PI / 2);
        points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
    });
    return points;
  }

  // Liang-Barsky: the part of segment a-b inside `clip`, or null.
  function clipSegment(ax, ay, bx, by, clip) {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const edges = [[-dx, ax - clip.left], [dx, clip.right - ax], [-dy, ay - clip.top], [dy, clip.bottom - ay]];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return null;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) return null;
      }
    }
    return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1, t0, t1];
  }

  function intersect(a, b) {
    return {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    };
  }

  function contains(rect, x, y) {
    return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
  }

  // --- Letter outlines --------------------------------------------------
  // A letter is drawn into an offscreen canvas in the page's own font,
  // and its outline traced back out of the pixels with marching squares,
  // holes and all. Traced letters are kept by font and character, in px
  // from the pen position on the baseline, and shared by every instance.
  // They're dropped whenever a web font finishes loading, since anything
  // traced before then was traced in the fallback font.

  const glyphs = new Map();
  const fontMetrics = new Map();
  let glyphCtx = null;
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
      glyphs.clear();
      fontMetrics.clear();
    });
  }

  function glyphContext() {
    if (!glyphCtx) glyphCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    return glyphCtx;
  }

  // The font's own ascent and descent, which is what a text range's box
  // is made of, so the baseline can be found inside one.
  function metricsOf(font) {
    if (!fontMetrics.has(font)) {
      const ctx = glyphContext();
      ctx.font = font;
      const m = ctx.measureText('Hg');
      fontMetrics.set(font, [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent]);
    }
    return fontMetrics.get(font);
  }

  function glyphOutline(font, size, ch) {
    const key = `${font}|${ch}`;
    if (glyphs.has(key)) return glyphs.get(key);
    if (glyphs.size > 4000) glyphs.clear();
    const ctx = glyphContext();
    ctx.font = font;
    const m = ctx.measureText(ch);
    // Small letters are drawn bigger, so their outlines come out as
    // smooth as big ones'.
    const scale = Math.min(3, Math.max(1, 120 / size));
    const pad = 2;
    const left = Math.ceil(m.actualBoundingBoxLeft) + pad;
    const top = Math.ceil(m.actualBoundingBoxAscent) + pad;
    const w = Math.ceil((left + m.actualBoundingBoxRight + pad) * scale);
    const h = Math.ceil((top + m.actualBoundingBoxDescent + pad) * scale);
    let loops = [];
    if (w > 0 && h > 0 && w * h < 4e6) {
      const { canvas } = ctx;
      // Growing the canvas resets the context, font included, so set
      // everything after.
      if (canvas.width < w) canvas.width = w;
      if (canvas.height < h) canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.font = font;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(ch, left, top);
      const alpha = ctx.getImageData(0, 0, w, h).data;
      loops = traceAlpha(alpha, w, h)
        .map((loop) => simplifyLoop(loop, 0.3 * scale))
        .filter((loop) => loop.length >= 3)
        .map((loop) => loop.map(([x, y]) => [x / scale - left, y / scale - top]));
    }
    glyphs.set(key, loops);
    return loops;
  }

  // Marching squares over the alpha channel of a w x h RGBA buffer, with
  // everything outside it counted as empty so every outline closes. Each
  // crossing sits where the alpha passes halfway, read between the two
  // pixels either side of it, so outlines land between pixels rather than
  // on a staircase.
  //
  // Walking clockwise round a cell, each crossing either leaves the
  // letter (an exit) or enters it, and a line through the cell joins an
  // exit to an entry. A crossing is an exit in one of the two cells that
  // share it and an entry in the other, so following exit to entry, cell
  // to cell, walks each outline all the way round. A cell with four
  // crossings is a saddle: its middle decides whether the two inside
  // corners join up.
  function traceAlpha(data, w, h) {
    const HALF = 128;
    const value = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
    const stride = w + 2;
    const next = new Map();
    const points = new Map();
    const crossing = (x0, y0, x1, y1, v0, v1) => {
      const id = y0 === y1
        ? ((y0 + 1) * stride + Math.min(x0, x1) + 1) * 2
        : ((Math.min(y0, y1) + 1) * stride + x0 + 1) * 2 + 1;
      if (!points.has(id)) {
        const t = (HALF - v0) / (v1 - v0);
        points.set(id, [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]);
      }
      return id;
    };
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let y = -1; y < h; y++) {
      for (let x = -1; x < w; x++) {
        const v = corners.map(([dx, dy]) => value(x + dx, y + dy));
        const inside = v.map((a) => a >= HALF);
        if (inside[0] === inside[1] && inside[1] === inside[2] && inside[2] === inside[3]) continue;
        const found = [];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          if (inside[i] === inside[j]) continue;
          const [ax, ay] = corners[i];
          const [bx, by] = corners[j];
          found.push({ id: crossing(x + ax, y + ay, x + bx, y + by, v[i], v[j]), exit: inside[i] });
        }
        if (found.length === 2) {
          const [a, b] = found;
          if (a.exit) next.set(a.id, b.id);
          else next.set(b.id, a.id);
        } else {
          const joined = (v[0] + v[1] + v[2] + v[3]) / 4 >= HALF;
          for (let i = 0; i < 4; i++) {
            if (!found[i].exit) continue;
            next.set(found[i].id, found[(i + (joined ? 1 : 3)) % 4].id);
          }
        }
      }
    }
    const loops = [];
    const seen = new Set();
    next.forEach((_, start) => {
      if (seen.has(start)) return;
      const loop = [];
      let id = start;
      while (id !== undefined && !seen.has(id)) {
        seen.add(id);
        loop.push(points.get(id));
        id = next.get(id);
      }
      loops.push(loop);
    });
    return loops;
  }

  // Ramer-Douglas-Peucker, keeping every point that strays more than
  // `tolerance` from the line between the points either side.
  function simplifyOpen(points, tolerance) {
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = points[a];
      const [bx, by] = points[b];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy) || 1;
      let far = -1;
      let farDist = tolerance;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / length;
        if (d > farDist) {
          far = i;
          farDist = d;
        }
      }
      if (far < 0) continue;
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
    return points.filter((_, i) => keep[i]);
  }

  // A closed outline is cut in two at the point furthest from its first,
  // and each half simplified on its own.
  function simplifyLoop(loop, tolerance) {
    if (loop.length < 8) return loop;
    const [x0, y0] = loop[0];
    let far = 0;
    let farDist = -1;
    loop.forEach(([x, y], i) => {
      const d = (x - x0) ** 2 + (y - y0) ** 2;
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    });
    const first = simplifyOpen(loop.slice(0, far + 1), tolerance);
    const second = simplifyOpen(loop.slice(far).concat([loop[0]]), tolerance);
    return first.slice(0, -1).concat(second.slice(0, -1));
  }

  // Even-odd: whether (x, y) is inside a shape made of several outlines,
  // so a point inside a letter's hole is outside the letter.
  function insideLoops(loops, x, y) {
    let inside = false;
    loops.forEach((loop) => {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [xi, yi] = loop[i];
        const [xj, yj] = loop[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    });
    return inside;
  }

  // --- Sources ----------------------------------------------------------
  // A ping's rays are laid out along its source by a single number, the
  // ray's `param`, from 0 up to the source's `length` and wrapping round.
  // `at(param)` gives where a ray at that param starts and which way it
  // heads. Neighboring params are neighboring rays, which is what lets a
  // new ray be sent out between two that have spread apart (see _refine).

  function pointSource(x, y) {
    return { length: TAU, at: (a) => [x, y, Math.cos(a), Math.sin(a)] };
  }

  // An outline sending rays straight out from every point along it, and
  // fanning round each corner it turns outward at, so the front starts as
  // the outline itself and grows outward, rounding off at the corners.
  // `away` is 1 or -1: which side the rays leave from, by the outline's
  // own winding (1 is outward for a loop with a positive signedArea).
  // Corners that turn the other way get no fan: there the rays from the
  // two sides cross, as a real front would fold.
  function outlineSource(points, away) {
    const n = points.length;
    const sides = points.map(([ax, ay], i) => {
      const [bx, by] = points[(i + 1) % n];
      const length = Math.hypot(bx - ax, by - ay);
      const tx = (bx - ax) / (length || 1);
      const ty = (by - ay) / (length || 1);
      return { ax, ay, tx, ty, length, nx: ty * away, ny: -tx * away };
    });
    const pieces = [];
    let length = 0;
    sides.forEach((side, i) => {
      const prev = sides[(i + n - 1) % n];
      const turn = Math.atan2(prev.nx * side.ny - prev.ny * side.nx, prev.nx * side.nx + prev.ny * side.ny);
      if (turn * away > 1e-6) {
        const span = Math.abs(turn) * FAN_WEIGHT;
        pieces.push({ start: length, span, fan: true, x: side.ax, y: side.ay, a0: Math.atan2(prev.ny, prev.nx), turn });
        length += span;
      }
      if (side.length > 0) {
        pieces.push({ start: length, span: side.length, fan: false, ...side });
        length += side.length;
      }
    });
    const at = (param) => {
      const p = ((param % length) + length) % length;
      let lo = 0;
      let hi = pieces.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pieces[mid].start <= p) lo = mid;
        else hi = mid - 1;
      }
      const piece = pieces[lo];
      const t = Math.min(1, (p - piece.start) / piece.span);
      if (piece.fan) {
        const a = piece.a0 + piece.turn * t;
        return [piece.x, piece.y, Math.cos(a), Math.sin(a)];
      }
      return [piece.ax + piece.tx * piece.length * t, piece.ay + piece.ty * piece.length * t, piece.nx, piece.ny];
    };
    return { length, at };
  }

  // Shoelace. Positive for a loop that runs clockwise on screen.
  function signedArea(points) {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    }
    return area / 2;
  }

  function transformText(ch, transform, wordStart) {
    if (transform === 'uppercase' || (transform === 'capitalize' && wordStart)) return ch.toUpperCase();
    if (transform === 'lowercase') return ch.toLowerCase();
    return ch;
  }

  class Sonar {
    constructor(el, options = {}) {
      if (!el) throw new Error('Sonar: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Two layers: the trail canvas is never fully cleared, so the
      // outlines a ping lights up fade away behind it (see _render); the
      // front canvas is cleared every frame, so the ring itself stays one
      // crisp line.
      this.trailCanvas = document.createElement('canvas');
      this.frontCanvas = document.createElement('canvas');
      this.trailCanvas.className = 'sonar__canvas';
      this.frontCanvas.className = 'sonar__canvas';
      this.el.insertBefore(this.frontCanvas, this.el.firstChild);
      this.el.insertBefore(this.trailCanvas, this.el.firstChild);
      this.trail = this.trailCanvas.getContext('2d');
      this.front = this.frontCanvas.getContext('2d');
      this._applyBackground();

      this._walls = [];
      this._solids = [];
      this._letters = [];
      this._emitters = new Map();
      this._grid = null;
      this._stamp = 0;
      this._pings = [];
      this._echoes = [];
      this._raf = null;
      this._lastNow = performance.now();
      this._nextAuto = this.options.autoPing;
      // Whether the trail canvas has anything on it, and how long since
      // anything new was drawn there; see _render.
      this._dirty = false;
      this._quiet = 0;
      this._fadeDue = 0;

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onClick = this._onClick.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      // Stop the loop once the element has scrolled out of view, same as
      // the other backgrounds.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (on) this._start();
        else this._stop();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.el);

      // A click rather than a pointerdown, as in Fireworks, so a drag (a
      // carousel swipe, a touch scroll, selecting text) doesn't ping.
      this.el.addEventListener('click', this._onClick);

      this._resize();
      this._start();
    }

    _start() {
      if (this._raf || this._reduced || !this._onScreen || !this._busy()) return;
      this._lastNow = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    // The loop only runs while there's something to move or fade, so a
    // page full of idle sonar backgrounds costs nothing.
    _busy() {
      return this._pings.length > 0 || this._dirty || this.options.autoPing > 0;
    }

    // The background is the trail canvas's own CSS background, as in
    // Gears. A dark one also gives the host a class that turns its text
    // white.
    _applyBackground() {
      const { background } = this.options;
      const paints = Boolean(background) && background !== 'transparent';
      this.trailCanvas.style.background = paints ? background : '';
      const host = over(parseRgba(getComputedStyle(this.el).backgroundColor), [255, 255, 255]);
      const isColor = paints && global.CSS.supports('color', background);
      // What the page's own backgrounds are compared against, to tell
      // whether a filled box actually stands out; see _scan.
      this._backdrop = isColor ? over(parseRgba(background), host) : host;
      const [r, g, b] = this._backdrop;
      this.el.classList.toggle('bg-sonar--dark', isColor && 0.2126 * r + 0.7152 * g + 0.0722 * b < 128);
    }

    // clientWidth/clientHeight, as in the other backgrounds, since the host
    // may sit under a CSS transform the canvases already inherit. A host
    // with no size is hidden, not resized, and is skipped.
    _resize() {
      const width = this.el.clientWidth;
      const height = this.el.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (width === this._w && height === this._h && dpr === this._dpr) return;
      this._dpr = dpr;
      this._w = width;
      this._h = height;
      [this.trailCanvas, this.frontCanvas].forEach((canvas) => {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      // Resizing a canvas wipes it, so there's nothing left to fade. Pings
      // in flight carry on against the walls where they are now.
      this._dirty = false;
      this._scan();
      this._drawFront();
    }

    // --- Walls ----------------------------------------------------------

    // Reads every surface the ring can hit out of the host's content, in
    // px from the inside of the host's border, and files the walls in a
    // grid so a ray only tests the few near it.
    _scan() {
      this._walls = [];
      this._solids = [];
      this._letters = [];
      // The closed outlines read, by element, for origin: 'element'.
      this._emitters = new Map();
      this._surfaces = 0;
      if (!this._w) return;
      const hostRect = this.el.getBoundingClientRect();
      const scaleX = hostRect.width / this.el.offsetWidth || 1;
      const scaleY = hostRect.height / this.el.offsetHeight || 1;
      const originX = hostRect.left + this.el.clientLeft * scaleX;
      const originY = hostRect.top + this.el.clientTop * scaleY;
      this._toLocal = (rect) => ({
        left: (rect.left - originX) / scaleX,
        top: (rect.top - originY) / scaleY,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
      });
      const clip = { left: 0, top: 0, right: this._w, bottom: this._h };
      this._range = document.createRange();
      this._walkChildren(this.el, getComputedStyle(this.el), clip, this._backdrop);
      this._range = null;
      this._index();
    }

    _walkChildren(el, style, clip, backdrop) {
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) this._scanText(node, style, clip);
        else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('sonar__canvas')) this._scanElement(node, clip, backdrop);
      }
    }

    // A visible border or fill makes the element a wall, and a filled one
    // is solid, so nothing inside it is read. An element with only a
    // border is still read inside, so a ping that starts in there bounces
    // around in there; one from outside can't get in to reach it.
    _scanElement(el, clip, backdrop) {
      const tag = el.tagName.toUpperCase();
      if (SKIPPED.has(tag)) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || parseFloat(style.opacity) === 0) return;
      if (style.display === 'contents') {
        this._walkChildren(el, style, clip, backdrop);
        return;
      }
      const rect = this._toLocal(el.getBoundingClientRect());
      const sized = rect.width >= 1 && rect.height >= 1;
      const shown = style.visibility === 'visible' && sized;

      let solid = shown && REPLACED.has(tag);
      let inner = backdrop;
      const fill = parseRgba(style.backgroundColor);
      if (fill[3] > 0) {
        inner = over(fill, backdrop);
        if (shown && differs(inner, backdrop)) solid = true;
      }
      if (shown && (style.backgroundImage !== 'none' || style.boxShadow !== 'none')) solid = true;

      if (solid) {
        const points = outline(rect, style);
        this._addLoop(points, clip);
        this._solids.push(rect);
        this._emitters.set(el, { loops: [points], hollow: false });
        return;
      }

      if (shown) {
        const visible = SIDES.map((side) => parseFloat(style[`border${side}Width`]) > 0
          && style[`border${side}Style`] !== 'none' && style[`border${side}Style`] !== 'hidden'
          && parseRgba(style[`border${side}Color`])[3] > 0);
        if (visible.every(Boolean)) {
          const points = outline(rect, style);
          this._addLoop(points, clip);
          this._emitters.set(el, { loops: [points], hollow: true });
        } else {
          // Only some sides: each one is a straight wall on its own.
          const { left: l, top: t, width: w, height: h } = rect;
          const corners = [[l, t], [l + w, t], [l + w, t + h], [l, t + h]];
          visible.forEach((on, i) => {
            if (on) this._addWall(...corners[i], ...corners[(i + 1) % 4], clip);
          });
        }
      }

      // A clipping element with no size, like a closed drawer, clips its
      // children away entirely.
      const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
      const childClip = clips
        ? intersect(clip, { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height })
        : clip;
      if (childClip.right <= childClip.left || childClip.bottom <= childClip.top) return;
      this._walkChildren(el, style, childClip, inner);
    }

    // Text is solid. Traced, each letter is its own outline, placed where
    // the browser laid that letter out. Otherwise each word is a box, so a
    // ring can still slip between lines and round short words; a word
    // that wraps gives one box per line.
    _scanText(node, style, clip) {
      if (style.visibility !== 'visible' || parseRgba(style.color)[3] === 0) return;
      const { text } = this.options;
      const size = parseFloat(style.fontSize);
      if (text === 'glyphs' || (text === 'auto' && size >= GLYPH_SIZE)) {
        this._scanGlyphs(node, style, size, clip);
        return;
      }
      const content = node.textContent;
      const range = this._range;
      const words = /\S+/g;
      let match;
      while ((match = words.exec(content))) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const rect = this._toLocal(rects[i]);
          if (rect.width < 1 || rect.height < 1) continue;
          const { left: l, top: t, width: w, height: h } = rect;
          this._addLoop([[l, t], [l + w, t], [l + w, t + h], [l, t + h]], clip);
          this._solids.push(rect);
        }
      }
    }

    _scanGlyphs(node, style, size, clip) {
      const font = `${style.fontStyle} ${style.fontVariant === 'small-caps' ? 'small-caps ' : ''}${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const [ascent, descent] = metricsOf(font);
      const content = node.textContent;
      const range = this._range;
      let wordStart = true;
      for (let i = 0; i < content.length;) {
        const ch = String.fromCodePoint(content.codePointAt(i));
        const end = i + ch.length;
        if (/\s/.test(ch)) {
          wordStart = true;
          i = end;
          continue;
        }
        range.setStart(node, i);
        range.setEnd(node, end);
        const box = range.getClientRects()[0];
        const loops = box ? glyphOutline(font, size, transformText(ch, style.textTransform, wordStart)) : [];
        wordStart = false;
        i = end;
        if (!loops.length) continue;
        const rect = this._toLocal(box);
        const baseline = rect.top + (rect.height - (ascent + descent)) / 2 + ascent;
        const placed = loops.map((loop) => loop.map(([x, y]) => [rect.left + x, baseline + y]));
        placed.forEach((loop) => this._addLoop(loop, clip));
        this._letters.push({ rect, loops: placed });
      }
    }

    // A closed outline, its walls grouped into smooth surfaces: a new one
    // starts at each corner, and if the outline has none (a circle) it's
    // all one surface.
    _addLoop(points, clip) {
      const n = points.length;
      const heading = (i) => {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % n];
        return Math.atan2(by - ay, bx - ax);
      };
      const corner = (i) => Math.abs(Math.atan2(Math.sin(heading(i) - heading((i + n - 1) % n)), Math.cos(heading(i) - heading((i + n - 1) % n)))) > CORNER;
      // Start at a corner if there is one, so no surface wraps round
      // the start.
      let start = 0;
      while (start < n && !corner(start)) start++;
      if (start === n) start = 0;
      // Within a smooth surface, each vertex's normal is the average of
      // the two walls either side of it, and a wall's normal is blended
      // between its two ends (see _cast), so the polygon reflects like
      // the curve it stands for rather than as a row of flat mirrors. At a
      // corner each wall keeps its own.
      const normal = (i) => {
        const h = heading(i);
        return [-Math.sin(h), Math.cos(h)];
      };
      const vertexNormal = (i, own) => {
        if (corner(i)) return own;
        const [ax, ay] = normal((i + n - 1) % n);
        const [bx, by] = normal(i);
        const length = Math.hypot(ax + bx, ay + by);
        return length < 1e-6 ? own : [(ax + bx) / length, (ay + by) / length];
      };
      let surface = ++this._surfaces;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        const j = (i + 1) % n;
        if (k > 0 && corner(i)) surface = ++this._surfaces;
        const own = normal(i);
        this._addWall(...points[i], ...points[j], clip, surface, vertexNormal(i, own), vertexNormal(j, own));
      }
    }

    // `startNormal` and `endNormal` are the shading normals at its two
    // ends; a plain wall's are both its own.
    _addWall(ax, ay, bx, by, clip, surface = ++this._surfaces, startNormal = null, endNormal = null) {
      const part = clipSegment(ax, ay, bx, by, clip);
      if (!part) return;
      const [x1, y1, x2, y2, t0, t1] = part;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 0.25) return;
      const tx = (x2 - x1) / length;
      const ty = (y2 - y1) / length;
      const own = [-ty, tx];
      const n0 = startNormal || own;
      const n1 = endNormal || own;
      // Clipped, its ends' normals are blended to where it was cut.
      const blend = (t) => [n0[0] + (n1[0] - n0[0]) * t, n0[1] + (n1[1] - n0[1]) * t];
      this._walls.push({
        ax: x1, ay: y1, bx: x2, by: y2, tx, ty, nx: own[0], ny: own[1],
        n0: blend(t0), n1: blend(t1), surface, mark: 0,
      });
    }

    _index() {
      const cols = Math.ceil(this._w / CELL) + 1;
      const rows = Math.ceil(this._h / CELL) + 1;
      const cells = Array.from({ length: cols * rows }, () => []);
      this._walls.forEach((wall) => {
        const [c0, c1] = this._span(Math.min(wall.ax, wall.bx), Math.max(wall.ax, wall.bx), cols);
        const [r0, r1] = this._span(Math.min(wall.ay, wall.by), Math.max(wall.ay, wall.by), rows);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) cells[r * cols + c].push(wall);
        }
      });
      this._grid = { cols, rows, cells };
    }

    _span(min, max, count) {
      return [
        Math.max(0, Math.min(count - 1, Math.floor(min / CELL))),
        Math.max(0, Math.min(count - 1, Math.floor(max / CELL))),
      ];
    }

    // The first wall crossed going from (px, py) to (qx, qy), as the share
    // of the way there it's crossed at, or null.
    _firstHit(px, py, qx, qy) {
      const { cols, rows, cells } = this._grid;
      const [c0, c1] = this._span(Math.min(px, qx), Math.max(px, qx), cols);
      const [r0, r1] = this._span(Math.min(py, qy), Math.max(py, qy), rows);
      const stamp = ++this._stamp;
      const rx = qx - px;
      const ry = qy - py;
      let best = null;
      let bestT = Infinity;
      let bestU = 0;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = cells[r * cols + c];
          for (let i = 0; i < cell.length; i++) {
            const wall = cell[i];
            if (wall.mark === stamp) continue;
            wall.mark = stamp;
            const sx = wall.bx - wall.ax;
            const sy = wall.by - wall.ay;
            const den = rx * sy - ry * sx;
            if (Math.abs(den) < 1e-9) continue;
            const wx = wall.ax - px;
            const wy = wall.ay - py;
            const t = (wx * sy - wy * sx) / den;
            if (t <= 1e-6 || t > 1 || t >= bestT) continue;
            const u = (wx * ry - wy * rx) / den;
            if (u < -1e-6 || u > 1 + 1e-6) continue;
            best = wall;
            bestT = t;
            bestU = u;
          }
        }
      }
      return best ? { wall: best, t: bestT, u: Math.max(0, Math.min(1, bestU)) } : null;
    }

    // --- Pings ----------------------------------------------------------

    _insideSolid(x, y) {
      return this._solids.some((rect) => contains(rect, x, y))
        || this._letters.some(({ rect, loops }) => contains(rect, x, y) && insideLoops(loops, x, y));
    }

    // Sends a ping out from (x, y), in px from the inside of the element's
    // top-left corner. Returns false, and sends nothing, from a spot
    // inside something solid, since the ring would be hidden behind it.
    ping(x, y) {
      if (!this._w) return false;
      this._scan();
      if (x < 0 || y < 0 || x > this._w || y > this._h || this._insideSolid(x, y)) return false;
      const count = Math.max(MIN_RAYS, Math.min(MAX_RAYS, Math.round((TAU * this.options.range) / RAY_SPACING)));
      this._send([this._launch(pointSource(x, y), count, TAU / count)]);
      return true;
    }

    // Sends a ping out from the outline of `el`, or of the nearest element
    // round it that the ring would bounce off: one with a visible border
    // all the way round, or a filled one. Returns false, and sends
    // nothing, if there isn't one inside this element.
    emit(el) {
      if (!this._w || !el || !this.el.contains(el)) return false;
      this._scan();
      const found = this._emitterOf(el);
      if (found) this._emitFrom(found);
      return Boolean(found);
    }

    _emitterOf(el) {
      for (let node = el; node && node !== this.el; node = node.parentElement) {
        const found = this._emitters.get(node);
        if (found) return found;
      }
      return null;
    }

    // What a click at (x, y) on `target` sends a ping out from: the letter
    // whose ink it landed on, if any, since that's the most specific
    // thing under the cursor; otherwise the nearest element round the
    // target with an outline.
    _emitterAt(target, x, y) {
      const letter = this._letters.find(({ rect, loops }) => contains(rect, x, y) && insideLoops(loops, x, y));
      if (letter) return { loops: letter.loops, hollow: false };
      return this._emitterOf(target);
    }

    // Each of the shape's outlines sends a ping outward, away from what
    // it encloses. A letter's holes go the same way round as its ink, so
    // they send theirs into the hole. A hollow box (a border with nothing
    // filled in) sends one inward too, to bounce round inside it.
    _emitFrom({ loops, hollow }) {
      const outer = loops.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
      const away = Math.sign(signedArea(outer)) || 1;
      const pings = [];
      loops.forEach((points) => {
        pings.push(this._launchOutline(points, away));
        if (hollow) pings.push(this._launchOutline(points, -away));
      });
      this._send(pings);
    }

    _launchOutline(points, away) {
      const source = outlineSource(points, away);
      const count = Math.max(MIN_RAYS, Math.min(MAX_RAYS, Math.round(source.length / OUTLINE_SPACING)));
      return this._launch(source, count, 0);
    }

    // `step` is how far apart neighboring rays spread per px travelled,
    // which only a point source has; see _pairs.
    _launch(source, count, step) {
      const rays = [];
      for (let i = 0; i < count; i++) rays.push(this._spawn(source, (i / count) * source.length));
      return { source, rays, travelled: 0, step };
    }

    _spawn(source, param) {
      const [x, y, dx, dy] = source.at(param);
      return { x: x + dx * START_OFFSET, y: y + dy * START_OFFSET, dx, dy, param, bounces: 0, path: 0, alive: true };
    }

    _send(pings) {
      if (this._reduced) {
        this._pingStill(pings);
        return;
      }
      this._pings.push(...pings);
      if (this._pings.length > MAX_PINGS) this._pings.splice(0, this._pings.length - MAX_PINGS);
      this._start();
    }

    // How strong a ray is: fading with distance, and by `reflectivity`
    // with each bounce.
    _strength(ping, bounces) {
      return Math.max(0, 1 - ping.travelled / this.options.range) * this.options.reflectivity ** bounces;
    }

    // Moves a ray `distance` along, bouncing off each wall in its way and,
    // unless `quiet`, leaving an echo where it struck.
    _cast(ping, ray, distance, quiet = false) {
      let left = distance;
      for (let n = 0; n < MAX_BOUNCES_PER_STEP && left > 0; n++) {
        const qx = ray.x + ray.dx * left;
        const qy = ray.y + ray.dy * left;
        const hit = this._firstHit(ray.x, ray.y, qx, qy);
        if (!hit) {
          ray.x = qx;
          ray.y = qy;
          return;
        }
        const { wall, t, u } = hit;
        const hx = ray.x + (qx - ray.x) * t;
        const hy = ray.y + (qy - ray.y) * t;
        const dot = ray.dx * wall.nx + ray.dy * wall.ny;
        // The side of the wall it came from.
        const side = dot > 0 ? -1 : 1;
        const strength = this._strength(ping, ray.bounces);
        if (!quiet && strength > MIN_ALPHA) {
          this._echoes.push({ x: hx + wall.nx * side * ECHO_OFFSET, y: hy + wall.ny * side * ECHO_OFFSET, alpha: strength });
        }
        // Reflected about the blended normal, unless that would send it
        // on into the wall (possible right by a vertex on a tight curve),
        // when it's reflected about the wall's own.
        let mx = wall.n0[0] + (wall.n1[0] - wall.n0[0]) * u;
        let my = wall.n0[1] + (wall.n1[1] - wall.n0[1]) * u;
        const ml = Math.hypot(mx, my) || 1;
        mx /= ml;
        my /= ml;
        const shaded = ray.dx * mx + ray.dy * my;
        const rx = ray.dx - 2 * shaded * mx;
        const ry = ray.dy - 2 * shaded * my;
        if ((rx * wall.nx + ry * wall.ny) * side > 0) {
          ray.dx = rx;
          ray.dy = ry;
        } else {
          ray.dx -= 2 * dot * wall.nx;
          ray.dy -= 2 * dot * wall.ny;
        }
        ray.x = hx + wall.nx * side * NUDGE;
        ray.y = hy + wall.ny * side * NUDGE;
        ray.bounces++;
        // Which surfaces it has bounced off, in order, folded into one
        // number; see _pairs.
        ray.path = (Math.imul(ray.path, 31) + wall.surface) | 0;
        left *= 1 - t;
      }
    }

    _advance(dt) {
      const { autoPing } = this.options;
      if (autoPing > 0) {
        this._nextAuto -= dt;
        if (this._nextAuto <= 0) {
          this._nextAuto = autoPing;
          this._autoPing();
        }
      }
      const distance = this.options.speed * dt;
      for (let p = this._pings.length - 1; p >= 0; p--) {
        const ping = this._pings[p];
        ping.travelled += distance;
        let alive = 0;
        ping.rays.forEach((ray) => {
          if (!ray.alive) return;
          this._cast(ping, ray, distance);
          if (this._outside(ray) || this._strength(ping, ray.bounces) <= MIN_ALPHA) {
            ray.alive = false;
          } else {
            alive++;
          }
        });
        if (!alive || ping.travelled >= this.options.range) this._pings.splice(p, 1);
        else this._refine(ping);
      }
    }

    // Fills a front in wherever two neighbors on it have spread apart, as
    // a curved surface spreads a reflection: a new ray is sent out between
    // them from the ping's start and brought up to where the rest are.
    // Without it a front reflected off a curve, a letter's bowl or a round
    // corner, would be drawn as a few long straight chords. Neighbors that
    // have bounced off different surfaces aren't one front, so the gap
    // between them is left alone; so is a new ray that turns out to hit
    // something its neighbors missed, which is how a small thing between
    // two rays still gets found.
    _refine(ping) {
      const { rays } = ping;
      const gap2 = REFINE_GAP * REFINE_GAP;
      let added = 0;
      for (let i = 0; i < rays.length && added < REFINE_PER_FRAME && rays.length < MAX_REFINED; i++) {
        const a = rays[i];
        const last = i === rays.length - 1;
        const b = rays[last ? 0 : i + 1];
        if (!a.alive || !b.alive || a.tear || a.path !== b.path) continue;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= gap2) continue;
        // Between the last ray and the first, the param wraps round.
        const span = b.param - a.param + (last ? ping.source.length : 0);
        if (span < MIN_REFINE_SPAN) {
          a.tear = true;
          continue;
        }
        rays.splice(i + 1, 0, this._trace(ping, a.param + span / 2));
        added++;
        // Look at `a` again, against the new ray.
        i--;
      }
    }

    // A ray sent from the ping's source at `param` as far as the ping has
    // travelled, quietly, since the echoes along the way were left by the
    // rays either side of it.
    _trace(ping, param) {
      const ray = this._spawn(ping.source, param);
      for (let left = ping.travelled; left > 0 && ray.alive; left -= TRACE_CHUNK) {
        this._cast(ping, ray, Math.min(TRACE_CHUNK, left), true);
        if (this._outside(ray)) ray.alive = false;
      }
      if (this._strength(ping, ray.bounces) <= MIN_ALPHA) ray.alive = false;
      return ray;
    }

    // The host's own edges aren't walls: a ray that reaches one leaves.
    _outside(ray) {
      return ray.x < -2 || ray.y < -2 || ray.x > this._w + 2 || ray.y > this._h + 2;
    }

    // A few tries for a random spot that isn't inside something solid.
    _autoPing() {
      for (let i = 0; i < 10; i++) {
        if (this.ping(Math.random() * this._w, Math.random() * this._h)) return;
      }
    }

    // Reduced motion: the whole ping (or the several one click sends out)
    // is worked out at once and only the points it leaves are drawn, and
    // they stay until the next click.
    _pingStill(pings) {
      const step = 6;
      this._echoes = [];
      pings.forEach((ping) => {
        while (ping.travelled < this.options.range) {
          ping.travelled += step;
          ping.rays.forEach((ray) => {
            if (!ray.alive) return;
            this._cast(ping, ray, step);
            if (this._outside(ray) || this._strength(ping, ray.bounces) <= MIN_ALPHA) ray.alive = false;
          });
        }
      });
      const { trail: ctx, _w: w, _h: h, _dpr: dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this._drawEchoes();
      this._drawFront();
    }

    // --- Drawing --------------------------------------------------------

    _tick(now) {
      // Floored at 0 too: the first frame's timestamp can come in a hair
      // before the performance.now() that _start read.
      const dt = Math.max(0, Math.min(0.05, (now - this._lastNow) / 1000));
      this._lastNow = now;
      this._advance(dt);
      this._render(dt);
      this._raf = this._busy() && this._onScreen ? requestAnimationFrame(this._tick) : null;
    }

    // Calls `segment(a, b, bounces)` for each pair of neighboring rays
    // that are both still going and part of one front. Two that have
    // bounced off the same surfaces in the same order are, however far
    // apart a curved one has spread them. Two that haven't are only while
    // they're about as close as they started out, which joins the fold
    // where a front turns back off a wall but not the tear at a corner.
    _pairs(ping, segment) {
      const { rays } = ping;
      const near = Math.max(10, 2.5 * ping.travelled * ping.step);
      for (let i = 0; i < rays.length; i++) {
        const a = rays[i];
        const b = rays[(i + 1) % rays.length];
        if (!a.alive || !b.alive || a.tear) continue;
        const limit = a.path === b.path ? Math.max(near, MAX_JOIN) : near;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > limit * limit) continue;
        segment(a, b, Math.min(a.bounces, b.bounces));
      }
    }

    // One path per bounce count, since every ray in a ping that has
    // bounced as often is as strong; each is drawn as one connected line
    // wherever the pairs run on from each other.
    _strokeFront(ctx, ping, alphaScale) {
      const paths = new Map();
      this._pairs(ping, (a, b, bounces) => {
        let entry = paths.get(bounces);
        if (!entry) {
          entry = { path: new Path2D(), last: null };
          paths.set(bounces, entry);
        }
        if (entry.last !== a) entry.path.moveTo(a.x, a.y);
        entry.path.lineTo(b.x, b.y);
        entry.last = b;
      });
      paths.forEach(({ path }, bounces) => {
        const alpha = this._strength(ping, bounces) * alphaScale;
        if (alpha <= MIN_ALPHA * alphaScale) return;
        ctx.globalAlpha = alpha;
        ctx.stroke(path);
      });
    }

    // Each echo is one small square point where a ray struck, so what a
    // ping hits builds up as a cloud of points along its outline: dense
    // close to where it started, where the rays are close together, and
    // sparser further out.
    _drawEchoes() {
      const ctx = this.trail;
      ctx.fillStyle = this.options.color;
      const size = this.options.lineWidth * 1.5;
      const half = size / 2;
      this._echoes.forEach((echo) => {
        ctx.globalAlpha = echo.alpha;
        ctx.fillRect(echo.x - half, echo.y - half, size, size);
      });
      ctx.globalAlpha = 1;
      if (this._echoes.length) this._dirty = true;
      this._echoes = [];
    }

    // The trail canvas is never fully cleared while there's something on
    // it: each frame erases a share of what's there, then draws the echoes
    // just left, so the outlines a ping lights up fade out behind it. Once
    // nothing new has been drawn for `fade` seconds what's left is wiped
    // clean, faint leftovers and all.
    _render(dt) {
      if (!this._w) return;
      const { trail: ctx, _w: w, _h: h, _dpr: dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fade = Math.max(0.05, this.options.fade);
      const tau = fade / 3;

      if (this._dirty) {
        this._fadeDue += dt;
        if (this._fadeDue >= -Math.log(1 - MIN_FADE) * tau) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-this._fadeDue / tau)})`;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';
          this._fadeDue = 0;
        }
      }

      if (this._echoes.length) {
        this._drawEchoes();
        this._quiet = 0;
      } else if (this._dirty && !this._pings.length) {
        this._quiet += dt;
        if (this._quiet >= fade) {
          ctx.clearRect(0, 0, w, h);
          this._dirty = false;
          this._fadeDue = 0;
        }
      }

      this._drawFront();
    }

    _drawFront() {
      if (!this._w) return;
      const { front: ctx, _w: w, _h: h, _dpr: dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = this.options.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (this.options.showWalls) {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        this._walls.forEach((wall) => {
          ctx.moveTo(wall.ax, wall.ay);
          ctx.lineTo(wall.bx, wall.by);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const { glow, lineWidth } = this.options;
      if (glow > 0) {
        ctx.lineWidth = lineWidth * GLOW_WIDTH;
        this._pings.forEach((ping) => this._strokeFront(ctx, ping, glow));
      }
      ctx.lineWidth = lineWidth;
      this._pings.forEach((ping) => this._strokeFront(ctx, ping, 1));
      ctx.globalAlpha = 1;
    }

    // --- Input ----------------------------------------------------------

    _onClick(event) {
      if (!this.options.clickToPing || event.button !== 0) return;
      // Mapped through the rendered size, so a host scaled by a CSS
      // transform still pings under the cursor.
      const rect = this.el.getBoundingClientRect();
      const scaleX = rect.width / this.el.offsetWidth || 1;
      const scaleY = rect.height / this.el.offsetHeight || 1;
      const x = (event.clientX - rect.left) / scaleX - this.el.clientLeft;
      const y = (event.clientY - rect.top) / scaleY - this.el.clientTop;
      if (this.options.origin === 'element') {
        // Here a click on a button or link is the whole point, so it pings
        // from the button, and the click still goes on to do whatever it
        // does.
        this._scan();
        const found = this._emitterAt(event.target, x, y);
        if (found) {
          this._emitFrom(found);
          return;
        }
      } else {
        // Leave clicks on the host's own controls alone. Only ones inside
        // the host, though: a host that is itself inside a link still
        // pings.
        const control = event.target.closest('a, button, input, select, textarea, label, [contenteditable]');
        if (control && this.el.contains(control) && control !== this.el) return;
      }
      this.ping(x, y);
    }

    // --- API ------------------------------------------------------------

    // Apply new option values (e.g. from a control panel). Everything
    // applies on the next frame, pings in flight included, except `text`,
    // which the next ping reads the page with.
    update(newOptions = {}) {
      const autoChanged = 'autoPing' in newOptions && newOptions.autoPing !== this.options.autoPing;
      Object.assign(this.options, newOptions);
      if ('background' in newOptions) this._applyBackground();
      if (autoChanged) this._nextAuto = Math.min(this._nextAuto, this.options.autoPing) || this.options.autoPing;
      if (this.options.showWalls && ('showWalls' in newOptions || 'text' in newOptions)) this._scan();
      this._drawFront();
      this._start();
    }

    // Reads the walls again and redraws them, for when the host's content
    // changes while `showWalls` is on. Pings always read them fresh.
    refresh() {
      this._scan();
      this._drawFront();
    }

    destroy() {
      this._stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      this.el.removeEventListener('click', this._onClick);
      this.el.classList.remove('bg-sonar--dark');
      this.trailCanvas.remove();
      this.frontCanvas.remove();
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__sonarInstance;
    }
  }

  Sonar.initAll = function (selector = '.bg-sonar', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__sonarInstance)
      .map((el) => {
        const instance = new Sonar(el, options);
        el.__sonarInstance = instance;
        return instance;
      });
  };

  // Look up the instance auto-created for a single element (or the first
  // match of a selector) — use this instead of `initAll()` from page code,
  // since auto-init has usually already claimed the element by the time a
  // page's own script runs.
  Sonar.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__sonarInstance || null : null;
  };

  Sonar.getAll = function (selector = '.bg-sonar') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__sonarInstance)
      .filter(Boolean);
  };

  global.Sonar = Sonar;

  function autoInit() {
    Sonar.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
