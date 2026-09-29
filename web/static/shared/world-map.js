/**
 * WorldMap
 * --------
 * Seeded procedural terrain, sampled on the surface of a sphere.
 *
 * The whole point of sampling 3D noise at points *on a sphere* rather than
 * generating a flat 2D bitmap is that there is nothing to stitch: longitude
 * wraps at ±180° for free (both sides are literally the same point in 3D),
 * the poles are ordinary points rather than infinitely-stretched rows, and
 * elevation at any coordinate can be asked for at any time without having
 * generated its neighbours first. A renderer can pan anywhere, at any zoom,
 * forever, and never hit a seam or a "generate the next chunk" step.
 *
 * Everything here is a pure function of the seed: the same seed always
 * produces the same world, on every machine, in any order the points are
 * asked for. That's what makes it safe to cache (see SphereLattice) and
 * reusable across effects.
 *
 * Three pieces, in dependency order:
 *
 *   mulberry32(seed)    - tiny deterministic PRNG.
 *   Noise3(seed)        - seeded Perlin gradient noise in 3D.
 *   WorldMap(options)   - the terrain itself: domain-warped fBm plus a
 *                         ridged-mountain term, with land/sea helpers.
 *   WorldMap.SphereLattice - an equal-area grid of points on the sphere
 *                         with lazily-sampled, cached elevations.
 *   WorldMap.LonLatGrid - plain lon/lat cells over the same sphere, for
 *                         callers that need quads rather than even coverage.
 *   WorldMap.PlaneGrid  - an endless square grid on a plane, for maps that
 *                         are not globes at all.
 *
 * Usage:
 *
 *   const world = new WorldMap({ seed: 1234 });
 *   world.heightAtLonLat(lon, lat);   // signed elevation, sea is < seaLevel
 *   world.landFactor(h);              // 0 at the coast, 1 `landRange` above it
 *
 * Reusable outside the sphere too: `heightAt2D(x, y)` runs the same terrain
 * pipeline on a plane, for effects that want a flat map instead of a globe.
 */
(function (global) {
  const TAU = Math.PI * 2;
  const HALF_PI = Math.PI / 2;

  // --- PRNG ------------------------------------------------------------

  // mulberry32: 32 bits of state, one multiply-xorshift round per call.
  // Chosen over `Math.random` because it's seedable (the whole module is
  // worthless without reproducibility) and over anything larger because
  // terrain doesn't need cryptographic-grade distribution - it needs a
  // well-mixed shuffle of 256 integers and a handful of offsets.
  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- 3D gradient noise ----------------------------------------------

  // The 12 midpoints of a cube's edges - Perlin's 2002 "improved noise"
  // gradient set. Every vector has the same length, so no direction is
  // implicitly weighted heavier than another (the flaw in picking random
  // gradients from a cube's interior).
  const GRAD3 = new Int8Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);

  // Precomputed (h % 12) * 3 for every byte, so picking a gradient is one
  // table lookup instead of a modulo in the innermost loop of the module.
  const MOD12 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) MOD12[i] = (i % 12) * 3;

  // Perlin's quintic ease. Both its first and second derivatives vanish at
  // 0 and 1, which is what keeps cell boundaries from showing up as faint
  // creases once several octaves are stacked.
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // `noise` below is deliberately left unscaled: with this gradient set its
  // peak magnitude measures 0.9965 over 12M samples across 8 seeds, so a
  // single octave already occupies [-1, 1] almost exactly. Worth knowing
  // because it's what makes absolute option values like `seaLevel` mean a
  // fixed thing instead of drifting with the octave count.

  class Noise3 {
    constructor(seed) {
      const rand = mulberry32(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      // Fisher-Yates, so every byte still appears exactly once: the
      // permutation has to stay a bijection or the noise develops
      // repeating hot spots where two inputs collide.
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
      }
      // Doubled to 512 so the `perm[X] + Y` index arithmetic below can run
      // without a wrap check on every lookup.
      this.perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }

    noise(x, y, z) {
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);
      const X = fx & 255;
      const Y = fy & 255;
      const Z = fz & 255;
      const dx = x - fx;
      const dy = y - fy;
      const dz = z - fz;
      const u = fade(dx);
      const v = fade(dy);
      const w = fade(dz);

      const p = this.perm;
      const A = p[X] + Y;
      const AA = p[A] + Z;
      const AB = p[A + 1] + Z;
      const B = p[X + 1] + Y;
      const BA = p[B] + Z;
      const BB = p[B + 1] + Z;

      const x1 = lerp(grad(p[AA], dx, dy, dz), grad(p[BA], dx - 1, dy, dz), u);
      const x2 = lerp(grad(p[AB], dx, dy - 1, dz), grad(p[BB], dx - 1, dy - 1, dz), u);
      const y1 = lerp(x1, x2, v);
      const x3 = lerp(grad(p[AA + 1], dx, dy, dz - 1), grad(p[BA + 1], dx - 1, dy, dz - 1), u);
      const x4 = lerp(grad(p[AB + 1], dx, dy - 1, dz - 1), grad(p[BB + 1], dx - 1, dy - 1, dz - 1), u);
      const y2 = lerp(x3, x4, v);

      return lerp(y1, y2, w);
    }
  }

  function grad(hash, x, y, z) {
    const g = MOD12[hash];
    return GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z;
  }

  // Orthonormal rotation applied between fBm octaves. Plain doubling stacks
  // every octave's cell grid on the same axes, which reads as faint
  // horizontal/vertical streaking in the result; rotating each octave off
  // the previous one's axes scatters that into nothing. Orthonormal to
  // within 6e-17, so it rotates without also scaling any octave.
  const ROT = [
    0.0, 0.8, 0.6,
    -0.8, 0.36, -0.48,
    -0.6, -0.48, 0.64,
  ];

  // --- Terrain ---------------------------------------------------------

  const WORLD_DEFAULTS = {
    // null seeds a random world; pass a number for a reproducible one.
    seed: null,
    // Noise cycles per sphere radius. Low values mean a few big
    // continents, high values mean an archipelago planet.
    frequency: 1.7,
    octaves: 6,
    lacunarity: 2,
    gain: 0.5,
    // Distance (in noise space) that the sample point is pushed around by
    // a second noise field before elevation is read. This is what turns
    // round fBm blobs into coastlines with peninsulas, bays and inlets.
    warp: 0.38,
    warpFrequency: 0.85,
    // Strength of an inverted-absolute ("ridged") noise term added on top
    // of land only, which reads as mountain chains rather than isolated
    // bumps.
    ridge: 0.5,
    ridgeFrequency: 3.3,
    // Shifts the whole field up (more land) or down (more ocean).
    landBias: 0,

    // --- Classification, not generation ---
    // These two only interpret an already-generated elevation, so changing
    // them never invalidates a cached field (see `signature`).
    // Tuned so a random seed lands around 37% land (28-44% across seeds),
    // close enough to a real planet to read as one while still keeping
    // enough coastline on screen to be worth looking at.
    seaLevel: 0.1,
    // Elevation above seaLevel at which `landFactor` reaches 1.
    landRange: 0.3,
  };

  // Option keys that actually change the generated field. Anything outside
  // this list is interpretation, not generation.
  const GENERATOR_KEYS = [
    'seed', 'frequency', 'octaves', 'lacunarity', 'gain',
    'warp', 'warpFrequency', 'ridge', 'ridgeFrequency', 'landBias',
  ];

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Identity of the field a given set of options generates, for cache
  // invalidation. Exposed statically as well (WorldMap.signatureOf) so a
  // caller holding a plain options object can tell whether a change actually
  // needs a new world without building one to find out.
  function signatureOf(options) {
    return GENERATOR_KEYS
      .map((k) => `${k}:${k in options ? options[k] : WORLD_DEFAULTS[k]}`)
      .join('|');
  }

  class WorldMap {
    constructor(options = {}) {
      this.options = { ...WORLD_DEFAULTS, ...options };
      if (this.options.seed === null || this.options.seed === undefined) {
        this.options.seed = Math.floor(Math.random() * 0xffffffff);
      }
      this.options.seed = this.options.seed >>> 0;
      this._build();
    }

    _build() {
      this.noise = new Noise3(this.options.seed);
      // Per-octave offsets, so octaves aren't all centred on the origin
      // (where every one of them is pinned to a lattice point at once).
      const rand = mulberry32(this.options.seed ^ 0x9e3779b9);
      const n = Math.max(1, Math.round(this.options.octaves));
      this._offsets = new Float64Array(n * 3);
      for (let i = 0; i < n * 3; i++) this._offsets[i] = rand() * 256;
    }

    // Swap in a new world without reallocating the instance. Returns the
    // seed actually used, so callers can show or store it.
    reseed(seed) {
      this.options.seed = (seed === undefined || seed === null
        ? Math.floor(Math.random() * 0xffffffff)
        : seed) >>> 0;
      this._build();
      return this.options.seed;
    }

    // Identity of the *generated field*, for cache invalidation: two maps
    // with equal signatures produce identical elevations everywhere, so a
    // cached field stays valid across any option change that leaves this
    // string untouched (seaLevel and landRange, today).
    signature() {
      return signatureOf(this.options);
    }

    // Raw fractal Brownian motion: `octaves` octaves of gradient noise,
    // each `lacunarity`x finer and `gain`x weaker than the last, normalized
    // by the total amplitude so the result stays in the same [-1, 1] range
    // regardless of octave count.
    fbm(x, y, z, octaves) {
      const o = this.options;
      const count = Math.max(1, Math.round(octaves === undefined ? o.octaves : octaves));
      const offsets = this._offsets;
      let px = x;
      let py = y;
      let pz = z;
      let amp = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < count; i++) {
        const k = (i * 3) % offsets.length;
        sum += amp * this.noise.noise(px + offsets[k], py + offsets[k + 1], pz + offsets[k + 2]);
        norm += amp;
        amp *= o.gain;
        const rx = ROT[0] * px + ROT[1] * py + ROT[2] * pz;
        const ry = ROT[3] * px + ROT[4] * py + ROT[5] * pz;
        const rz = ROT[6] * px + ROT[7] * py + ROT[8] * pz;
        px = rx * o.lacunarity;
        py = ry * o.lacunarity;
        pz = rz * o.lacunarity;
      }
      return sum / norm;
    }

    // Elevation at a point in 3D noise space. `heightAt` and `heightAt2D`
    // are both thin wrappers over this, so a sphere sample and a plane
    // sample go through exactly the same terrain pipeline.
    heightAtPoint(x, y, z) {
      const o = this.options;
      const f = o.frequency;
      let px = x * f;
      let py = y * f;
      let pz = z * f;

      if (o.warp > 0) {
        // One octave per axis, at three well-separated offsets, is enough
        // to break up coastlines and costs 3 noise calls instead of the 18
        // a full fBm warp vector would.
        const wf = o.warpFrequency;
        const wx = px * wf;
        const wy = py * wf;
        const wz = pz * wf;
        const n = this.noise;
        px += o.warp * n.noise(wx + 17.13, wy + 3.71, wz + 9.29);
        py += o.warp * n.noise(wx - 5.47, wy + 21.03, wz - 13.61);
        pz += o.warp * n.noise(wx + 11.87, wy - 7.19, wz + 25.43);
      }

      let h = this.fbm(px, py, pz, o.octaves) + o.landBias;

      if (o.ridge > 0) {
        // `1 - |noise|` creates sharp creases where the noise crosses zero;
        // squaring sharpens them further into ridge lines. Masked by `h`
        // itself (not by seaLevel) so mountains only grow on land while
        // keeping the field independent of the sea-level threshold - that
        // independence is what lets seaLevel stay a live control without
        // invalidating cached elevations.
        const rf = o.ridgeFrequency;
        const r = 1 - Math.abs(this.noise.noise(px * rf + 41.7, py * rf + 19.3, pz * rf - 27.9));
        h += o.ridge * r * r * clamp01(h / 0.18) * 0.35;
      }

      return h;
    }

    // Elevation at a point on the unit sphere. Pass a unit vector: x/z span
    // the equator, y points at the north pole. Not normalized internally -
    // callers building points from lon/lat already have unit vectors, and
    // an extra hypot per sample is the single hottest cost in the module.
    heightAt(x, y, z) {
      return this.heightAtPoint(x, y, z);
    }

    heightAtLonLat(lon, lat) {
      const c = Math.cos(lat);
      return this.heightAtPoint(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon));
    }

    // Same terrain on a flat plane, for effects that want a map rather than
    // a globe. Coordinates are in noise space, so `frequency` means cycles
    // per unit of whatever the caller passes in. Fixed z slice, so a given
    // seed always yields the same plane.
    heightAt2D(x, y) {
      return this.heightAtPoint(x, y, 0.3719);
    }

    isLand(h) {
      return h > this.options.seaLevel;
    }

    // 0 at the waterline, 1 at `landRange` above it - the value a renderer
    // shades or sizes by. Ocean returns 0.
    landFactor(h) {
      return clamp01((h - this.options.seaLevel) / this.options.landRange);
    }
  }

  // --- Sphere lattice --------------------------------------------------

  // Ceiling on lattice rows, and so on memory: rows N holds roughly
  // 4N²/π points at 2 bytes each, making 1100 rows ~3MB. Past this the
  // dots are finer than a screen pixel anyway, so the cap costs nothing
  // visible and stops an extreme zoom/DPI combination from trying to
  // allocate hundreds of MB.
  const MAX_ROWS = 1100;

  // Elevation is cached as a Uint16 with 0 reserved for "not sampled yet",
  // so the field needs no companion occupancy array. ±2 covers any value
  // the generator can produce (fBm is bounded by ±1 and the ridge term adds
  // well under 0.2) with ~6e-5 of quantization error, far below a pixel of
  // visible difference.
  const H_SPAN = 2;
  const H_STEP = (H_SPAN * 2) / 65534;

  /**
   * An equal-area-ish grid of points covering the whole sphere: `rows`
   * latitude rings, each holding however many evenly-spaced longitudes it
   * takes to match the row spacing at that latitude. Unlike a plain
   * lon/lat grid this doesn't crowd points together at the poles, so a
   * renderer gets uniform coverage everywhere.
   *
   * Each point's elevation is sampled at most once, on first request, and
   * cached for the lifetime of the lattice. A renderer panning across the
   * world therefore pays for each point one time, no matter how many
   * frames it stays on screen, and the terrain is pixel-stable rather than
   * being re-derived (and re-rounded) every frame.
   */
  class SphereLattice {
    constructor(rows, seed = 1) {
      const n = Math.max(8, Math.min(MAX_ROWS, Math.round(rows)));
      this.unbounded = false;
      this.wraps = true;
      this.rows = n;
      this.rowStep = Math.PI / n;
      this.lat = new Float64Array(n);
      this.sinLat = new Float64Array(n);
      this.cosLat = new Float64Array(n);
      this.cols = new Int32Array(n);
      this.step = new Float64Array(n);
      // sin/cos of one longitude step, so a renderer can walk a row with an
      // incremental rotation instead of two trig calls per point.
      this.stepSin = new Float64Array(n);
      this.stepCos = new Float64Array(n);
      // Random longitude offset per row, which breaks up the vertical
      // banding a lattice of perfectly aligned rows would otherwise show.
      this.phase = new Float64Array(n);
      this.offset = new Int32Array(n);

      const rand = mulberry32(seed);
      let total = 0;
      for (let j = 0; j < n; j++) {
        const lat = -HALF_PI + (j + 0.5) * this.rowStep;
        const c = Math.cos(lat);
        this.lat[j] = lat;
        this.sinLat[j] = Math.sin(lat);
        this.cosLat[j] = c;
        const cols = Math.max(1, Math.round(2 * n * c));
        this.cols[j] = cols;
        const st = TAU / cols;
        this.step[j] = st;
        this.stepSin[j] = Math.sin(st);
        this.stepCos[j] = Math.cos(st);
        this.phase[j] = rand() * st;
        this.offset[j] = total;
        total += cols;
      }
      this.size = total;
      this._h = new Uint16Array(total);
    }

    // Row index whose ring is nearest a given latitude, unclamped so
    // callers can widen a range before clamping it themselves.
    rowAt(lat) {
      return Math.round((lat + HALF_PI) / this.rowStep - 0.5);
    }

    // Elevation at lattice point (row j, column i), sampling `map` on first
    // request only. `i` must already be reduced into [0, cols).
    heightAt(map, j, i) {
      const flat = this.offset[j] + i;
      const stored = this._h[flat];
      if (stored !== 0) return (stored - 1) * H_STEP - H_SPAN;
      const lon = this.phase[j] + i * this.step[j];
      const c = this.cosLat[j];
      const h = map.heightAt(c * Math.cos(lon), this.sinLat[j], c * Math.sin(lon));
      const q = clamp01((h + H_SPAN) / (H_SPAN * 2));
      const stamped = 1 + Math.round(q * 65534);
      this._h[flat] = stamped;
      // Deliberately the value that was stored rather than the one that was
      // sampled: a point read once and then again has to answer the same
      // thing both times. The difference is a quantization step, but a point
      // sitting that close to the waterline would otherwise be land on the
      // frame it was first sampled and sea on every frame after.
      return (stamped - 1) * H_STEP - H_SPAN;
    }

    // Elevation anywhere along row j, linearly interpolated between the two
    // columns either side of `lon` rather than snapped to the nearer one.
    // A renderer tracing contours needs this: sampling the nearest column
    // gives a piecewise-constant field, whose contours are blocky and jump
    // a whole cell at a time as the world moves under them.
    heightAtLon(map, j, lon) {
      const cols = this.cols[j];
      const t = (lon - this.phase[j]) / this.step[j];
      const i = Math.floor(t);
      let a = i % cols;
      if (a < 0) a += cols;
      const b = a + 1 === cols ? 0 : a + 1;
      const ha = this.heightAt(map, j, a);
      return ha + (this.heightAt(map, j, b) - ha) * (t - i);
    }

    // --- uniform grid interface (see PlaneGrid) ---
    latOf(j) { return this.lat[j]; }

    stepOf(j) { return this.step[j]; }

    phaseOf(j) { return this.phase[j]; }

    colsOf(j) { return this.cols[j]; }
  }

  /**
   * A plain longitude/latitude grid over the sphere: the same number of
   * evenly spaced columns on every row, which is the opposite trade to
   * SphereLattice's equal-area rings.
   *
   * Contour tracing is what needs that trade: it wants cells that are
   * quadrilaterals sharing whole edges with their neighbours, and rings
   * whose column counts differ row to row do not line up that way — the
   * mismatch shows as notches along every coastline. Walking a band of
   * cells also needs both of its rows to start at the same column, which
   * only a grid with one phase and one column step for every row gives.
   *
   * It stores no elevations of its own. Heights come from a SphereLattice,
   * bilinearly interpolated, so both grids read one cached copy of the world
   * rather than sampling it twice.
   *
   * Deliberately interface-compatible with SphereLattice (`cols`, `step`,
   * `stepSin`, `stepCos`, `phase`, `sinLat`, `cosLat`, `rowAt`, `heightAt`)
   * so a renderer can walk either without knowing which it has.
   */
  class LonLatGrid {
    constructor(rows, cols, lattice) {
      const n = Math.max(4, Math.min(MAX_ROWS, Math.round(rows)));
      const m = Math.max(8, Math.min(MAX_ROWS * 2, Math.round(cols)));
      this.unbounded = false;
      this.wraps = true;
      this.rows = n;
      this.maxCols = m;
      this.rowStep = Math.PI / n;
      this.lattice = lattice;
      this.lat = new Float64Array(n);
      this.sinLat = new Float64Array(n);
      this.cosLat = new Float64Array(n);
      this.cols = new Int32Array(n);
      this.step = new Float64Array(n);
      this.stepSin = new Float64Array(n);
      this.stepCos = new Float64Array(n);
      this.phase = new Float64Array(n);
      // Which lattice rows each grid row falls between, resolved once here
      // instead of on every one of the thousands of samples per frame.
      this._rowLo = new Int32Array(n);
      this._rowHi = new Int32Array(n);
      this._rowMix = new Float64Array(n);

      const st = TAU / m;
      const stSin = Math.sin(st);
      const stCos = Math.cos(st);
      for (let j = 0; j < n; j++) {
        const lat = -HALF_PI + (j + 0.5) * this.rowStep;
        this.lat[j] = lat;
        this.sinLat[j] = Math.sin(lat);
        this.cosLat[j] = Math.cos(lat);
        this.cols[j] = m;
        this.step[j] = st;
        this.stepSin[j] = stSin;
        this.stepCos[j] = stCos;
        this.phase[j] = 0;
        const t = (lat + HALF_PI) / lattice.rowStep - 0.5;
        const lo = Math.max(0, Math.min(lattice.rows - 1, Math.floor(t)));
        this._rowLo[j] = lo;
        this._rowHi[j] = Math.min(lattice.rows - 1, lo + 1);
        this._rowMix[j] = clamp01(t - lo);
      }
    }

    rowAt(lat) {
      return Math.round((lat + HALF_PI) / this.rowStep - 0.5);
    }

    heightAtLon(map, j, lon) {
      const lattice = this.lattice;
      const lo = this._rowLo[j];
      const hi = this._rowHi[j];
      const h0 = lattice.heightAtLon(map, lo, lon);
      if (hi === lo) return h0;
      return h0 + (lattice.heightAtLon(map, hi, lon) - h0) * this._rowMix[j];
    }

    heightAt(map, j, i) {
      return this.heightAtLon(map, j, i * this.step[j]);
    }

    // --- uniform grid interface (see PlaneGrid) ---
    latOf(j) { return this.lat[j]; }

    stepOf(j) { return this.step[j]; }

    phaseOf(j) { return this.phase[j]; }

    colsOf(j) { return this.cols[j]; }
  }

  /**
   * A square grid on an endless plane, for worlds that are not globes.
   *
   * A sphere is a finite surface: unroll it and you get a sheet with a top
   * and a bottom, because the poles are real places you can reach. A map
   * that should simply keep going in every direction is a different object,
   * and it comes from WorldMap's planar sampling rather than its spherical
   * one — so there are no poles, no wrap, and no distortion anywhere.
   *
   * Unbounded means the row and column indices are plain signed integers
   * with no range, so elevations cannot be stored in one array indexed by
   * position. They live instead in a rolling window: a fixed block of slots
   * addressed modulo its own size, each remembering which cell it currently
   * holds. Panning re-uses every slot still in view and quietly overwrites
   * the ones that scrolled off the far side, which keeps the memory flat no
   * matter how far the map travels.
   *
   * Interface-compatible with SphereLattice and LonLatGrid, via the `latOf`
   * / `stepOf` / `phaseOf` / `colsOf` accessors that all three implement, so
   * a renderer can walk any of them. `wraps` and `unbounded` tell it which
   * of the edge rules apply.
   */
  class PlaneGrid {
    // `terrainScale` multiplies a cell's world position before the terrain
    // is sampled, so features can be made larger or smaller without moving
    // the grid itself. A caller showing a lot of world at once wants it
    // below 1: sample too much terrain per cell and coastlines stop being
    // a gradual dither and become a hard cell-aligned edge.
    constructor(step, cols, rows, terrainScale = 1) {
      this.unbounded = true;
      this.wraps = false;
      this.step = Math.max(1e-6, step);
      this.terrainScale = terrainScale;
      this.rows = Math.max(8, Math.round(rows));
      this.cols = Math.max(8, Math.round(cols));
      const n = this.rows * this.cols;
      this._h = new Float32Array(n);
      this._u = new Int32Array(n);
      this._v = new Int32Array(n);
      // Cell (0, 0) is a perfectly ordinary cell, so the coordinates alone
      // cannot say whether a slot has been written. One byte per slot does.
      this._filled = new Uint8Array(n);
    }

    latOf(j) { return j * this.step; }

    stepOf() { return this.step; }

    phaseOf() { return 0; }

    colsOf() { return this.cols; }

    rowAt(y) { return Math.round(y / this.step); }

    heightAt(map, j, i) {
      const w = this.cols;
      const h = this.rows;
      let su = i % w;
      if (su < 0) su += w;
      let sv = j % h;
      if (sv < 0) sv += h;
      const k = sv * w + su;
      if (this._filled[k] === 1 && this._u[k] === i && this._v[k] === j) return this._h[k];
      const t = this.step * this.terrainScale;
      const value = map.heightAt2D(i * t, j * t);
      this._u[k] = i;
      this._v[k] = j;
      this._h[k] = value;
      this._filled[k] = 1;
      return value;
    }

    // Elevation anywhere along row j, interpolated between the columns
    // either side — the planar counterpart of SphereLattice.heightAtLon.
    heightAtLon(map, j, x) {
      const t = x / this.step;
      const i = Math.floor(t);
      const h0 = this.heightAt(map, j, i);
      return h0 + (this.heightAt(map, j, i + 1) - h0) * (t - i);
    }
  }

  WorldMap.SphereLattice = SphereLattice;
  WorldMap.LonLatGrid = LonLatGrid;
  WorldMap.PlaneGrid = PlaneGrid;
  WorldMap.signatureOf = signatureOf;
  WorldMap.MAX_ROWS = MAX_ROWS;

  global.WorldMap = WorldMap;
})(typeof window !== 'undefined' ? window : globalThis);
