/**
 * OuterWorlds
 * -----------
 * A canvas background showing a patch of a randomly generated planet.
 * Moving the cursor across it spins the globe under your hand and lets go
 * with momentum, so the world keeps gliding and coasts to a stop; left
 * alone it drifts on forever at its own slow rotation.
 *
 * The same terrain draws in any of three styles (`mode`):
 *
 *   'dots' - a halftone field. Open ocean is a faint lattice, coastlines
 *            dither in as the dots grow, and continental interiors and
 *            mountain chains close up into solid ink.
 *   'wire' - a mesh of parallels and meridians laid over the globe and
 *            pushed outward wherever it crosses land, so continents rise
 *            out of the grid as relief.
 *   'map'  - filled landmasses with a traced coastline drawn around them,
 *            over a flat sea wash. The classic one.
 *
 * and in either of two projections (`projection`): 'globe' as a sphere, or
 * 'flat' as an endless plane - not the globe unrolled, since a sphere
 * flattened still has a top and a bottom where its poles were, but a map
 * that simply keeps going in every direction. See PlaneGrid.
 *
 * Every element gets its own world, generated from its own seed.
 *
 * The map itself comes from shared/world-map.js (bundled into this file when
 * served - see internal/httpserver/routes.go), which samples 3D noise at
 * points on a sphere. That choice is what makes the panning unbounded: there
 * is no edge to reach, no seam at ±180°, and no "generate the next chunk"
 * step, because every point on the planet already has an elevation waiting to
 * be asked for. This file only has to decide which of those points are
 * currently on screen and how to ink each one.
 *
 * Two coordinate spaces are in play throughout:
 *
 *   world  - longitude/latitude in radians, what the lattice is indexed by.
 *   screen - px from the canvas centre, x right and y UP (the canvas's own
 *            y-down flip happens once, at the point a dot is drawn).
 *
 * Usage: give any element `class="bg-outer-worlds"` - this file injects its
 * own CSS and auto-initializes every matching element on load, so dropping
 * the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'outer-worlds-styles';
  const CSS = `
.bg-outer-worlds {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.outer-worlds__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  display: block;
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const TAU = Math.PI * 2;
  const HALF_PI = Math.PI / 2;
  const DEG = Math.PI / 180;

  const DEFAULTS = {
    // How the world is drawn: 'dots' for the halftone field, 'wire' for a
    // relief-displaced mesh, 'map' for filled landmasses with a drawn
    // coastline. All three read the same terrain — only the ink changes.
    mode: 'dots',
    // 'globe' views the world as a sphere, with the curvature that implies.
    // 'flat' is an endless plane instead: no curvature, no poles, no edges
    // in any direction. It is a different world from the globe rather than
    // the same one unrolled — flattening a sphere leaves a top and a bottom
    // where its poles were — so the seed drives both but they are not the
    // same terrain. `scale` still means the globe's radius in px, so a flat
    // view usually wants a much lower one to cover a useful span.
    projection: 'globe',
    // Screen distance between neighbouring sample points at the view
    // centre, in px. Also sets the resolution of the world itself: the
    // lattice is built to match, so a finer spacing is a more detailed
    // planet, not a zoomed one. In 'dots' it is the dot spacing; in 'wire'
    // it is the detail along each line.
    dotSpacing: 13,
    // Globe radius as a multiple of half the host element's diagonal, so
    // it means the same thing at any aspect ratio. Larger is a closer,
    // flatter view; at exactly 1 the planet's limb touches the corners of
    // the element, and below that the whole globe comes into frame with
    // background showing around it.
    scale: 1.25,
    // Whether the cursor can turn the world at all. Off leaves it to
    // `autoSpin` alone — a background that moves but never reacts, which is
    // what you want behind anything the reader is meant to be reading.
    interactive: true,
    // Fraction of a pointer's movement the globe follows. 1 tracks the
    // cursor exactly.
    sensitivity: 1,
    // Seconds of glide after the pointer stops: the time constant of the
    // exponential decay back to the idle drift, so ~3x this is how long a
    // fling stays visibly in motion. 0 stops the world almost immediately.
    momentum: 1.1,
    // Idle rotation in degrees of longitude per second, always eastward.
    // 0 leaves the world still until the cursor touches it.
    autoSpin: 0.8,
    // How far toward the poles the view can be pushed, in degrees. Globe
    // only: a plane has no pole to stop at.
    maxLat: 78,
    // Elevation that counts as the waterline. Purely a threshold on an
    // already-generated world, so dragging it around re-floods the same
    // planet rather than making a new one.
    seaLevel: 0.1,
    // Elevation above seaLevel at which a dot reaches full size. Wider
    // means a longer halftone ramp, so interior relief and mountain chains
    // stay visible as dot-size texture instead of flooding to solid black.
    landRange: 0.42,
    // --- wireframe mode ---
    // Distance between mesh lines at the view centre, in px. Independent of
    // dotSpacing: the mesh is deliberately coarser than the terrain detail
    // running along each line.
    meshSpacing: 34,
    // How far full-elevation land is pushed out from the sphere's surface,
    // as a fraction of the globe's radius. This is what makes continents
    // read as relief rising out of the mesh rather than as flat shading.
    relief: 0.05,
    // Stroke width of the ocean mesh and of the map coastline, in px. Land
    // mesh lines are drawn slightly heavier (see LAND_LINE_SCALE) so
    // coastlines carry weight.
    lineWidth: 1,

    // --- map mode ---
    // Opacity of the land fill relative to the coastline drawn around it.
    // Low values give the classic look: a light tint inside a crisp
    // outline, both from the same `landColor`. 1 fills land solid.
    fillAlpha: 0.16,

    // --- color ---
    // Opacity of everything over open water — the ocean lattice in 'dots',
    // the mesh over sea in 'wire'. It carries the rotation across empty
    // ocean, where there'd otherwise be nothing moving to see. 0 leaves the
    // oceans blank.
    oceanAlpha: 0.13,
    background: '#ffffff',
    // RGB triplets (no `rgb()` wrapper). Both `oceanColor` and
    // `borderColor` fall back to `landColor` when left null, so one color
    // is enough until the parts should differ — which in 'map' they
    // usually should, that style being three flat inks and an outline.
    landColor: '0, 0, 0',
    oceanColor: null,
    // 'map' only: the coastline drawn around the land fill.
    borderColor: null,

    // --- world generation, passed through to WorldMap ---
    // null picks a random world; pass a number to pin one.
    seed: null,
    // Tuned against the default `scale`: a couple of landmasses and open
    // water between them in frame at once. Raising it much past 3 stops
    // reading as a map and starts reading as camouflage.
    frequency: 2.3,
    octaves: 6,
    warp: 0.38,
    ridge: 0.5,
    landBias: 0,
  };

  // WorldMap options this effect forwards. Anything not listed keeps the
  // generator's own default.
  const MAP_KEYS = ['seed', 'frequency', 'octaves', 'warp', 'ridge', 'landBias', 'seaLevel', 'landRange'];

  // Time constant for the velocity estimate while the pointer is driving.
  // Short enough that a flick is captured, long enough that one jittery
  // event can't turn into a fling on release.
  const GRAB_TAU = 0.06;
  // Ceiling on that estimate, in rad/sec of rotation - roughly one full
  // revolution per second. Stops a single huge pointer jump (a tab regaining
  // focus under a moved cursor, say) from launching the world into a blur.
  const MAX_RATE = 6;

  // Land mesh lines are drawn this much heavier than ocean ones, so a
  // coastline reads as a weight change and not only as an opacity one.
  const LAND_LINE_SCALE = 1.4;
  // Map mode's coastline, relative to `lineWidth`.
  const COAST_LINE_SCALE = 1.3;
  // A flat sheet has no outward direction to push relief along, so it
  // becomes a lift up the page instead; this keeps that lift roughly the
  // size of the globe's at the same `relief` value.
  const FLAT_RELIEF_SCALE = 0.5;
  // Hard ceiling on the samples one row may walk. A plane has no wrap to
  // bound it, so this is what stops an extreme zoom-out from asking for an
  // unbounded march.
  const MAX_ROW_STEPS = 4000;
  // Roughly how many points a frame may draw, which is what sets the floor
  // under `dotSpacing`. Spacing costs points quadratically — halving it
  // quadruples them — so a hero-sized element at 1px would otherwise ask for
  // around a million a frame and lock the tab up. WorldMap's MAX_ROWS bounds
  // this on a zoomed-in globe, where the lattice runs out of rows before the
  // spacing runs out of px, but a zoomed-out or flat view never reaches that
  // cap: the budget has to come from the element's own area instead.
  //
  // The number is set by what a frame costs rather than by what looks finest.
  // Nearly all of that cost is rasterizing the dots, not working out where
  // they go: measured here at roughly 1.1µs per dot against 0.12µs of path
  // building, so the budget is really a drawing budget that the sampling
  // happens to share. 25k keeps a single full-width element inside a frame
  // with room to spare, and is about four times the density the default
  // `dotSpacing` asks for — enough headroom that the fine end of the range
  // is visibly finer, without the budget becoming a number only this year's
  // hardware can pay. The old 120k was none of that: a hero and two cards at
  // the finest setting came to ~300k dots and ~400ms a frame.
  //
  // Note this is per element, so a page showing several worlds at once
  // spends several budgets. That is deliberate — an element cannot see its
  // siblings — but it means a demo page of three is a heavier case than
  // anything a real page does.
  const MAX_SAMPLES = 25000;
  // Closest two meridians may get, as a fraction of `meshSpacing`, before
  // the mesh starts thinning them out toward the pole.
  const MERIDIAN_MIN_SPACING = 0.45;

  // How much the plane's terrain is scaled down relative to the globe's.
  //
  // A flat view has to be zoomed a long way out to show a useful span,
  // which means several times more terrain per dot than a globe view of the
  // same element - and a coastline only reads as a coastline if it has a
  // few dots to dither across. At 1 the flat styles cross from sea to solid
  // land inside a single cell, and because a flat grid is perfectly
  // axis-aligned those one-cell steps line up into straight vertical edges.
  // This brings detail-per-pixel back in line with the globe's.
  const PLANE_TERRAIN_SCALE = 0.4;

  // Marching-squares tables, indexed by which of a cell's four corners sit
  // above the waterline: bit 0 bottom-left, 1 bottom-right, 2 top-right,
  // 3 top-left. Vertex codes 0-3 are those corners and 4-7 the waterline
  // crossings of the bottom, right, top and left edges.
  //
  // MS_POLYS is the part of the cell that is land, wound the same way in
  // every case so the pieces of one fill never cancel each other out.
  // MS_LINES is where the coastline crosses. The two diagonal cases (5 and
  // 10) are genuinely ambiguous — the two land corners may or may not be
  // joined — and are resolved as separate corners, which keeps narrow
  // channels open rather than pinching them shut.
  const MS_POLYS = [
    [],
    [[0, 4, 7]],
    [[1, 5, 4]],
    [[0, 1, 5, 7]],
    [[2, 6, 5]],
    [[0, 4, 7], [2, 6, 5]],
    [[1, 2, 6, 4]],
    [[0, 1, 2, 6, 7]],
    [[3, 7, 6]],
    [[3, 0, 4, 6]],
    [[1, 5, 4], [3, 7, 6]],
    [[3, 0, 1, 5, 6]],
    [[2, 3, 7, 5]],
    [[2, 3, 0, 4, 5]],
    [[1, 2, 3, 7, 4]],
    [[0, 1, 2, 3]],
  ];
  const MS_LINES = [
    [], [[7, 4]], [[4, 5]], [[7, 5]], [[5, 6]], [[7, 4], [5, 6]], [[4, 6]], [[6, 7]],
    [[6, 7]], [[6, 4]], [[4, 5], [6, 7]], [[6, 5]], [[5, 7]], [[5, 4]], [[4, 7]], [],
  ];

  // Points sampled along each edge of the viewport when working out what's
  // visible. 24 is well past the point where a tighter window stops saving
  // any dots, and the whole ring costs 4 dozen inverse projections a frame.
  const EDGE_SAMPLES = 24;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Commands a PathBuffer can hold - the three the renderers below draw with.
  const OP_MOVE = 0;
  const OP_LINE = 1;
  const OP_ARC = 2;

  /**
   * A stand-in for Path2D that records its commands into flat arrays and
   * replays them into a canvas context's own path.
   *
   * This is not a micro-optimization, it's the difference between the effect
   * running and the tab dying. A Path2D built fresh each frame and handed to
   * `ctx.fill(path)` is retained by the renderer process, at roughly 130
   * bytes per sub-path, for far longer than the frame that drew it - and a
   * halftone field is one sub-path per dot. Measured on the demo page with
   * Detail at its finest, three worlds on screen drawing ~300k dots a frame
   * between them: the renderer process climbed about a gigabyte a second,
   * from 300MB to 5.6GB in eleven seconds, and was then killed - with the JS
   * heap sitting flat at 14MB the whole time, which is why nothing about it
   * looks like a leak from inside the page. The same drawing through
   * `ctx.beginPath()` holds steady indefinitely, because the context reuses
   * one path across frames instead of accumulating a new one each time.
   *
   * So the renderers build into one of these, and it lays the result into the
   * context at the end. Same commands, same pixels, and after the first few
   * frames at a given detail level, no allocation at all: the arrays have
   * grown to what that frame needs and are simply rewritten from the start on
   * every frame after.
   *
   * `arc` is implemented only in the full-circle form the halftone uses.
   */
  class PathBuffer {
    constructor() {
      this.ops = new Uint8Array(1024);
      this.data = new Float32Array(2048);
      // Float32 rather than Float64 because these are screen px: at the far
      // side of a 4000px canvas a float still resolves to a five-thousandth
      // of a pixel, which is well past anything the rasterizer can show.
      this.n = 0;
      this.m = 0;
    }

    reset() {
      this.n = 0;
      this.m = 0;
      return this;
    }

    _room(floats) {
      if (this.n === this.ops.length) {
        const ops = new Uint8Array(this.n * 2);
        ops.set(this.ops);
        this.ops = ops;
      }
      if (this.m + floats > this.data.length) {
        const data = new Float32Array(Math.max(this.data.length * 2, this.m + floats));
        data.set(this.data);
        this.data = data;
      }
    }

    moveTo(x, y) {
      this._room(2);
      this.ops[this.n++] = OP_MOVE;
      this.data[this.m++] = x;
      this.data[this.m++] = y;
    }

    lineTo(x, y) {
      this._room(2);
      this.ops[this.n++] = OP_LINE;
      this.data[this.m++] = x;
      this.data[this.m++] = y;
    }

    // Signature kept compatible with the Path2D call this replaces; the
    // start/end angles are ignored, since every arc drawn here is a circle.
    arc(x, y, r) {
      this._room(3);
      this.ops[this.n++] = OP_ARC;
      this.data[this.m++] = x;
      this.data[this.m++] = y;
      this.data[this.m++] = r;
    }

    // Lays the recorded commands into `ctx`'s current path, ready for the
    // caller's own fill() or stroke(). Leaves the buffer as it was, so a
    // path can be replayed more than once.
    replay(ctx) {
      const ops = this.ops;
      const d = this.data;
      const n = this.n;
      let k = 0;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const op = ops[i];
        if (op === OP_ARC) {
          ctx.arc(d[k], d[k + 1], d[k + 2], 0, TAU);
          k += 3;
        } else if (op === OP_LINE) {
          ctx.lineTo(d[k], d[k + 1]);
          k += 2;
        } else {
          ctx.moveTo(d[k], d[k + 1]);
          k += 2;
        }
      }
    }
  }

  // Reduces a column index into [0, cols) the long way round, since a walk
  // that crosses the date line runs its indices straight past either end.
  function wrapCol(i, cols) {
    const m = i % cols;
    return m < 0 ? m + cols : m;
  }

  // A stable 32-bit hash of one grid cell, for the sub-pixel dot offsets in
  // _renderDots. Integer-only, and a function of nothing but the cell's own
  // coordinates, so a dot keeps the same offset for its whole time on screen
  // however the world moves under it.
  function hashCell(i, j) {
    let x = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
    return (x ^ (x >>> 13)) >>> 0;
  }

  class OuterWorlds {
    constructor(el, options = {}) {
      if (!el) throw new Error('OuterWorlds: element is required');
      if (!global.WorldMap) throw new Error('OuterWorlds: shared/world-map.js must load first');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'outer-worlds__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      this.map = new global.WorldMap(this._mapOptions());
      // Adopt whatever seed the map settled on, so a later update() that
      // rebuilds the map lands on the same world instead of a new one.
      this.options.seed = this.map.options.seed;
      this._signature = this.map.signature();

      // Where on the planet we're looking, and how fast that's moving.
      this._lon = Math.random() * TAU;
      this._lat = (Math.random() * 2 - 1) * 0.35;
      this._velLon = this.options.autoSpin * DEG;
      this._velLat = 0;
      // Pointer movement accumulated since the last frame. Collecting it
      // per-frame rather than acting on each event keeps the response
      // identical whether the browser delivers 1 move per frame or 8.
      this._pendLon = 0;
      this._pendLat = 0;
      this._hasPointer = false;
      this._lastPx = 0;
      this._lastPy = 0;

      this._raf = null;
      this._lastNow = performance.now();

      // Every style draws into exactly two of these — land and sea, or fill
      // and coastline — so one pair per instance covers all three, and they
      // outlive the frame rather than being built inside it. See PathBuffer.
      this._pathA = new PathBuffer();
      this._pathB = new PathBuffer();

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      // Stop drawing once the element has scrolled away.
      //
      // requestAnimationFrame only stops itself for a hidden *tab*, not for
      // an element that has left the viewport, so without this a background
      // sitting at the top of a long page goes on drawing every frame in
      // full while the reader is well below it. Nothing about that is
      // visible, which is exactly the problem: on a phone it is a canvas
      // repainting sixty times a second for pixels nobody is looking at, and
      // the battery cost is the same as if they were.
      //
      // The margin starts it a screenful early, so it comes into view already
      // turning rather than starting from a standstill under the reader's
      // eye.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (on) this._start();
        else this._stop();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.el);

      this.el.addEventListener('pointermove', this._onPointerMove);
      this.el.addEventListener('pointerleave', this._onPointerLeave);
      this.el.addEventListener('pointercancel', this._onPointerLeave);

      this._resize();
      this._render();
      this._start();
    }

    // Runs the loop, unless there is a reason not to: reduced motion never
    // starts one at all, and an element that is off screen has nothing worth
    // drawing. Safe to call when already running.
    _start() {
      if (this._raf || this._reduced || !this._onScreen) return;
      // Restart the clock rather than carrying the gap across. `dt` is capped
      // per frame anyway, so a long pause could not turn into a long jump,
      // but resuming against the last frame before the pause still spends a
      // whole frame's worth of glide at once — which, arriving on the frame
      // the element scrolls back into view, is precisely where it would be
      // seen.
      this._lastNow = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    _mapOptions() {
      const out = {};
      MAP_KEYS.forEach((k) => { out[k] = this.options[k]; });
      return out;
    }

    // clientWidth/clientHeight (not getBoundingClientRect) because the host
    // element may sit under a CSS transform (e.g. the homepage carousel's
    // coverflow scale) — the canvas is a child of that same element, so it
    // inherits that transform too. Sizing it off the already-scaled
    // bounding rect would apply the scale twice.
    _resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._dpr = dpr;
      this._w = Math.max(1, this.el.clientWidth);
      this._h = Math.max(1, this.el.clientHeight);
      this.canvas.width = Math.round(this._w * dpr);
      this.canvas.height = Math.round(this._h * dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._rebuild();
    }

    // Sizes the globe and the lattice sampling it. Row count is chosen so
    // one row of dots lands every `dotSpacing` px on screen, which is why
    // this reruns whenever the element size, the zoom, or the spacing
    // changes. Pass `worldChanged` when the map underneath is a different
    // planet, so the elevations cached against the old one are discarded.
    _rebuild(worldChanged) {
      // Half the diagonal is the distance from the centre to the furthest
      // corner, so scaling off it is what makes `scale >= 1` mean "the
      // element is entirely on the planet" for a wide hero and a square
      // card alike.
      const reach = Math.hypot(this._w, this._h) / 2;
      this._R = Math.max(40, reach * Math.max(0.05, this.options.scale));
      // Finer than the element can afford is not finer than it looks: past
      // the budget the points are crowding into the same pixels anyway, so
      // the floor costs nothing visible and keeps the frame bounded however
      // far out the view is zoomed. `_dotStep` below reports what was
      // actually used, so dot sizes and the plane cache follow the floor
      // rather than the number that was asked for.
      const afford = Math.sqrt((this._w * this._h) / MAX_SAMPLES);
      const spacing = Math.max(1, afford, this.options.dotSpacing);
      const { SphereLattice, LonLatGrid, PlaneGrid, MAX_ROWS } = global.WorldMap;
      const rows = Math.max(8, Math.min(MAX_ROWS, Math.round(Math.PI * this._R / spacing)));
      // A few px of resize usually rounds to the same row count, and the
      // lattice's geometry — along with every elevation already sampled
      // into it — is still valid when it does. Reusing it matters during a
      // window drag, where otherwise each frame would throw away and
      // reallocate a cache of several hundred thousand entries.
      if (worldChanged || !this.lattice || this.lattice.rows !== rows) {
        this.lattice = new SphereLattice(rows, this.map.options.seed);
        this.gridLonLat = null;
      }
      // Actual spacing once the row count has been rounded and capped, so
      // dot sizes stay matched to the lattice rather than to the spacing
      // that was asked for.
      this._dotStep = Math.PI * this._R / this.lattice.rows;

      // The plain lon/lat grid rides on the same lattice and holds no
      // elevations of its own, so it costs a few hundred floats and can be
      // built unconditionally rather than only for the styles that use it.
      // Twice as many columns as rows keeps its cells square at the equator.
      if (!this.gridLonLat || this.gridLonLat.rows !== this.lattice.rows) {
        this.gridLonLat = new LonLatGrid(this.lattice.rows, this.lattice.rows * 2, this.lattice);
      }

      // The plane's rolling cache only has to be big enough to hold what is
      // on screen at once - everything outside that has already scrolled
      // away and can be overwritten - so it is sized off the element, not
      // off the world, and stays the same size however far the map travels.
      // "On screen at once" is the walked range rather than the element:
      // the renderers work a spacing and a half past each edge, and
      // wireframe another whole relief's worth on top of that (see _view).
      // Undersizing it doesn't corrupt anything — each slot remembers which
      // cell it holds — but the columns past the end would evict each other
      // and be re-sampled from the noise on every frame.
      const planeStep = this._dotStep / this._R;
      const margin = 6 + 2 * Math.ceil(this._R * Math.max(0, this.options.relief) / this._dotStep);
      const wantCols = Math.ceil(this._w / this._dotStep) + margin;
      const wantRows = Math.ceil(this._h / this._dotStep) + margin;
      if (worldChanged || !this.gridPlane || this.gridPlane.cols < wantCols
        || this.gridPlane.rows < wantRows || this.gridPlane.step !== planeStep) {
        this.gridPlane = new PlaneGrid(planeStep, wantCols, wantRows, PLANE_TERRAIN_SCALE);
      }

      // Scratch for the map marcher: two rows of projected samples, plus one
      // cell's eight possible vertices.
      //
      // Sized for whichever grid the marcher lands on, since the two bound a
      // row's length by unrelated numbers: the globe's lon/lat rows by their
      // own column count, the plane's by how many cells span the element's
      // width. Either can be the larger — the plane's is, on anything wide
      // or zoomed well out. Undersizing this doesn't throw: a short
      // Float64Array drops the writes past its end instead of growing, so
      // the marcher reads NaN corners, the canvas silently discards those
      // path segments, and the map just stops being drawn partway across.
      const wide = Math.max(this.gridLonLat.maxCols, wantCols) + 4;
      if (!this._rowA || this._rowA.data.length < wide * 4) {
        this._rowA = { data: new Float64Array(wide * 4), count: 0 };
        this._rowB = { data: new Float64Array(wide * 4), count: 0 };
        this._vx = new Float64Array(8);
        this._vy = new Float64Array(8);
      }
    }

    // rect comes from getBoundingClientRect, so it's the host element's
    // post-transform (e.g. carousel coverflow scale) on-screen box, while
    // _w/_h are its untransformed layout size the globe is projected in
    // (see the note on _resize). Scale the pointer offset by the ratio
    // between the two so a given hand movement rotates the world by the
    // same amount regardless of how the element is scaled.
    _onPointerMove(e) {
      if (!this.options.interactive) {
        // Forget the reference point as well, so switching interaction back
        // on differences against the cursor's next position rather than
        // against wherever it happened to be when the world stopped
        // listening — which would jerk it sideways on the first move.
        this._hasPointer = false;
        return;
      }
      const rect = this.el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = (e.clientX - rect.left) * (this._w / rect.width);
      const py = (e.clientY - rect.top) * (this._h / rect.height);
      if (!this._hasPointer) {
        // First event since the pointer arrived: there's no previous
        // position to difference against, and treating the cursor's entry
        // point as a delta would snap the world sideways.
        this._hasPointer = true;
        this._lastPx = px;
        this._lastPy = py;
        return;
      }
      const dx = px - this._lastPx;
      const dy = py - this._lastPy;
      this._lastPx = px;
      this._lastPy = py;

      // Near the view centre the projection is locally 1:1 at R px per
      // radian, so dividing by R turns a pointer distance into the rotation
      // that carries the ground under it by exactly that distance.
      const k = this.options.sensitivity / this._R;
      // Dragging right walks the ground right, which means looking at a
      // longitude further west; dragging down tips the north pole toward
      // the viewer.
      this._pendLon -= dx * k;
      this._pendLat += dy * k;

      if (this._reduced) {
        this._lon += this._pendLon;
        this._lat += this._pendLat;
        this._pendLon = 0;
        this._pendLat = 0;
        this._clampView();
        this._render();
      }
    }

    _onPointerLeave() {
      // Deliberately does not stop the world: whatever momentum it was
      // handed keeps carrying it, which is the whole point of throwing it.
      this._hasPointer = false;
    }

    // Longitude wraps (the globe has no edge); latitude is walled off short
    // of the poles, where the view would otherwise flip over the top. Hitting
    // that wall kills the vertical velocity so a fling into it doesn't sit
    // there pressing against it for the rest of its glide.
    _clampView() {
      // A flat view is an endless plane: no pole to stop at, no date line to
      // come back round to. The viewpoint just keeps going.
      if (this.options.projection === 'flat') return;
      this._lon = ((this._lon % TAU) + TAU) % TAU;
      const maxLat = clamp(this.options.maxLat, 0, 89) * DEG;
      if (this._lat > maxLat) {
        this._lat = maxLat;
        this._velLat = 0;
      } else if (this._lat < -maxLat) {
        this._lat = -maxLat;
        this._velLat = 0;
      }
    }

    // Two regimes, switching on whether the pointer moved this frame.
    //
    // While it's moving, the pointer drives position directly, so the ground
    // tracks the cursor exactly and the world feels grabbed rather than
    // nudged; velocity is only recorded, not applied. When the movement
    // stops that recorded velocity takes over and decays toward the idle
    // drift, which is a handoff with no discontinuity - position was already
    // moving at that rate on the previous frame.
    //
    // Both regimes are expressed as exponential decay over `dt`, so the
    // motion is identical at 30, 60 or 144fps, and a dropped frame doesn't
    // produce a jump.
    _step(dt) {
      const auto = this.options.autoSpin * DEG;
      if (this._pendLon !== 0 || this._pendLat !== 0) {
        this._lon += this._pendLon + auto * dt;
        this._lat += this._pendLat;

        const rateLon = clamp(this._pendLon / dt + auto, -MAX_RATE, MAX_RATE);
        const rateLat = clamp(this._pendLat / dt, -MAX_RATE, MAX_RATE);
        const k = 1 - Math.exp(-dt / GRAB_TAU);
        this._velLon += (rateLon - this._velLon) * k;
        this._velLat += (rateLat - this._velLat) * k;

        this._pendLon = 0;
        this._pendLat = 0;
      } else {
        const tau = Math.max(0.016, this.options.momentum);
        const decay = Math.exp(-dt / tau);
        // Closed-form integral of the decaying velocity over this frame,
        // rather than velocity x dt. Stepping the velocity and then
        // multiplying leaves an O(dt) error, which means a glide covers
        // measurably different ground at 30fps than at 144 — this covers
        // exactly the same distance at any framerate, and through any
        // pattern of dropped frames.
        this._lon += auto * dt + (this._velLon - auto) * tau * (1 - decay);
        this._lat += this._velLat * tau * (1 - decay);
        // Longitude settles onto the idle spin rather than onto zero, so a
        // world that has finished coasting is still turning.
        this._velLon = auto + (this._velLon - auto) * decay;
        this._velLat *= decay;
      }
      this._clampView();
    }

    // Screen px (x right, y up, from the canvas centre) back to a latitude
    // and a longitude offset from the view centre. Standard inverse
    // orthographic; points past the limb are pulled onto it, which keeps the
    // visible window a conservative over-estimate instead of returning NaN.
    _invert(x, y, sinP0, cosP0) {
      const R = this._R;
      const rho = Math.hypot(x, y);
      if (rho < 1e-9) return [this._lat, 0];
      const rr = rho > R ? R : rho;
      const k = rr / rho;
      const xx = x * k;
      const yy = y * k;
      const c = Math.asin(rr / R);
      const sinC = Math.sin(c);
      const cosC = Math.cos(c);
      const sinLat = clamp(cosC * sinP0 + (yy * sinC * cosP0) / rr, -1, 1);
      return [
        Math.asin(sinLat),
        Math.atan2(xx * sinC, rr * cosC * cosP0 - yy * sinC * sinP0),
      ];
    }

    // The patch of world the viewport can currently see, as a latitude range
    // plus a longitude range relative to the view centre.
    //
    // Found by inverse-projecting a ring of points around the viewport's own
    // border. That's sufficient rather than approximate: latitude and
    // longitude are both smooth over the viewport and their gradients vanish
    // only at the poles, so any extreme is either on the border or at a pole
    // that's inside it - and the poles are checked separately below. The view
    // centre is on the globe by construction, so the window is never empty.
    //
    // Worth the trouble because the alternative is testing all ~500k lattice
    // points every frame to find the few thousand actually on screen.
    _visibleWindow(xmax, ymax, sinP0, cosP0) {
      let latMin = Infinity;
      let latMax = -Infinity;
      let dLonMin = Infinity;
      let dLonMax = -Infinity;

      const consider = (x, y) => {
        const p = this._invert(x, y, sinP0, cosP0);
        if (p[0] < latMin) latMin = p[0];
        if (p[0] > latMax) latMax = p[0];
        if (p[1] < dLonMin) dLonMin = p[1];
        if (p[1] > dLonMax) dLonMax = p[1];
      };

      for (let i = 0; i <= EDGE_SAMPLES; i++) {
        const t = i / EDGE_SAMPLES;
        const x = -xmax + 2 * xmax * t;
        const y = -ymax + 2 * ymax * t;
        consider(x, -ymax);
        consider(x, ymax);
        consider(-xmax, y);
        consider(xmax, y);
      }
      consider(0, 0);

      // A pole projects to x=0, y=±R·cos(lat0), and is on the near side of
      // the globe when the view is in its own hemisphere. If one is inside
      // the viewport then every longitude is on screen at once around it and
      // a min/max longitude range means nothing - so fall back to sweeping
      // whole rows.
      let fullLon = false;
      if (this._R * cosP0 <= ymax) {
        if (sinP0 > 0) {
          fullLon = true;
          latMax = HALF_PI;
        } else if (sinP0 < 0) {
          fullLon = true;
          latMin = -HALF_PI;
        }
      }

      return { latMin, latMax, dLonMin, dLonMax, fullLon };
    }

    // Which sampling grid the current style and projection want.
    //
    // On the globe, the equal-area lattice is the default: it gives even
    // coverage everywhere without crowding at the poles. Contour tracing is
    // the exception — it needs cells that are quads sharing whole edges,
    // which the lattice's unequal rings are not — so map style takes the
    // plain lon/lat grid, which reads its heights out of the lattice
    // anyway, leaving one cached copy of the world either way.
    //
    // A flat view is a different world rather than the globe unrolled: see
    // PlaneGrid on why a sphere cannot be made endless by flattening it.
    _grid() {
      if (this.options.projection === 'flat') return this.gridPlane;
      return this.options.mode === 'map' ? this.gridLonLat : this.lattice;
    }

    // Everything the renderers need about the current frame's projection,
    // gathered once so the drawing code reads as drawing and not as
    // trigonometry bookkeeping.
    _view() {
      const step = this._dotStep;
      const cx = this._w / 2;
      const cy = this._h / 2;
      const flat = this.options.projection === 'flat';
      const sinP0 = Math.sin(this._lat);
      const cosP0 = Math.cos(this._lat);
      // A spacing and a half of slack on each side, so a point straddling
      // the edge is still drawn instead of popping in once its centre
      // crosses. Wireframe relief displaces land, so the margin has to
      // cover that too or a peak just off the edge would be clipped away
      // before it was displaced into view.
      const slack = step * 1.5 + (this.options.mode === 'wire'
        ? this._R * Math.max(0, this.options.relief) : 0);
      const xmax = cx + slack;
      const ymax = cy + slack;
      const grid = this._grid();
      const win = flat
        ? this._flatWindow(xmax, ymax)
        : this._visibleWindow(xmax, ymax, sinP0, cosP0);
      return {
        R: this._R,
        step,
        cx,
        cy,
        flat,
        grid,
        sinP0,
        cosP0,
        lat0: this._lat,
        lon0: this._lon,
        xmax,
        ymax,
        win,
        // ±1 row of slack absorbs rowAt's rounding. A plane has no first or
        // last row to clamp against.
        j0: grid.unbounded ? grid.rowAt(win.latMin) - 1 : Math.max(0, grid.rowAt(win.latMin) - 1),
        j1: grid.unbounded ? grid.rowAt(win.latMax) + 1 : Math.min(grid.rows - 1, grid.rowAt(win.latMax) + 1),
      };
    }

    // The flat projection's visible window, which needs none of the
    // spherical machinery below: a plane maps its two coordinates straight
    // onto x and y, so the viewport's own edges already are the bounds, and
    // nothing is clamped because nothing runs out.
    _flatWindow(xmax, ymax) {
      const dLon = xmax / this._R;
      return {
        latMin: this._lat - ymax / this._R,
        latMax: this._lat + ymax / this._R,
        dLonMin: -dLon,
        dLonMax: dLon,
        fullLon: false,
      };
    }

    // The columns of row `j` that the viewport can see. When the window
    // covers the whole ring the range is extended by one past the last
    // column, which wraps back onto the first: without that extra point a
    // caller stroking a parallel leaves the ring open, and every row shows
    // a one-cell gap — visible as a broken seam when the pole is in frame.
    _colRange(v, grid, j) {
      const cols = grid.colsOf(j);
      const colStep = grid.stepOf(j);
      const i0 = Math.floor((v.lon0 + v.win.dLonMin - grid.phaseOf(j)) / colStep);
      const i1 = Math.ceil((v.lon0 + v.win.dLonMax - grid.phaseOf(j)) / colStep);
      // A plane has no ring to close and no column to come back round to:
      // the indices run on in both directions, capped only so an extreme
      // zoom-out cannot ask for an unbounded walk.
      if (!grid.wraps) return [i0, Math.min(i1, i0 + MAX_ROW_STEPS)];
      if (v.win.fullLon || i1 - i0 >= cols - 1) return [0, cols];
      return [i0, i1];
    }

    // Walks the points of row `j` in longitude order, calling
    // `visit(i, x, y, height, cosc, idx, onScreen)` for each.
    //
    // x/y are px from the canvas centre with y pointing up, for a point
    // sitting on the sphere's own surface — a renderer that displaces
    // terrain outward scales them itself. `i` is the running column index,
    // so a caller stroking polylines can tell a continuous run from one
    // interrupted by the limb or the viewport edge; `idx` is the same
    // column reduced into the grid, which is the one that names the point
    // rather than the visit.
    //
    // `reportAll` decides what becomes of the columns that are off screen
    // or around the back of the globe. The styles that stroke what they
    // walk leave it off and never hear about them. The map marcher turns it
    // on and gets every column, flagged rather than skipped: a cell needs
    // all four of its corners to decide what to draw, so it cannot have
    // them silently dropped, and for the same reason it works a whole
    // spacing further out than the viewport — a cell straddling the edge
    // has corners beyond it. Heights are still only sampled for the columns
    // a caller can use, since one sample costs four cached lattice reads
    // and at the wider zooms most of a row is off screen.
    _walkRow(v, j, visit, reportAll) {
      const grid = v.grid;
      const cols = grid.colsOf(j);
      const colStep = grid.stepOf(j);
      const range = this._colRange(v, grid, j);
      const i0 = range[0];
      const i1 = range[1];
      const wraps = grid.wraps;
      const R = v.R;
      const xmax = reportAll ? v.xmax + v.step : v.xmax;
      const ymax = reportAll ? v.ymax + v.step : v.ymax;

      if (v.flat) {
        // Equirectangular: latitude and longitude scale straight onto y and
        // x, so a whole row shares one y and there is no trigonometry at
        // all. Bail on the row as a unit when that y is off screen — unless
        // the marcher is asking, since it needs the row's length to match
        // its neighbour's whether or not either is visible.
        const y = R * (grid.latOf(j) - v.lat0);
        const onY = y >= -ymax && y <= ymax;
        if (!onY && !reportAll) return;
        let dl = grid.phaseOf(j) + i0 * colStep - v.lon0;
        for (let i = i0; i <= i1; i++, dl += colStep) {
          const x = R * dl;
          const ok = onY && x >= -xmax && x <= xmax;
          if (!ok && !reportAll) continue;
          // Only a grid that closes on itself may have its column index
          // reduced: on a plane `i` *is* the world coordinate, and folding
          // it back into [0, cols) would make the terrain repeat every
          // screenful, with a hard vertical seam at every fold.
          const idx = wraps ? wrapCol(i, cols) : i;
          visit(i, x, y, ok ? grid.heightAt(this.map, j, idx) : 0, 1, idx, ok);
        }
        return;
      }

      const sinP = grid.sinLat[j];
      const cosP = grid.cosLat[j];
      // Walk the row's longitude offsets by repeatedly rotating a unit
      // vector through one column step, instead of calling sin/cos per
      // point: two trig calls per row rather than two per point, which at
      // this point count is the difference between a comfortable frame and
      // a strained one. Restarted from scratch every row, so the rotation's
      // error has no chance to accumulate.
      const dl = grid.phaseOf(j) + i0 * colStep - v.lon0;
      let s = Math.sin(dl);
      let c = Math.cos(dl);
      const ks = grid.stepSin[j];
      const kc = grid.stepCos[j];

      for (let i = i0; i <= i1; i++) {
        // cos of the angular distance from the view centre: positive means
        // this point is on the near side of the globe.
        const cosc = v.sinP0 * sinP + v.cosP0 * cosP * c;
        const x = R * cosP * s;
        const y = R * (v.cosP0 * sinP - v.sinP0 * cosP * c);
        const ok = cosc > 0 && x >= -xmax && x <= xmax && y >= -ymax && y <= ymax;
        if (ok || reportAll) {
          const idx = wraps ? wrapCol(i, cols) : i;
          visit(i, x, y, ok ? grid.heightAt(this.map, j, idx) : 0, cosc, idx, ok);
        }
        const ns = s * kc + c * ks;
        c = c * kc - s * ks;
        s = ns;
      }
    }

    // Ink for the parts the world is drawn in. Ocean and border both fall
    // back to the land color, so a single `landColor` is enough unless they
    // are meant to differ. Cached and only rebuilt when a color option
    // actually changes, since this is called from the per-frame render path.
    _ink() {
      const { landColor, oceanColor, borderColor } = this.options;
      if (!this._inkCache
        || this._inkLand !== landColor
        || this._inkOcean !== oceanColor
        || this._inkBorder !== borderColor) {
        this._inkLand = landColor;
        this._inkOcean = oceanColor;
        this._inkBorder = borderColor;
        this._inkCache = {
          land: `rgb(${landColor})`,
          ocean: `rgb(${oceanColor || landColor})`,
          border: `rgb(${borderColor || landColor})`,
        };
      }
      return this._inkCache;
    }

    _render() {
      const { ctx, _w: w, _h: h } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, w, h);

      const v = this._view();
      if (this.options.mode === 'wire') this._renderWire(v);
      else if (this.options.mode === 'map') this._renderMap(v);
      else this._renderDots(v);
    }

    // Halftone: one dot per lattice point, sized by how far above the
    // waterline it stands.
    //
    // The dots are round, and that is a rendering decision rather than a
    // stylistic one. A square is the worst shape there is to move slowly
    // across a pixel grid: its edges are axis-aligned, so when it lands on
    // pixel boundaries it rasterizes perfectly crisp and when it straddles
    // them it grows a soft grey rim on every side. Measured over a sweep of
    // sub-pixel positions, a square's count of partially-covered pixels
    // swings by more than 100% while its ink stays constant — it is not
    // getting lighter or darker, it is going in and out of focus, and a
    // field of several thousand of them doing that reads as a flicker. A
    // circle has no orientation for the grid to catch: the same sweep moves
    // it under 16%.
    _renderDots(v) {
      const { ctx } = this;
      const step = v.step;
      const seaLevel = this.options.seaLevel;
      const landRange = Math.max(0.001, this.options.landRange);
      const oceanAlpha = this.options.oceanAlpha;
      // Ocean dots are a fixed speck regardless of depth - they're a
      // reference lattice, not bathymetry.
      const seaR = Math.max(0.45, step * 0.096);

      // One path per ink band, filled once each at the end: a few thousand
      // dots in two fills instead of a few thousand draw calls.
      const land = this._pathA.reset();
      const sea = this._pathB.reset();

      // On top of the round dots, each one is nudged by up to half a device
      // pixel, by a fixed amount of its own.
      //
      // Rounding them settles each dot on its own; this settles the field.
      // A flat view lays its dots on an exact square lattice, so every one
      // of them meets the pixel grid at the same sub-pixel phase and crosses
      // it at the same moment — whatever is left of the per-dot wobble
      // therefore happens everywhere at once, which is far more visible than
      // the same amount of it scattered. (A globe escapes this for free:
      // its rows carry a random longitude offset each and project to curves,
      // so the phases are already spread.) Measured as the concentration of
      // the dots' sub-pixel phases, a flat view sits at 0.17 of fully
      // aligned without this and 0.01 with it — the same as the globe's.
      //
      // Keyed on the dot's own grid cell rather than on anything about the
      // frame: the offset has to be part of the dot, or it becomes a second
      // source of the shimmer it is here to remove. Which is also why it is
      // the reduced column index — the same point reached from either side
      // of the date line has to land on the same offset.
      const jitter = 1 / (this._dpr || 1);

      let row = 0;
      const visit = (i, x, y, hgt, cosc, idx) => {
        const n = hashCell(idx, row);
        const sx = v.cx + x + ((n & 255) / 256 - 0.5) * jitter;
        const sy = v.cy - y + (((n >>> 8) & 255) / 256 - 0.5) * jitter;
        if (hgt > seaLevel) {
          // Square root rather than a linear ramp so the size climbs fast
          // just past the waterline: coasts read as a dither over a few
          // dots instead of a long grey gradient. Radii are the old square
          // half-sides scaled by 2/sqrt(pi), which is what keeps a dot's ink
          // — and so the tone of the whole ramp — where it was when the dots
          // were square. At the top of the ramp that puts a dot's diameter
          // past the diagonal of its cell, so highland interiors still close
          // up into solid ink instead of showing gaps between rows.
          const t = Math.min(1, (hgt - seaLevel) / landRange);
          const r = step * (0.113 + 0.62 * Math.sqrt(t));
          land.moveTo(sx + r, sy);
          land.arc(sx, sy, r, 0, TAU);
        } else if (oceanAlpha > 0) {
          sea.moveTo(sx + seaR, sy);
          sea.arc(sx, sy, seaR, 0, TAU);
        }
      };

      for (let j = v.j0; j <= v.j1; j++) {
        row = j;
        this._walkRow(v, j, visit);
      }

      const ink = this._ink();
      ctx.fillStyle = ink.land;
      land.replay(ctx);
      ctx.fill();
      if (oceanAlpha > 0) {
        ctx.globalAlpha = oceanAlpha;
        ctx.fillStyle = ink.ocean;
        sea.replay(ctx);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Wireframe: a mesh of parallels and meridians laid over the globe,
    // pushed out from the surface wherever it crosses land, so continents
    // rise out of the grid as relief instead of being shaded onto it.
    //
    // Both families are anchored to the world rather than the screen —
    // parallels are lattice rows, meridians are fixed longitudes — so the
    // mesh turns with the planet instead of sitting still in front of it.
    _renderWire(v) {
      const { ctx } = this;
      const seaLevel = this.options.seaLevel;
      const landRange = Math.max(0.001, this.options.landRange);
      const relief = Math.max(0, this.options.relief);
      const oceanAlpha = this.options.oceanAlpha;
      const land = this._pathA.reset();
      const sea = this._pathB.reset();

      // How high above the waterline a point stands, 0 to 1. Square-rooted
      // like the dot sizing, so the ground lifts sharply at the coast and
      // the shoreline stays a legible edge rather than a long ramp.
      const rise = (hgt) => (hgt > seaLevel
        ? Math.sqrt(Math.min(1, (hgt - seaLevel) / landRange)) : 0);

      // On the globe, land is pushed straight out from the sphere's
      // surface. The `cosc` factor — how squarely the point faces the
      // viewer — matters once the globe's edge is in frame: pushing a point
      // outward moves it across the screen by an amount that grows with its
      // distance from the view centre, so at the limb, where that distance
      // is the full radius, highlands would fling out past the horizon as
      // loose spikes. Fading the lift as the surface turns away keeps
      // relief strongest where it's being looked at and settles the
      // silhouette down to a clean edge.
      //
      // A flat sheet has no outward direction, so there the same rise
      // becomes a straight lift up the page, the way a relief profile is
      // conventionally drawn. FLAT_RELIEF_SCALE keeps the two comparable at
      // equal `relief` values.
      const flat = v.flat;
      const lift = (hgt, cosc) => 1 + relief * cosc * rise(hgt);
      const flatLift = (hgt) => relief * v.R * FLAT_RELIEF_SCALE * rise(hgt);

      let prevI = null;
      let prevX = 0;
      let prevY = 0;
      let prevH = 0;
      const visit = (i, x, y, hgt, cosc) => {
        let sx;
        let sy;
        if (flat) {
          sx = v.cx + x;
          sy = v.cy - y - flatLift(hgt);
        } else {
          const r = lift(hgt, cosc);
          sx = v.cx + x * r;
          sy = v.cy - y * r;
        }
        if (prevI === i - 1) {
          this._meshSegment(land, sea, seaLevel, prevX, prevY, prevH, sx, sy, hgt);
        }
        prevI = i;
        prevX = sx;
        prevY = sy;
        prevH = hgt;
      };

      // Parallels: every Nth lattice row, picked by row index so the same
      // latitudes stay drawn as the view pans instead of the mesh crawling.
      const stride = Math.max(1, Math.round(this.options.meshSpacing / v.step));
      for (let j = v.j0; j <= v.j1; j++) {
        if (j % stride !== 0) continue;
        prevI = null;
        this._walkRow(v, j, visit);
      }

      this._wireMeridians(v, flat ? flatLift : lift, land, sea, stride);

      const ink = this._ink();
      const width = Math.max(0.2, this.options.lineWidth);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      if (oceanAlpha > 0) {
        ctx.globalAlpha = oceanAlpha;
        ctx.strokeStyle = ink.ocean;
        ctx.lineWidth = width;
        sea.replay(ctx);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = ink.land;
      ctx.lineWidth = width * LAND_LINE_SCALE;
      land.replay(ctx);
      ctx.stroke();
    }

    // Classic map: landmasses as filled shapes with a drawn coastline,
    // over a flat sea wash.
    //
    // The coastline is a real contour rather than a stepped approximation:
    // the grid is marched cell by cell, and each cell contributes the piece
    // of itself that lies above the waterline plus the line where the
    // waterline crosses it. Adjacent cells interpolate a shared edge from
    // the same pair of corner heights, so the pieces meet exactly and the
    // fill comes out seamless without ever assembling whole islands into
    // closed polygons.
    _renderMap(v) {
      const { ctx } = this;
      const grid = v.grid;
      const seaLevel = this.options.seaLevel;
      const oceanAlpha = this.options.oceanAlpha;
      const ink = this._ink();

      // Sea first, so land reads as shapes cut out of an ocean rather than
      // floating on the page. On the globe it is the planet's own disc —
      // orthographic projects a sphere to exactly a circle of radius R —
      // which draws the horizon for free and leaves `background` as the
      // space around the planet. Flat, it covers everything, so at full
      // opacity `background` has nothing left to show through it.
      if (oceanAlpha > 0) {
        ctx.globalAlpha = oceanAlpha;
        ctx.fillStyle = ink.ocean;
        ctx.beginPath();
        if (v.flat) ctx.rect(0, 0, this._w, this._h);
        else ctx.arc(v.cx, v.cy, v.R, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      const fill = this._pathA.reset();
      const coast = this._pathB.reset();
      // Each grid row is projected once and then used twice: as the top of
      // one band of cells and the bottom of the next.
      let lower = this._mapRow(v, v.j0, this._rowA);
      for (let j = v.j0; j < v.j1; j++) {
        const upper = this._mapRow(v, j + 1, lower === this._rowA ? this._rowB : this._rowA);
        this._marchBand(v, lower, upper, seaLevel, fill, coast);
        lower = upper;
      }

      const fillAlpha = clamp(this.options.fillAlpha, 0, 1);
      if (fillAlpha > 0) {
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = ink.land;
        fill.replay(ctx);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink.border;
      ctx.lineWidth = Math.max(0.2, this.options.lineWidth) * COAST_LINE_SCALE;
      coast.replay(ctx);
      ctx.stroke();
    }

    // Projects one grid row into a reusable buffer laid out as
    // [x, y, height, onScreen] per column. Buffers alternate between the
    // frame's two live rows rather than being allocated per row, which at
    // ~50 rows a frame is the difference between steady state and a steady
    // stream of garbage.
    _mapRow(v, j, buf) {
      const data = buf.data;
      let n = 0;
      this._walkRow(v, j, (i, x, y, hgt, cosc, idx, ok) => {
        const k = n++ * 4;
        data[k] = x;
        data[k + 1] = y;
        data[k + 2] = hgt;
        data[k + 3] = ok;
      }, true);
      buf.count = n;
      return buf;
    }

    // Marches the band of cells between two projected rows, appending land
    // to `fill` and coastline to `coast`.
    //
    // Cells wholly inland are not emitted one at a time. A run of them is
    // held open and flushed as a single polygon tracing out along the lower
    // row and back along the upper one, which is the same shape the
    // individual quads would have tiled into. This matters a great deal:
    // path building degrades sharply with the number of sub-paths, and an
    // ocean-to-ocean continent is thousands of interior cells against a few
    // hundred coastal ones. Merging them took a hero-sized frame from ~180ms
    // of path building down to single digits.
    //
    // Slot `i` of the two rows is read as the same column of each, which
    // holds because every grid the marcher runs on — LonLatGrid on the
    // globe, PlaneGrid on the plane — reports one phase and one column step
    // for all of its rows, so _colRange starts them both at the same index.
    // A grid whose rows were offset from one another (SphereLattice, whose
    // rings each carry their own phase and column count) would shear the
    // bands apart, which is the reason map style takes the plain lon/lat
    // grid rather than the lattice.
    _marchBand(v, lower, upper, seaLevel, fill, coast) {
      const a = lower.data;
      const b = upper.data;
      const n = Math.min(lower.count, upper.count) - 1;
      const vx = this._vx;
      const vy = this._vy;
      const cx = v.cx;
      const cy = v.cy;
      // First cell of the run currently open, or -1 for none.
      let runStart = -1;

      for (let i = 0; i < n; i++) {
        const p0 = i * 4;
        const p1 = p0 + 4;
        // Corner 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left.
        const drawable = a[p0 + 3] && a[p1 + 3] && b[p1 + 3] && b[p0 + 3];
        const h0 = a[p0 + 2];
        const h1 = a[p1 + 2];
        const h2 = b[p1 + 2];
        const h3 = b[p0 + 2];
        const code = !drawable ? 0 : (h0 > seaLevel ? 1 : 0) | (h1 > seaLevel ? 2 : 0)
          | (h2 > seaLevel ? 4 : 0) | (h3 > seaLevel ? 8 : 0);

        if (code === 15) {
          if (runStart < 0) runStart = i;
          continue;
        }
        if (runStart >= 0) {
          this._fillRun(fill, a, b, cx, cy, runStart, i - 1);
          runStart = -1;
        }
        if (code === 0) continue;

        vx[0] = cx + a[p0]; vy[0] = cy - a[p0 + 1];
        vx[1] = cx + a[p1]; vy[1] = cy - a[p1 + 1];
        vx[2] = cx + b[p1]; vy[2] = cy - b[p1 + 1];
        vx[3] = cx + b[p0]; vy[3] = cy - b[p0 + 1];

        // Waterline crossings on the four edges, each interpolated from the
        // pair of corner heights that straddles it. The neighbouring cell
        // derives the shared edge from the same pair, so both land on the
        // same point and the fills abut exactly.
        this._crossing(4, code, 1, 2, h0, h1, vx, vy, 0, 1, seaLevel);
        this._crossing(5, code, 2, 4, h1, h2, vx, vy, 1, 2, seaLevel);
        this._crossing(6, code, 4, 8, h2, h3, vx, vy, 2, 3, seaLevel);
        this._crossing(7, code, 8, 1, h3, h0, vx, vy, 3, 0, seaLevel);

        const polys = MS_POLYS[code];
        for (let p = 0; p < polys.length; p++) {
          const poly = polys[p];
          fill.moveTo(vx[poly[0]], vy[poly[0]]);
          for (let q = 1; q < poly.length; q++) fill.lineTo(vx[poly[q]], vy[poly[q]]);
        }
        const lines = MS_LINES[code];
        for (let p = 0; p < lines.length; p++) {
          const line = lines[p];
          coast.moveTo(vx[line[0]], vy[line[0]]);
          coast.lineTo(vx[line[1]], vy[line[1]]);
        }
      }
      if (runStart >= 0) this._fillRun(fill, a, b, cx, cy, runStart, n - 1);
    }

    // One polygon covering cells `s` through `e` of a band, all of which are
    // wholly inland: out along the lower row, back along the upper one.
    // Wound the same way as a single cell's quad, and sharing its end edges
    // exactly, so it sits flush against the coastal fragments either side.
    _fillRun(fill, a, b, cx, cy, s, e) {
      fill.moveTo(cx + a[s * 4], cy - a[s * 4 + 1]);
      for (let k = s + 1; k <= e + 1; k++) fill.lineTo(cx + a[k * 4], cy - a[k * 4 + 1]);
      for (let k = e + 1; k >= s; k--) fill.lineTo(cx + b[k * 4], cy - b[k * 4 + 1]);
    }

    // Writes the waterline crossing of one cell edge into slot `slot` of the
    // vertex scratch, when that edge actually has one (its two corners on
    // opposite sides of the threshold).
    _crossing(slot, code, maskA, maskB, ha, hb, vx, vy, ca, cb, seaLevel) {
      if (((code & maskA) !== 0) === ((code & maskB) !== 0)) return;
      const f = clamp((seaLevel - ha) / (hb - ha), 0, 1);
      vx[slot] = vx[ca] + (vx[cb] - vx[ca]) * f;
      vy[slot] = vy[ca] + (vy[cb] - vy[ca]) * f;
    }

    // Emits one segment of the mesh into whichever band it belongs to.
    //
    // A segment that crosses the waterline is split at the crossing, so the
    // coast lands on the real shoreline rather than snapping to whichever
    // sample point happened to be nearest — without this, coastlines step
    // along in mesh-sized jumps. Segments are emitted individually rather
    // than as one long sub-path precisely so this split is possible; butt
    // caps and shared endpoints leave no seam between consecutive ones.
    _meshSegment(land, sea, seaLevel, ax, ay, ah, bx, by, bh) {
      const aLand = ah > seaLevel;
      if (aLand === (bh > seaLevel)) {
        const path = aLand ? land : sea;
        path.moveTo(ax, ay);
        path.lineTo(bx, by);
        return;
      }
      const f = clamp((seaLevel - ah) / (bh - ah), 0, 1);
      const mx = ax + (bx - ax) * f;
      const my = ay + (by - ay) * f;
      const first = aLand ? land : sea;
      const second = aLand ? sea : land;
      first.moveTo(ax, ay);
      first.lineTo(mx, my);
      second.moveTo(mx, my);
      second.lineTo(bx, by);
    }

    // The other half of the mesh. A meridian sits at one fixed longitude,
    // so its angle from the view centre is constant down the whole line and
    // the two trig calls it needs can be hoisted out of the row loop
    // entirely. Elevation is interpolated along each row it crosses, so the
    // line follows the terrain rather than the nearest sample.
    _wireMeridians(v, lift, land, sea, stride) {
      const grid = v.grid;
      const seaLevel = this.options.seaLevel;
      // Spacing is snapped to an exact division of the circle. Rounding it
      // any other way leaves the wrap-around gap between the last meridian
      // and the first a different width from all the others, which reads as
      // one line missing from the mesh whenever the whole circle is in view.
      const count = Math.max(4, Math.round(TAU / Math.max(1e-4, this.options.meshSpacing / v.R)));
      // A plane has no circle to divide, and wants the other snapping
      // instead: `stride` columns, the same count the parallels skip rows
      // by. That puts every meridian exactly on a grid column, so the two
      // families cross at shared sample points and the mesh comes out a
      // square lattice rather than two independent sets of lines sliding
      // over one another at their own spacings.
      const dLon = v.flat ? stride * grid.stepOf(0) : TAU / count;
      let kMin;
      let kMax;
      if (v.win.fullLon && !v.flat) {
        kMin = 0;
        kMax = count - 1;
      } else {
        // Flat included: on a plane k runs straight past the circle's own
        // count, since there is no meridian to come back round to.
        kMin = Math.ceil((v.lon0 + v.win.dLonMin) / dLon);
        kMax = Math.min(Math.floor((v.lon0 + v.win.dLonMax) / dLon), kMin + MAX_ROW_STEPS);
      }

      // Meridians converge as they climb, so at some latitude they are
      // closer together than the mesh is wide and the pole turns into a
      // black starburst. Each one is therefore cut off where its own
      // spacing would drop below MERIDIAN_MIN_SPACING of the mesh — but
      // with the allowance scaled by the lowest set bit of its index, so
      // every second one survives twice as far, every fourth twice as far
      // again, and the mesh thins by halves toward the pole instead of
      // stopping dead in a bald cap. A flat sheet has no convergence to
      // correct, and opts out.
      const spacing = v.R * dLon;
      for (let k = kMin; k <= kMax; k++) {
        const lon = k * dLon;
        // No limit at all on a plane, where `latOf` is an unbounded world
        // coordinate rather than a latitude — capping it at π/2 there cuts
        // every meridian off a couple of screens from the origin.
        let latLimit = Infinity;
        if (!v.flat) {
          const rank = k === 0 ? count : (k & -k);
          latLimit = Math.acos(Math.min(1,
            (MERIDIAN_MIN_SPACING * this.options.meshSpacing) / (spacing * rank)));
        }
        const s = v.flat ? 0 : Math.sin(lon - v.lon0);
        const c = v.flat ? 0 : Math.cos(lon - v.lon0);
        // On a flat sheet a meridian is a straight vertical line, so its x
        // is fixed for the whole run.
        const flatX = v.flat ? v.R * (lon - v.lon0) : 0;
        if (v.flat && (flatX < -v.xmax || flatX > v.xmax)) continue;
        let prevJ = null;
        let prevX = 0;
        let prevY = 0;
        let prevH = 0;
        for (let j = v.j0; j <= v.j1; j++) {
          const rowLat = grid.latOf(j);
          if (rowLat > latLimit || rowLat < -latLimit) {
            prevJ = null;
            continue;
          }
          let x;
          let y;
          let cosc = 1;
          if (v.flat) {
            x = flatX;
            y = v.R * (rowLat - v.lat0);
          } else {
            // Only a sphere grid has these, and only the globe branch wants
            // them - a plane's row index is a plain signed integer with no
            // per-row trig table behind it.
            const sinP = grid.sinLat[j];
            const cosP = grid.cosLat[j];
            cosc = v.sinP0 * sinP + v.cosP0 * cosP * c;
            if (cosc <= 0) continue;
            x = v.R * cosP * s;
            y = v.R * (v.cosP0 * sinP - v.sinP0 * cosP * c);
          }
          if (x < -v.xmax || x > v.xmax || y < -v.ymax || y > v.ymax) continue;

          const hgt = grid.heightAtLon(this.map, j, lon);
          let sx;
          let sy;
          if (v.flat) {
            sx = v.cx + x;
            sy = v.cy - y - lift(hgt);
          } else {
            const r = lift(hgt, cosc);
            sx = v.cx + x * r;
            sy = v.cy - y * r;
          }
          if (prevJ === j - 1) {
            this._meshSegment(land, sea, seaLevel, prevX, prevY, prevH, sx, sy, hgt);
          }
          prevJ = j;
          prevX = sx;
          prevY = sy;
          prevH = hgt;
        }
      }
    }

    _tick(now) {
      const dt = Math.min(0.05, (now - this._lastNow) / 1000);
      this._lastNow = now;
      this._step(dt);
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    // Apply new option values (e.g. from a control panel). Which of the
    // three tiers a change falls into decides how much is thrown away:
    // a different world needs a new map and a new elevation cache; a
    // different zoom or dot spacing keeps the world but rebuilds the
    // lattice; everything else - sea level included - is just a different
    // reading of elevations already sampled, and costs nothing.
    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
      if (newOptions.interactive === false) {
        // Drop anything the pointer had queued but the next frame hasn't
        // spent yet, so turning interaction off takes effect immediately
        // rather than one last nudge later.
        this._pendLon = 0;
        this._pendLat = 0;
        this._hasPointer = false;
      }
      const mapOptions = this._mapOptions();
      const signature = global.WorldMap.signatureOf(mapOptions);
      if (signature !== this._signature) {
        this.map = new global.WorldMap(mapOptions);
        this.options.seed = this.map.options.seed;
        this._signature = signature;
        this._rebuild(true);
      } else {
        this.map.options.seaLevel = this.options.seaLevel;
        this.map.options.landRange = this.options.landRange;
        // `relief` is in the list because it widens the band of world the
        // wireframe walks, and so the plane cache that has to cover it.
        if ('dotSpacing' in newOptions || 'scale' in newOptions || 'relief' in newOptions) {
          this._rebuild();
        }
      }
      if (this._reduced) this._render();
    }

    // Replaces the planet, keeping the current viewpoint and motion.
    // Omit `seed` for a random one; returns the seed actually used, so it
    // can be shown or saved and passed back later to get this world again.
    newWorld(seed) {
      this.options.seed = this.map.reseed(seed);
      this._signature = this.map.signature();
      this._rebuild(true);
      if (this._reduced) this._render();
      return this.options.seed;
    }

    destroy() {
      this._stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      this.el.removeEventListener('pointermove', this._onPointerMove);
      this.el.removeEventListener('pointerleave', this._onPointerLeave);
      this.el.removeEventListener('pointercancel', this._onPointerLeave);
      this.canvas.remove();
    }
  }

  OuterWorlds.initAll = function (selector = '.bg-outer-worlds', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__outerWorldsInstance)
      .map((el) => {
        const instance = new OuterWorlds(el, options);
        el.__outerWorldsInstance = instance;
        return instance;
      });
  };

  // Look up the instance auto-created for a single element (or the first
  // match of a selector) — use this instead of `initAll()` from page code,
  // since auto-init has usually already claimed the element by the time a
  // page's own script runs.
  OuterWorlds.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__outerWorldsInstance || null : null;
  };

  OuterWorlds.getAll = function (selector = '.bg-outer-worlds') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__outerWorldsInstance)
      .filter(Boolean);
  };

  global.OuterWorlds = OuterWorlds;

  function autoInit() {
    OuterWorlds.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
