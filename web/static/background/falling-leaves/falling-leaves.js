/**
 * Falling Leaves
 * --------------
 * A canvas background of leaves drifting down through an open field. Each
 * leaf falls like a real one rather than a weighted dot: it swings side to
 * side on its own pendulum, dropping fastest through the middle of a swing
 * and hanging at either end of it, tilting into whichever way it is
 * swinging, and slowly flipping over about its midrib so its darker
 * underside shows on the way past. Leaves sit at different depths: farther
 * ones are smaller, slower and fainter, so the field has some parallax
 * rather than reading as one flat sheet. A steady `wind` leans the whole
 * fall to one side, and every so often a gust rolls across from the
 * upwind edge, so the leaves it reaches first get pushed first, spinning
 * faster and lifting slightly as it passes.
 *
 * Both what falls and what color it is are open: `shapes` takes built-in
 * leaf names ('maple', 'oak', 'birch', 'oval', 'petal') or your own SVG
 * path data drawn in a -1..1 box, and `colors` takes any list of CSS
 * colors. By default each leaf is exactly one of those colors; with
 * `blend` on, the list is read as a gradient instead, and each leaf lands
 * anywhere along it. So the same motion also does blossom petals,
 * confetti, or anything else that should flutter rather than just fall.
 *
 * Usage: give any element `class="bg-falling-leaves"` — this file injects
 * its own CSS and auto-initializes every matching element on load, so
 * dropping the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'falling-leaves-styles';
  const CSS = `
.bg-falling-leaves {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.falling-leaves__canvas {
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

  const DEFAULTS = {
    count: 40,
    fallSpeed: 45,
    sway: 40,
    tumble: 1,
    wind: 10,
    gusts: 1,
    size: 14,
    background: '#ffffff',
    colors: ['#b5381f', '#d3622a', '#e39b2d', '#c9a227', '#7a4a22'],
    blend: false,
    shapes: ['maple', 'oak', 'birch', 'oval'],
  };

  // Built-in outlines, in a -1..1 box with the tip at the top (-1) and the
  // stem end toward the bottom (+1). `vein` draws a midrib down the middle
  // that runs on past the blade to double as the stem; custom path strings
  // get no vein, since a petal or a scrap of confetti shouldn't have one.
  const SHAPE_PATHS = {
    maple: {
      d: 'M0 -1 L0.18 -0.55 L0.45 -0.7 L0.38 -0.3 L0.85 -0.4 L0.62 -0.05 L0.8 0.12 '
        + 'L0.36 0.2 L0.42 0.45 L0 0.34 L-0.42 0.45 L-0.36 0.2 L-0.8 0.12 L-0.62 -0.05 '
        + 'L-0.85 -0.4 L-0.38 -0.3 L-0.45 -0.7 L-0.18 -0.55 Z',
      vein: true,
    },
    oak: {
      d: 'M0 -1 Q0.32 -0.92 0.22 -0.7 Q0.52 -0.66 0.3 -0.42 Q0.62 -0.3 0.32 -0.1 '
        + 'Q0.62 0.05 0.3 0.25 Q0.5 0.46 0.12 0.58 L-0.12 0.58 Q-0.5 0.46 -0.3 0.25 '
        + 'Q-0.62 0.05 -0.32 -0.1 Q-0.62 -0.3 -0.3 -0.42 Q-0.52 -0.66 -0.22 -0.7 '
        + 'Q-0.32 -0.92 0 -1 Z',
      vein: true,
    },
    birch: {
      d: 'M0 -1 C0.5 -0.75 0.8 -0.1 0.55 0.35 C0.4 0.65 0.15 0.8 0 0.82 '
        + 'C-0.15 0.8 -0.4 0.65 -0.55 0.35 C-0.8 -0.1 -0.5 -0.75 0 -1 Z',
      vein: true,
    },
    oval: {
      d: 'M0 -1 C0.42 -0.55 0.42 0.45 0 0.85 C-0.42 0.45 -0.42 -0.55 0 -1 Z',
      vein: true,
    },
    petal: {
      d: 'M0 1 C0.7 0.5 0.75 -0.55 0.25 -1 L0 -0.75 L-0.25 -1 C-0.75 -0.55 -0.7 0.5 0 1 Z',
      vein: false,
    },
  };

  // The midrib, in the same -1..1 box. It runs past the bottom of every
  // built-in blade, so the overhang reads as the stem.
  const VEIN = new Path2D('M0 -0.8 L0 1');

  // Depth range: 1 is nearest. Far leaves scale down in size, speed and
  // opacity together, which is what sells the parallax.
  const DEPTH_MIN = 0.45;

  // How long a gust takes to build and to die away, in seconds, and how
  // long it takes to roll from the upwind edge to the downwind one.
  const GUST_RISE = 1.2;
  const GUST_DECAY = 3;
  const GUST_TRAVEL = 0.9;

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function gustEnvelope(t) {
    if (t <= 0 || t >= GUST_RISE + GUST_DECAY) return 0;
    if (t < GUST_RISE) return smoothstep(t / GUST_RISE);
    return smoothstep(1 - (t - GUST_RISE) / GUST_DECAY);
  }

  // Any CSS color the canvas understands, as [r, g, b]. Assigning it to a
  // scratch context's fillStyle lets the browser do the parsing: it reads
  // back as '#rrggbb', or as 'rgba(...)' when the color has transparency
  // (whose alpha is dropped here; leaves are drawn opaque). A string the
  // browser rejects leaves fillStyle as it was, so it comes back black.
  let scratch = null;
  function parseColor(color) {
    if (!scratch) scratch = document.createElement('canvas').getContext('2d');
    scratch.fillStyle = '#000000';
    scratch.fillStyle = color;
    const value = scratch.fillStyle;
    if (value[0] === '#') {
      return [1, 3, 5].map((i) => parseInt(value.substring(i, i + 2), 16));
    }
    return value.match(/[\d.]+/g).slice(0, 3).map(Number);
  }

  // An empty list would leave a leaf nothing to pick, so it falls back to
  // the defaults rather than throwing mid-frame.
  function resolveColors(list) {
    return (list.length ? list : DEFAULTS.colors).map(parseColor);
  }

  function mix(a, b, t) {
    return a.map((c, i) => Math.round(c + (b[i] - c) * t));
  }

  // The color at `t` (0..1) along a gradient running through `stops` in
  // order, spaced evenly.
  function sampleGradient(stops, t) {
    if (stops.length === 1) return stops[0];
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    return mix(stops[i], stops[i + 1], seg - i);
  }

  // Mixes toward black (amount < 0) or white (amount > 0).
  function shade(rgb, amount) {
    const target = amount < 0 ? 0 : 255;
    const k = Math.abs(amount);
    return rgb.map((c) => Math.round(c + (target - c) * k));
  }

  function rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  // Accepts a built-in name, raw SVG path data, or a ready-made Path2D.
  function resolveShapes(list) {
    return (list.length ? list : DEFAULTS.shapes).map((shape) => {
      if (shape instanceof Path2D) return { path: shape, vein: false };
      const builtIn = SHAPE_PATHS[shape];
      if (builtIn) return { path: new Path2D(builtIn.d), vein: builtIn.vein };
      return { path: new Path2D(shape), vein: false };
    });
  }

  class FallingLeaves {
    constructor(el, options = {}) {
      if (!el) throw new Error('FallingLeaves: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._shapes = resolveShapes(this.options.shapes);
      this._stops = resolveColors(this.options.colors);
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'falling-leaves__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      this._leaves = [];
      this._raf = null;
      this._elapsed = 0;
      this._lastNow = performance.now();
      this._gustStart = -Infinity;
      this._gustPeak = 0;
      this._nextGustAt = randomBetween(3, 7);

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      // Stop the loop once the element has scrolled out of view, same as
      // the other backgrounds: requestAnimationFrame only pauses itself for
      // a hidden tab, not for an element scrolled far above the reader.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (on) this._start();
        else this._stop();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.el);

      this._resize();
      if (this._reduced) {
        this._render();
      } else {
        this._start();
      }
    }

    _start() {
      if (this._raf || this._reduced || !this._onScreen) return;
      this._lastNow = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    // clientWidth/clientHeight rather than getBoundingClientRect, for the
    // same reason as Fireflies: the host may sit under a CSS transform the
    // canvas already inherits, and the bounding rect would apply it twice.
    //
    // A host with no size at all is hidden (display: none, or the homepage
    // filter's `hidden`), not resized: that's skipped outright, so the
    // field picks up where it left off when it's shown again instead of
    // every leaf having been squeezed into a 1px box in the meantime.
    // Otherwise leaves keep their place proportionally, so a narrower box
    // spreads them across its new width rather than piling them up against
    // the right edge.
    _resize() {
      const width = this.el.clientWidth;
      const height = this.el.clientHeight;
      if (!width || !height) return;
      const oldW = this._w;
      const oldH = this._h;
      this._dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._w = width;
      this._h = height;
      this.canvas.width = Math.round(this._w * this._dpr);
      this.canvas.height = Math.round(this._h * this._dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      if (!this._leaves.length) {
        this._spawn(Math.round(this.options.count));
      } else {
        const sx = this._w / oldW;
        const sy = this._h / oldH;
        this._leaves.forEach((leaf) => {
          leaf.x *= sx;
          leaf.y *= sy;
        });
      }
      if (this._reduced) this._render();
    }

    // Colors a leaf from its own fixed random pick and jitter rather than
    // fresh randoms, so editing the palette shifts every leaf smoothly (a
    // leaf that was the second color stays the second color) instead of
    // reshuffling the whole field on every change.
    _paint(leaf) {
      const { _stops: stops } = this;
      const base = this.options.blend
        ? sampleGradient(stops, leaf.colorPick)
        : stops[Math.min(stops.length - 1, Math.floor(leaf.colorPick * stops.length))];
      // A little lightness jitter per leaf, so a five-color palette still
      // reads as a pile of individual leaves rather than five stamps.
      const front = shade(base, leaf.colorJitter);
      leaf.front = rgbCss(front);
      leaf.back = rgbCss(shade(front, -0.28));
      leaf.vein = rgbCss(shade(front, -0.42));
    }

    _shapeLeaf(leaf) {
      leaf.shape = this._shapes[Math.floor(Math.random() * this._shapes.length)];
    }

    // Spread the initial population over the whole field (not just above
    // it), so the first frame is already mid-fall instead of empty.
    _spawn(count) {
      for (let i = 0; i < count; i++) {
        const leaf = {
          x: Math.random() * this._w,
          y: randomBetween(-this.options.size * 2, this._h),
          z: randomBetween(DEPTH_MIN, 1),
          sizeMul: randomBetween(0.75, 1.25),
          fallMul: randomBetween(0.8, 1.2),
          swayPhase: Math.random() * Math.PI * 2,
          swayRate: randomBetween(1.1, 2),
          swayTilt: randomBetween(0.4, 0.8),
          spin: Math.random() * Math.PI * 2,
          spinRate: randomBetween(-0.25, 0.25),
          flip: Math.random() * Math.PI * 2,
          flipRate: randomBetween(0.9, 2.2) * (Math.random() < 0.5 ? -1 : 1),
          colorPick: Math.random(),
          colorJitter: randomBetween(-0.12, 0.1),
        };
        this._paint(leaf);
        this._shapeLeaf(leaf);
        this._leaves.push(leaf);
      }
      // Draw far-to-near, so nearer leaves pass in front of farther ones.
      this._leaves.sort((a, b) => a.z - b.z);
    }

    _setCount(count) {
      const current = this._leaves.length;
      if (count > current) {
        this._spawn(count - current);
      } else {
        // Remove at random rather than off the end, since the array is in
        // depth order and trimming the end would strip out the nearest
        // leaves first.
        for (let i = current; i > count; i--) {
          this._leaves.splice(Math.floor(Math.random() * this._leaves.length), 1);
        }
      }
    }

    _respawnAtTop(leaf, margin) {
      leaf.y = -margin;
      leaf.x = Math.random() * this._w;
    }

    _advanceGust() {
      if (this._elapsed < this._nextGustAt) return;
      const { wind } = this.options;
      const dir = Math.sign(wind) || (Math.random() < 0.5 ? -1 : 1);
      this._gustStart = this._elapsed;
      // Stored unscaled, so moving the Gusts control mid-gust takes effect
      // on the gust already blowing rather than only the next one.
      this._gustPeak = randomBetween(35, 70) * dir;
      this._nextGustAt = this._elapsed + GUST_RISE + GUST_DECAY + randomBetween(3, 9);
    }

    // The gust's strength at this leaf right now. Delayed by how far the
    // leaf sits from the upwind edge, so a gust visibly rolls across.
    _gustAt(x) {
      if (!this._gustPeak || !this.options.gusts) return 0;
      const across = x / this._w;
      const delay = (this._gustPeak > 0 ? across : 1 - across) * GUST_TRAVEL;
      return this._gustPeak * this.options.gusts * gustEnvelope(this._elapsed - this._gustStart - delay);
    }

    _advance(dt) {
      this._advanceGust();
      const { fallSpeed, sway, tumble, wind, size } = this.options;
      const w = this._w;
      const h = this._h;
      this._leaves.forEach((leaf) => {
        const margin = size * leaf.sizeMul * 2;
        const gust = this._gustAt(leaf.x);
        const gustSpin = 1 + Math.abs(gust) / 40;

        leaf.swayPhase += leaf.swayRate * dt;
        const swing = Math.cos(leaf.swayPhase);

        // Pendulum flutter: the swing's horizontal speed peaks through the
        // middle, which is also where the leaf drops fastest; at either end
        // it nearly hangs before swinging back.
        const vx = (wind + gust) * (0.6 + 0.4 * leaf.z) + sway * leaf.z * leaf.swayRate * swing;
        // A gust lifts too, scaled by depth like everything else so far
        // leaves don't rise faster than near ones. Capped so a gust can
        // only float a leaf briefly upward, never carry it off the top.
        const fall = fallSpeed * leaf.z * leaf.fallMul * (0.35 + 0.65 * Math.abs(swing));
        const lift = Math.abs(gust) * 0.15 * leaf.z;
        const vy = Math.max(fall - lift, -0.2 * fallSpeed * leaf.z);
        leaf.x += vx * dt;
        leaf.y += vy * dt;

        leaf.spin += leaf.spinRate * tumble * gustSpin * dt;
        leaf.flip += leaf.flipRate * tumble * gustSpin * dt;

        if (leaf.y > h + margin) this._respawnAtTop(leaf, margin);
        if (leaf.x < -margin) leaf.x += w + margin * 2;
        else if (leaf.x > w + margin) leaf.x -= w + margin * 2;
      });
    }

    _render() {
      // Nothing to draw into until the host has had a size at least once
      // (see _resize).
      if (!this._w) return;
      const { ctx, _w: w, _h: h, _dpr: dpr } = this;
      const { background, size } = this.options;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (background && background !== 'transparent') {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }

      this._leaves.forEach((leaf) => {
        const s = size * leaf.sizeMul * leaf.z;
        // Tilts into the direction it's swinging, on top of its own slow
        // spin. sin(phase) leads the swing's velocity (cos), so the leaf
        // is already leaning the right way as it reaches each end.
        const angle = leaf.spin + Math.sin(leaf.swayPhase) * leaf.swayTilt;
        // Flipping about the midrib: squash across the width, and switch to
        // the darker back color once the leaf has turned past edge-on.
        const flip = Math.cos(leaf.flip);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const sx = s * flip;
        ctx.setTransform(
          cos * sx * dpr, sin * sx * dpr,
          -sin * s * dpr, cos * s * dpr,
          leaf.x * dpr, leaf.y * dpr,
        );
        ctx.globalAlpha = 0.55 + 0.45 * leaf.z;
        ctx.fillStyle = flip >= 0 ? leaf.front : leaf.back;
        ctx.fill(leaf.shape.path);
        if (leaf.shape.vein) {
          ctx.strokeStyle = leaf.vein;
          ctx.lineWidth = 0.07;
          ctx.stroke(VEIN);
        }
      });
      ctx.globalAlpha = 1;
    }

    _tick(now) {
      // Clamped below too: rAF's timestamp is the frame's start, which can
      // fall slightly before the performance.now() that _start() recorded.
      const dt = Math.min(0.05, Math.max(0, (now - this._lastNow) / 1000));
      this._lastNow = now;
      this._elapsed += dt;
      this._advance(dt);
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
      if ('count' in newOptions) this._setCount(Math.round(this.options.count));
      if ('colors' in newOptions) this._stops = resolveColors(this.options.colors);
      if ('colors' in newOptions || 'blend' in newOptions) this._leaves.forEach((leaf) => this._paint(leaf));
      if ('shapes' in newOptions) {
        this._shapes = resolveShapes(this.options.shapes);
        this._leaves.forEach((leaf) => this._shapeLeaf(leaf));
      }
      if (this._reduced) this._render();
    }

    destroy() {
      this._stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      this.canvas.remove();
    }
  }

  FallingLeaves.SHAPES = Object.keys(SHAPE_PATHS);

  FallingLeaves.initAll = function (selector = '.bg-falling-leaves', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__fallingLeavesInstance)
      .map((el) => {
        const instance = new FallingLeaves(el, options);
        el.__fallingLeavesInstance = instance;
        return instance;
      });
  };

  FallingLeaves.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__fallingLeavesInstance || null : null;
  };

  FallingLeaves.getAll = function (selector = '.bg-falling-leaves') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__fallingLeavesInstance)
      .filter(Boolean);
  };

  global.FallingLeaves = FallingLeaves;

  function autoInit() {
    FallingLeaves.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
