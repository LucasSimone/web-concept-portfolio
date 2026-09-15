/**
 * CircuitBoard
 * ------------
 * A canvas background of PCB-style traces where visibility is entirely
 * driven by a small dot traveling each trace: the dot lights the path as it
 * passes, leaving a tail that fades to a dim floor (not zero) while the dot
 * is still moving. Once the dot reaches the far end and the tail has caught
 * up so the whole trace sits at that dim floor, the trace fades the rest of
 * the way to nothing — then, after a pause, a brand new trace is drawn in a
 * fresh location. Nothing ever reappears where it just was, and lights are
 * started at random points in their lifecycle so the board never looks like
 * it's collectively "starting" or "ending" — some are always mid-travel,
 * some fading, some freshly spawned.
 *
 * Usage: give any element `class="bg-circuit-board"` — this file injects
 * its own CSS and auto-initializes every matching element on load, so
 * dropping the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'circuit-board-styles';
  const CSS = `
.bg-circuit-board {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.circuit-board__canvas {
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
    cell: 34,
    maxTraces: 80,
    maxLength: 30,
    speed: 20,
    fadeDuration: 0.5,
    allowOverlap: false,
    background: '#ffffff',
    traceColor: '0, 0, 0',
    pulseColor: '0, 0, 0',
  };

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function edgeKey(x1, y1, x2, y2) {
    return x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1}-${x2},${y2}` : `${x2},${y2}-${x1},${y1}`;
  }

  class CircuitBoard {
    constructor(el, options = {}) {
      if (!el) throw new Error('CircuitBoard: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._minDim = 0.14;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'circuit-board__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      this._lights = [];
      this._occupiedEdges = new Set();
      this._occupiedVertices = new Set();
      this._raf = null;
      this._elapsed = 0;
      this._lastNow = performance.now();

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      this._resize();
      if (this._reduced) {
        this._lights.forEach((light) => { light.dist = light.total * 0.5; });
        this._render();
      } else {
        this._raf = requestAnimationFrame(this._tick);
      }
    }

    _resize() {
      const rect = this.el.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._w = Math.max(1, Math.round(rect.width));
      this._h = Math.max(1, Math.round(rect.height));
      this.canvas.width = Math.round(this._w * dpr);
      this.canvas.height = Math.round(this._h * dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._rebuild();
    }

    // Recomputes the grid and starts a fresh pool of lights. Anything
    // structural (element size, grid spacing, overlap rule) goes through
    // here since old trace coordinates/occupancy no longer apply.
    _rebuild() {
      const { cell } = this.options;
      this._cols = Math.max(2, Math.round(this._w / cell));
      this._rows = Math.max(2, Math.round(this._h / cell));
      this._stepX = this._w / this._cols;
      this._stepY = this._h / this._rows;
      this._tailLength = Math.max(cell * 2.5, 60);
      this._occupiedEdges = new Set();
      this._occupiedVertices = new Set();
      this._lights = [];
      this._spawnLights(Math.round(this.options.maxTraces), true);
      if (this._reduced) {
        this._lights.forEach((light) => { light.dist = light.total * 0.5; });
        this._render();
      }
    }

    // Unit-step random walk on the grid. A path never crosses itself
    // regardless of the overlap setting; when overlap is disallowed, every
    // vertex and edge a path touches is also exclusive to it — two live
    // traces can never share so much as a point, so they can't cross either.
    _buildPath() {
      const cols = this._cols;
      const rows = this._rows;
      const overlap = this.options.allowOverlap;
      const minSteps = 4;
      const maxSteps = Math.max(minSteps, Math.round(this.options.maxLength));
      for (let attempt = 0; attempt < 6; attempt++) {
        const gx0 = Math.floor(Math.random() * (cols + 1));
        const gy0 = Math.floor(Math.random() * (rows + 1));
        if (!overlap && this._occupiedVertices.has(`${gx0},${gy0}`)) continue;

        let gx = gx0;
        let gy = gy0;
        const cells = [[gx, gy]];
        const edges = [];
        const selfVertices = new Set([`${gx0},${gy0}`]);
        let dir = null;
        let stepsInDir = 0;
        const targetSteps = minSteps + Math.floor(Math.random() * (maxSteps - minSteps + 1));

        const free = (nx, ny) => {
          if (nx < 0 || nx > cols || ny < 0 || ny > rows) return false;
          if (selfVertices.has(`${nx},${ny}`)) return false; // never cross or touch itself
          if (overlap) return true;
          return !this._occupiedVertices.has(`${nx},${ny}`) && !this._occupiedEdges.has(edgeKey(gx, gy, nx, ny));
        };

        while (cells.length - 1 < targetSteps) {
          if (stepsInDir <= 0) {
            // At a fresh cell: try every direction (excluding the immediate
            // reverse) in random order and take the first that's free, so a
            // single blocked pick can't strand the walk in a retry loop.
            const pool = DIRS.filter((d) => !dir || d[0] !== -dir[0] || d[1] !== -dir[1])
              .sort(() => Math.random() - 0.5);
            let moved = false;
            for (const candidate of pool) {
              if (!free(gx + candidate[0], gy + candidate[1])) continue;
              dir = candidate;
              stepsInDir = 1 + Math.floor(Math.random() * 4);
              moved = true;
              break;
            }
            if (!moved) break; // boxed in on every side — end the path here
          }
          const nx = gx + dir[0];
          const ny = gy + dir[1];
          if (!free(nx, ny)) {
            stepsInDir = 0;
            continue;
          }
          edges.push(edgeKey(gx, gy, nx, ny));
          gx = nx;
          gy = ny;
          cells.push([gx, gy]);
          selfVertices.add(`${gx},${gy}`);
          stepsInDir--;
        }

        if (edges.length >= 3) {
          return this._finalizePath(cells, edges);
        }
      }
      return null;
    }

    _finalizePath(cells, edges) {
      const points = cells.map(([x, y]) => [x * this._stepX, y * this._stepY]);
      const lengths = [];
      let total = 0;
      for (let k = 1; k < points.length; k++) {
        const len = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
        lengths.push(len);
        total += len;
      }
      return { points, lengths, total, edges, cells };
    }

    _markOccupied(light) {
      light.cells.forEach(([x, y]) => this._occupiedVertices.add(`${x},${y}`));
      light.edges.forEach((e) => this._occupiedEdges.add(e));
    }

    _freeOccupied(light) {
      light.cells.forEach(([x, y]) => this._occupiedVertices.delete(`${x},${y}`));
      light.edges.forEach((e) => this._occupiedEdges.delete(e));
    }

    // New lights (initial population or growing the pool) are dropped in at
    // a random point in their travel lifecycle instead of all starting at
    // 0 together — otherwise every light reaches the end at roughly the
    // same time and the whole board visibly "restarts" in a wave.
    _spawnLights(count, stagger) {
      for (let i = 0; i < count; i++) {
        const built = this._buildPath();
        if (!built) continue;
        const maxVirtual = built.total + this._tailLength;
        const light = {
          ...built,
          dist: stagger ? Math.random() * maxVirtual : 0,
          state: 'travel',
          speedMul: 0.7 + Math.random() * 0.6,
          fadeMul: 0.8 + Math.random() * 0.4,
          fadeStart: 0,
          waitUntil: 0,
          spawnStart: this._elapsed,
        };
        this._markOccupied(light);
        this._lights.push(light);
      }
    }

    _setLightCount(count) {
      const current = this._lights.length;
      if (count > current) {
        this._spawnLights(count - current, true);
      } else if (count < current) {
        const removed = this._lights.splice(count);
        removed.forEach((light) => this._freeOccupied(light));
      }
    }

    _respawn(light) {
      const built = this._buildPath();
      if (!built) {
        light.waitUntil = this._elapsed + 0.3;
        return;
      }
      Object.assign(light, built, {
        dist: 0,
        state: 'travel',
        speedMul: 0.7 + Math.random() * 0.6,
        fadeMul: 0.8 + Math.random() * 0.4,
        fadeStart: 0,
        spawnStart: this._elapsed,
      });
      this._markOccupied(light);
    }

    _pointAt(light, dist) {
      let remaining = dist;
      for (let i = 0; i < light.lengths.length; i++) {
        const len = light.lengths[i];
        if (remaining <= len || i === light.lengths.length - 1) {
          const t = len === 0 ? 0 : Math.min(1, remaining / len);
          const [x1, y1] = light.points[i];
          const [x2, y2] = light.points[i + 1];
          return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
        }
        remaining -= len;
      }
      return light.points[light.points.length - 1];
    }

    // Brightness at arc-length `s` along a light's path: 0 ahead of the
    // dot, ramping to 1 at the dot itself, tailing down to the dim floor
    // over `_tailLength` behind it, then flat at the floor — until the
    // whole-trace fadeout takes it from the floor down to 0. Everything is
    // also scaled by how far the light has gotten through its own fade-in,
    // so a freshly (re)spawned trace eases into view instead of popping in
    // at full brightness the instant it appears.
    _brightness(light, s) {
      const minDim = this._minDim;
      let base;
      if (light.state === 'fadeout') {
        const dur = Math.max(0.3, this.options.fadeDuration * light.fadeMul);
        const progress = Math.min(1, (this._elapsed - light.fadeStart) / dur);
        base = minDim * (1 - progress);
      } else if (light.state === 'waiting') {
        return 0;
      } else {
        const behind = light.dist - s;
        if (behind < 0) base = 0;
        else if (behind >= this._tailLength) base = minDim;
        else base = 1 - (1 - minDim) * (behind / this._tailLength);
      }
      const fadeInDur = Math.max(0.15, this.options.fadeDuration * light.fadeMul);
      const spawnFade = Math.min(1, (this._elapsed - light.spawnStart) / fadeInDur);
      return base * spawnFade;
    }

    // Gradient stops for one straight segment [segStart, segStart+segLen).
    // Beyond the plain endpoints, a travel-state light gets exact stops
    // pinned at the dot's true (continuous) position and at the point
    // `_tailLength` behind it — the two places brightness bends sharply —
    // so the rendered gradient always tracks the dot precisely regardless
    // of how slowly it's moving, instead of only refreshing when `dist`
    // crosses one of a handful of fixed sample points (which is what made
    // slow motion look stepped/low-fps).
    _segmentStops(light, segStart, segLen) {
      const segEnd = segStart + segLen;
      const stops = [
        { t: 0, b: this._brightness(light, segStart) },
        { t: 1, b: this._brightness(light, segEnd) },
      ];
      if (light.state === 'travel') {
        const tailBottom = light.dist - this._tailLength;
        if (tailBottom > segStart && tailBottom < segEnd) {
          stops.push({ t: (tailBottom - segStart) / segLen, b: this._brightness(light, tailBottom) });
        }
        if (light.dist > segStart && light.dist < segEnd) {
          const t = (light.dist - segStart) / segLen;
          // Peak brightness lands exactly at the dot, then snaps straight to
          // dark a hair past it — without this second stop, the gradient
          // would linearly fade from the dot down to the segment's far
          // endpoint, painting a preview glow ahead of where the dot has
          // actually reached. Goes through `_brightness` (not a bare 1) so
          // the peak itself still respects the light's own fade-in.
          stops.push({ t, b: this._brightness(light, light.dist) });
          stops.push({ t: Math.min(1, t + 0.001), b: 0 });
        }
      }
      stops.sort((a, b) => a.t - b.t);
      return stops;
    }

    _advance(dt) {
      this._lights.forEach((light) => {
        if (light.state === 'travel') {
          const speed = this.options.speed * light.speedMul;
          light.dist += speed * dt;
          const maxVirtual = light.total + this._tailLength;
          if (light.dist >= maxVirtual) {
            light.dist = maxVirtual;
            light.state = 'fadeout';
            light.fadeStart = this._elapsed;
          }
        } else if (light.state === 'fadeout') {
          const dur = Math.max(0.3, this.options.fadeDuration * light.fadeMul);
          if (this._elapsed - light.fadeStart >= dur) {
            this._freeOccupied(light);
            light.state = 'waiting';
            light.waitUntil = this._elapsed + 0.2 + Math.random() * 1.3;
          }
        } else if (light.state === 'waiting') {
          if (this._elapsed >= light.waitUntil) this._respawn(light);
        }
      });
    }

    _drawPad(point, b) {
      if (b <= 0.01) return;
      this.ctx.fillStyle = `rgba(${this.options.traceColor}, ${(b * 0.9).toFixed(3)})`;
      this.ctx.fillRect(point[0] - 2, point[1] - 2, 4, 4);
    }

    // Small, crisp spark instead of a large soft blob — a tight core with
    // a faint halo, both scaled by the same tail-fade brightness.
    _drawDot(x, y, b) {
      if (b <= 0.02) return;
      const { ctx } = this;
      const rgb = this.options.pulseColor;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 5);
      halo.addColorStop(0, `rgba(${rgb}, ${(0.45 * b).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(${rgb}, ${(0.95 * b).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    _render() {
      const { ctx, _w: w, _h: h } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';

      this._lights.forEach((light) => {
        if (light.state === 'waiting') return;

        let sOffset = 0;
        for (let i = 1; i < light.points.length; i++) {
          const [x1, y1] = light.points[i - 1];
          const [x2, y2] = light.points[i];
          const segLen = light.lengths[i - 1];
          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          this._segmentStops(light, sOffset, segLen).forEach(({ t, b }) => {
            grad.addColorStop(Math.min(1, Math.max(0, t)), `rgba(${this.options.traceColor}, ${(b * 0.85).toFixed(3)})`);
          });
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          sOffset += segLen;
        }

        this._drawPad(light.points[0], this._brightness(light, 0));
        this._drawPad(light.points[light.points.length - 1], this._brightness(light, light.total));

        if (light.state === 'travel') {
          const s = Math.min(light.dist, light.total);
          const [dx, dy] = this._pointAt(light, s);
          this._drawDot(dx, dy, this._brightness(light, s));
        }
      });
    }

    _tick(now) {
      const dt = Math.min(0.05, (now - this._lastNow) / 1000);
      this._lastNow = now;
      this._elapsed += dt;
      this._advance(dt);
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    // Apply new option values (e.g. from a control panel). Grid spacing
    // and the overlap rule invalidate existing trace coordinates/occupancy
    // and trigger a full rebuild; a max-traces change just grows or shrinks
    // the live pool.
    update(newOptions = {}) {
      const needsRebuild = ('cell' in newOptions && newOptions.cell !== this.options.cell)
        || ('allowOverlap' in newOptions && newOptions.allowOverlap !== this.options.allowOverlap);
      Object.assign(this.options, newOptions);
      if (needsRebuild) {
        this._rebuild();
      } else if ('maxTraces' in newOptions) {
        this._setLightCount(Math.round(this.options.maxTraces));
      }
      if (this._reduced) this._render();
    }

    // Instantly retires every live trace and starts a fresh pool, without
    // changing any settings.
    randomize() {
      this._lights.forEach((light) => this._freeOccupied(light));
      this._lights = [];
      this._spawnLights(Math.round(this.options.maxTraces), true);
      if (this._reduced) {
        this._lights.forEach((light) => { light.dist = light.total * 0.5; });
        this._render();
      }
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._resizeObserver.disconnect();
      this.canvas.remove();
    }
  }

  CircuitBoard.initAll = function (selector = '.bg-circuit-board', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__circuitBoardInstance)
      .map((el) => {
        const instance = new CircuitBoard(el, options);
        el.__circuitBoardInstance = instance;
        return instance;
      });
  };

  // Look up the instance auto-created for a single element (or the first
  // match of a selector) — use this instead of `initAll()` from page code,
  // since auto-init has usually already claimed the element by the time a
  // page's own script runs.
  CircuitBoard.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__circuitBoardInstance || null : null;
  };

  CircuitBoard.getAll = function (selector = '.bg-circuit-board') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__circuitBoardInstance)
      .filter(Boolean);
  };

  global.CircuitBoard = CircuitBoard;

  function autoInit() {
    CircuitBoard.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
