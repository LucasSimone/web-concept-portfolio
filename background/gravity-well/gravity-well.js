/**
 * GravityWell
 * ------------
 * A canvas background of a wireframe grid that behaves like a sheet with the
 * cursor pulling on it: every grid vertex is displaced toward the pointer,
 * falling off smoothly with distance so nearby points get pulled hardest and
 * distant ones barely move. Nothing is actually translated across the page —
 * it's a fully self-contained background canvas — the grid itself is what
 * bends. The pull point eases toward the real cursor position and its
 * overall strength eases in/out on enter/leave, so the sheet settles rather
 * than snapping.
 *
 * Usage: give any element `class="bg-gravity-well"` — this file injects its
 * own CSS and auto-initializes every matching element on load, so dropping
 * the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'gravity-well-styles';
  const CSS = `
.bg-gravity-well {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.gravity-well__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  display: block;
  touch-action: none;
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
    cell: 16,
    radius: 90,
    strength: 45,
    ease: 0.18,
    mode: 'grid',
    dotRadius: 1.6,
    background: '#ffffff',
    lineColor: '0, 0, 0',
    lineOpacity: 0.3,
  };

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  class GravityWell {
    constructor(el, options = {}) {
      if (!el) throw new Error('GravityWell: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gravity-well__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      // Real pointer target vs. the eased position actually used to pull
      // the grid, so the pull point trails the cursor slightly instead of
      // snapping to it every frame.
      this._targetX = 0;
      this._targetY = 0;
      this._pullX = 0;
      this._pullY = 0;
      this._targetInfluence = 0;
      this._influence = 0;

      this._raf = null;

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      this.el.addEventListener('pointermove', this._onPointerMove);
      this.el.addEventListener('pointerleave', this._onPointerLeave);
      this.el.addEventListener('pointercancel', this._onPointerLeave);

      this._resize();
      this._render();
      if (!this._reduced) {
        this._raf = requestAnimationFrame(this._tick);
      }
    }

    // clientWidth/clientHeight (not getBoundingClientRect) because the host
    // element may sit under a CSS transform (e.g. the homepage carousel's
    // coverflow scale) — the canvas is a child of that same element, so it
    // inherits that transform too. Sizing it off the already-scaled
    // bounding rect would apply the scale twice.
    _resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._w = Math.max(1, this.el.clientWidth);
      this._h = Math.max(1, this.el.clientHeight);
      this.canvas.width = Math.round(this._w * dpr);
      this.canvas.height = Math.round(this._h * dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._rebuild();
    }

    _rebuild() {
      const { cell } = this.options;
      this._cols = Math.max(1, Math.round(this._w / cell));
      this._rows = Math.max(1, Math.round(this._h / cell));
      this._stepX = this._w / this._cols;
      this._stepY = this._h / this._rows;
      if (this._reduced) this._render();
    }

    // rect comes from getBoundingClientRect, so it's the host element's
    // post-transform (e.g. carousel coverflow scale) on-screen box, while
    // _w/_h are its untransformed layout size that the grid is actually
    // laid out in (see the note on _resize). Scale the pointer offset by
    // the ratio between the two so it lands in the grid's own coordinate
    // space instead of drifting off as the element's scale moves away
    // from 1.
    _onPointerMove(e) {
      const rect = this.el.getBoundingClientRect();
      this._targetX = (e.clientX - rect.left) * (this._w / rect.width);
      this._targetY = (e.clientY - rect.top) * (this._h / rect.height);
      this._targetInfluence = 1;
      if (this._reduced) {
        this._pullX = this._targetX;
        this._pullY = this._targetY;
        this._influence = 1;
        this._render();
      }
    }

    _onPointerLeave() {
      this._targetInfluence = 0;
      if (this._reduced) {
        this._influence = 0;
        this._render();
      }
    }

    // Displaces a single grid vertex toward the (eased) pull point. Falloff
    // is a smoothstep over `radius`, and the pull magnitude is capped at a
    // fraction of the vertex's own distance to the pull point so a vertex
    // can never overshoot past it and fold the mesh over itself.
    _displace(restX, restY) {
      if (this._influence <= 0.001) return [restX, restY];
      const dx = this._pullX - restX;
      const dy = this._pullY - restY;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) return [restX, restY];
      const t = Math.max(0, 1 - dist / this.options.radius);
      if (t <= 0) return [restX, restY];
      const pull = this.options.strength * smoothstep(t) * this._influence;
      const mag = Math.min(pull, dist * 0.85);
      return [restX + (dx / dist) * mag, restY + (dy / dist) * mag];
    }

    _render() {
      const { ctx, _w: w, _h: h, _cols: cols, _rows: rows } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, w, h);

      const points = [];
      for (let row = 0; row <= rows; row++) {
        const line = [];
        for (let col = 0; col <= cols; col++) {
          line.push(this._displace(col * this._stepX, row * this._stepY));
        }
        points.push(line);
      }

      if (this.options.mode === 'dots') {
        ctx.fillStyle = `rgba(${this.options.lineColor}, ${this.options.lineOpacity})`;
        const r = this.options.dotRadius;
        for (let row = 0; row <= rows; row++) {
          for (let col = 0; col <= cols; col++) {
            const [x, y] = points[row][col];
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return;
      }

      ctx.strokeStyle = `rgba(${this.options.lineColor}, ${this.options.lineOpacity})`;
      ctx.lineWidth = 1;

      for (let row = 0; row <= rows; row++) {
        ctx.beginPath();
        points[row].forEach(([x, y], col) => {
          if (col === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      for (let col = 0; col <= cols; col++) {
        ctx.beginPath();
        for (let row = 0; row <= rows; row++) {
          const [x, y] = points[row][col];
          if (row === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    _tick() {
      this._pullX = lerp(this._pullX, this._targetX, this.options.ease);
      this._pullY = lerp(this._pullY, this._targetY, this.options.ease);
      this._influence = lerp(this._influence, this._targetInfluence, this.options.ease);
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    update(newOptions = {}) {
      const needsRebuild = 'cell' in newOptions && newOptions.cell !== this.options.cell;
      Object.assign(this.options, newOptions);
      if (needsRebuild) this._rebuild();
      if (this._reduced) this._render();
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._resizeObserver.disconnect();
      this.el.removeEventListener('pointermove', this._onPointerMove);
      this.el.removeEventListener('pointerleave', this._onPointerLeave);
      this.el.removeEventListener('pointercancel', this._onPointerLeave);
      this.canvas.remove();
    }
  }

  GravityWell.initAll = function (selector = '.bg-gravity-well', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__gravityWellInstance)
      .map((el) => {
        const instance = new GravityWell(el, options);
        el.__gravityWellInstance = instance;
        return instance;
      });
  };

  GravityWell.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__gravityWellInstance || null : null;
  };

  GravityWell.getAll = function (selector = '.bg-gravity-well') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__gravityWellInstance)
      .filter(Boolean);
  };

  global.GravityWell = GravityWell;

  function autoInit() {
    GravityWell.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
