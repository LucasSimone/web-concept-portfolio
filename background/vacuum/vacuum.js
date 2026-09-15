/**
 * Vacuum
 * ------
 * A canvas overlay that sheds colored dust off of whatever's inside the host
 * element — text, images, borders, plain color panels — whenever the cursor
 * gets close to them. Dust is pulled toward the live cursor position and
 * fades out as it's "sucked up". The real DOM content is never touched or
 * hidden; the canvas sits on top of it (pointer-events disabled) and only
 * ever draws the dust itself.
 *
 * Where a spawn point's color comes from depends on what it was sampled
 * from: computed `color` for text, computed `border*Color` for borders,
 * computed `background-color` for solid panels, and actual pixel data (read
 * via an offscreen canvas) for `<img>` elements — so a two-tone image sheds
 * dust matching whichever part of it the cursor is nearest to. Images from
 * another origin without CORS headers taint the canvas and can't be read;
 * those just won't shed dust.
 *
 * Usage: give any element `class="bg-vacuum"` — this file injects its own
 * CSS and auto-initializes every matching element on load.
 */
(function (global) {
  const STYLE_ID = 'vacuum-styles';
  const CSS = `
.bg-vacuum {
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

.vacuum__canvas {
  position: absolute;
  inset: 0;
  z-index: 5;
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
    radius: 110,
    density: 15,
    fillDensity: 22,
    imageStep: 8,
    maxParticles: 300,
    particleSize: 2.5,
    speed: 2.5,
    spawnChance: 0.5,
    cooldown: 160,
  };

  const FADE_ZONE = 26;
  const CONSUME_DIST = 4;
  const MAX_IMAGE_DIM = 220;
  const MUTATION_DEBOUNCE = 150;

  const BORDER_SIDES = [
    { prop: 'Top', edge: 'top' },
    { prop: 'Right', edge: 'right' },
    { prop: 'Bottom', edge: 'bottom' },
    { prop: 'Left', edge: 'left' },
  ];

  function parseColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((v) => parseFloat(v));
    const [r, g, b, a = 1] = parts;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b, a];
  }

  function pushPoint(points, x, y, color) {
    points.push({ x, y, color, lastSpawn: 0 });
  }

  function addEdgePoints(points, rect, edge, spacing, color) {
    const length = edge === 'top' || edge === 'bottom' ? rect.width : rect.height;
    const count = Math.max(1, Math.round(length / spacing));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      let x, y;
      if (edge === 'top') { x = rect.left + t * rect.width; y = rect.top; }
      else if (edge === 'bottom') { x = rect.left + t * rect.width; y = rect.top + rect.height; }
      else if (edge === 'left') { x = rect.left; y = rect.top + t * rect.height; }
      else { x = rect.left + rect.width; y = rect.top + t * rect.height; }
      pushPoint(points, x, y, color);
    }
  }

  function addLinePoints(points, rect, spacing, color) {
    const count = Math.max(1, Math.round(rect.width / spacing));
    const y = rect.top + rect.height / 2;
    for (let i = 0; i <= count; i++) {
      const x = rect.left + (i / count) * rect.width;
      pushPoint(points, x, y, color);
    }
  }

  function addFillPoints(points, rect, spacing, color) {
    const cols = Math.max(1, Math.round(rect.width / spacing));
    const rows = Math.max(1, Math.round(rect.height / spacing));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = rect.left + (c / cols) * rect.width;
        const y = rect.top + (r / rows) * rect.height;
        pushPoint(points, x, y, color);
      }
    }
  }

  // Reads the image into an offscreen canvas once per rebuild and samples
  // its actual pixels, so two corners of the same image can shed distinctly
  // different colors instead of one flat average.
  function addImagePoints(points, img, rect, step) {
    if (!img.complete || !img.naturalWidth) return;
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * scale));
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const octx = off.getContext('2d');
    let data;
    try {
      octx.drawImage(img, 0, 0, cw, ch);
      data = octx.getImageData(0, 0, cw, ch).data;
    } catch (err) {
      // Cross-origin image without CORS headers taints the canvas — its
      // pixels can't be read, so it just won't shed dust.
      return;
    }
    const cols = Math.max(1, Math.round(rect.width / step));
    const rows = Math.max(1, Math.round(rect.height / step));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const v = r / rows;
        const px = Math.min(cw - 1, Math.floor(u * cw));
        const py = Math.min(ch - 1, Math.floor(v * ch));
        const idx = (py * cw + px) * 4;
        const a = data[idx + 3];
        if (a < 20) continue;
        const color = [data[idx], data[idx + 1], data[idx + 2], a / 255];
        pushPoint(points, rect.left + u * rect.width, rect.top + v * rect.height, color);
      }
    }
  }

  class Vacuum {
    constructor(el, options = {}) {
      if (!el) throw new Error('Vacuum: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'vacuum__canvas';
      this.el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this._points = [];
      this._particles = [];
      this._targetX = 0;
      this._targetY = 0;
      this._active = false;
      this._lastTime = 0;
      this._raf = null;
      this._mutationTimer = null;

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      this._mutationObserver = new MutationObserver((mutations) => {
        // Ignore the canvas's own style changes from _resize() — anything
        // else in the subtree changing is real content to react to.
        const isOwnCanvas = (node) => node === this.canvas || this.canvas.contains(node);
        if (mutations.every((m) => isOwnCanvas(m.target))) return;
        clearTimeout(this._mutationTimer);
        this._mutationTimer = setTimeout(() => this._rebuildPoints(), MUTATION_DEBOUNCE);
      });
      this._mutationObserver.observe(this.el, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'src'],
      });

      this.el.addEventListener('pointermove', this._onPointerMove);
      this.el.addEventListener('pointerleave', this._onPointerLeave);
      this.el.addEventListener('pointercancel', this._onPointerLeave);

      this._resize();
      if (!this._reduced) {
        this._raf = requestAnimationFrame(this._tick);
      }
    }

    _resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._w = Math.max(1, this.el.clientWidth);
      this._h = Math.max(1, this.el.clientHeight);
      this.canvas.width = Math.round(this._w * dpr);
      this.canvas.height = Math.round(this._h * dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._rebuildPoints();
    }

    _watchImages() {
      const imgs = this.el.querySelectorAll('img');
      imgs.forEach((img) => {
        if (img.__vacuumWatched) return;
        img.__vacuumWatched = true;
        if (!img.complete || !img.naturalWidth) {
          img.addEventListener('load', () => this._rebuildPoints(), { once: true });
        }
      });
    }

    // Walks the whole subtree fresh each time: element borders/backgrounds,
    // <img> pixels, and text line boxes (via Range.getClientRects(), so
    // wrapped lines get one spawn strip per visual line rather than per
    // element). Rebuilt on resize, DOM mutation, and image load.
    _rebuildPoints() {
      this._watchImages();
      const points = [];
      const hostRect = this.el.getBoundingClientRect();
      if (hostRect.width < 1 || hostRect.height < 1) {
        this._points = points;
        return;
      }
      const scaleX = this._w / hostRect.width;
      const scaleY = this._h / hostRect.height;
      const toLocal = (rect) => ({
        left: (rect.left - hostRect.left) * scaleX,
        top: (rect.top - hostRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      });

      const { density, fillDensity, imageStep } = this.options;
      const elements = [this.el, ...this.el.querySelectorAll('*')];

      elements.forEach((el) => {
        if (el.tagName === 'CANVAS') return;
        const style = global.getComputedStyle(el);
        const rect = toLocal(el.getBoundingClientRect());
        if (rect.width < 1 || rect.height < 1) return;

        BORDER_SIDES.forEach(({ prop, edge }) => {
          const width = parseFloat(style[`border${prop}Width`]);
          if (!width || style[`border${prop}Style`] === 'none') return;
          const color = parseColor(style[`border${prop}Color`]);
          if (!color || color[3] <= 0) return;
          addEdgePoints(points, rect, edge, density, color);
        });

        const bg = parseColor(style.backgroundColor);
        if (bg && bg[3] > 0) {
          addFillPoints(points, rect, fillDensity, bg);
        }

        if (el.tagName === 'IMG') {
          addImagePoints(points, el, rect, imageStep);
        }
      });

      const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent || !node.textContent.trim()) continue;
        const parent = node.parentElement;
        if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;
        const color = parseColor(global.getComputedStyle(parent).color);
        if (!color) continue;
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          addLinePoints(points, toLocal(rects[i]), density, color);
        }
      }

      this._points = points;
    }

    _onPointerMove(e) {
      const rect = this.el.getBoundingClientRect();
      this._targetX = (e.clientX - rect.left) * (this._w / rect.width);
      this._targetY = (e.clientY - rect.top) * (this._h / rect.height);
      this._active = true;
    }

    // Stops shedding new dust, but particles already in flight keep
    // travelling toward the last known cursor spot and fade out there
    // rather than freezing in place.
    _onPointerLeave() {
      this._active = false;
    }

    _spawn() {
      const { radius, spawnChance, cooldown, maxParticles } = this.options;
      if (this._particles.length >= maxParticles) return;
      const now = performance.now();
      const mx = this._targetX;
      const my = this._targetY;
      for (let i = 0; i < this._points.length; i++) {
        if (this._particles.length >= maxParticles) break;
        const p = this._points[i];
        const dx = mx - p.x;
        const dy = my - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        if (now - p.lastSpawn < cooldown) continue;
        const chance = spawnChance * (1 - dist / radius);
        if (Math.random() > chance) continue;
        p.lastSpawn = now;
        this._particles.push({ x: p.x, y: p.y, color: p.color, alpha: 1 });
      }
    }

    _update(dtScale) {
      const { speed, radius } = this.options;
      const mx = this._targetX;
      const my = this._targetY;
      for (let i = this._particles.length - 1; i >= 0; i--) {
        const particle = this._particles[i];
        const dx = mx - particle.x;
        const dy = my - particle.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= CONSUME_DIST) {
          this._particles.splice(i, 1);
          continue;
        }
        const pull = speed * (1 + (1 - Math.min(1, dist / radius)) * 2.2);
        particle.x += (dx / dist) * pull * dtScale;
        particle.y += (dy / dist) * pull * dtScale;
        particle.alpha = Math.min(1, dist / FADE_ZONE);
      }
    }

    _render() {
      const { ctx, _w: w, _h: h } = this;
      ctx.clearRect(0, 0, w, h);
      const size = this.options.particleSize;
      for (let i = 0; i < this._particles.length; i++) {
        const particle = this._particles[i];
        const r = (size / 2) * (0.4 + 0.6 * particle.alpha);
        const [cr, cg, cb] = particle.color;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${particle.alpha})`;
        ctx.arc(particle.x, particle.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _tick(timestamp) {
      if (!this._lastTime) this._lastTime = timestamp;
      const dtScale = Math.min(48, timestamp - this._lastTime) / 16.67;
      this._lastTime = timestamp;

      if (this._active) this._spawn();
      this._update(dtScale);
      this._render();

      this._raf = requestAnimationFrame(this._tick);
    }

    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      clearTimeout(this._mutationTimer);
      this._resizeObserver.disconnect();
      this._mutationObserver.disconnect();
      this.el.removeEventListener('pointermove', this._onPointerMove);
      this.el.removeEventListener('pointerleave', this._onPointerLeave);
      this.el.removeEventListener('pointercancel', this._onPointerLeave);
      this.canvas.remove();
    }
  }

  Vacuum.initAll = function (selector = '.bg-vacuum', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__vacuumInstance)
      .map((el) => {
        const instance = new Vacuum(el, options);
        el.__vacuumInstance = instance;
        return instance;
      });
  };

  Vacuum.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__vacuumInstance || null : null;
  };

  Vacuum.getAll = function (selector = '.bg-vacuum') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__vacuumInstance)
      .filter(Boolean);
  };

  global.Vacuum = Vacuum;

  function autoInit() {
    Vacuum.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
