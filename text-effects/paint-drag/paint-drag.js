/**
 * PaintDrag
 * ---------
 * The real DOM text scrolls normally with the page. A single canvas is
 * pinned to the viewport (position: fixed, full screen) and never moves.
 * Every frame we stamp the text at its *current screen position* onto that
 * fixed canvas, then let old stamps fade out — so as the text scrolls past,
 * it leaves a paint-like mark behind on the screen itself, the way a brush
 * dragged across a canvas would, rather than a trail that travels with it.
 *
 * Usage: give any element `class="paint-drag"` with the text as its
 * content. This file injects its own CSS and auto-initializes every
 * matching element on load.
 */
(function (global) {
  const STYLE_ID = 'paint-drag-styles';
  const CSS = `
.paint-drag {
  display: inline-block;
  max-width: 100%;
  line-height: 1.1;
  white-space: pre-wrap;
  user-select: none;
  color: var(--fg, #000);
  position: relative;
  /* Sits one above the overlay's own max z-index below, so the live text
     always stays crisp on top of its own trail (see the overlay rule). */
  z-index: 2147483647;
  text-shadow:
    0 0 6px rgba(255, 255, 255, 0.85),
    0 0 2px rgba(255, 255, 255, 0.9);
}

.paint-drag__overlay {
  position: fixed;
  inset: 0;
  /* Near-max z-index: this overlay must win against arbitrary host-page
     content wherever it's dropped in, including elements with their own
     aggressively high z-index (e.g. this repo's own home page carousel,
     whose absolutely-positioned cards reach into the 900s for their own
     wheel-layering) - a drop-in effect can't assume it knows every
     z-index scheme on every page that might use it. One below max so the
     .paint-drag text rule above can still out-rank it. */
  z-index: 2147483646;
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
    smearLength: 140,   // how far apart stamps are placed along the drag path
    spread: 18,         // perpendicular jitter/scatter of each brush stamp
    fadeTime: 0.6,       // seconds for a stamp to fully fade (cleanup time)
    density: 10,         // max interpolated stamps drawn per frame at full speed
    blur: 6,             // canvas shadow blur applied to each stamp (bristle softness)
    skew: true,          // slant stamps along the drag direction
    color: null,         // explicit trail color, defaults to the element's computed color
  };

  const MAX_DT = 1 / 20; // clamp huge dt spikes (tab throttling, etc.)
  const CAP_SPEED = 2200; // px/sec considered "fast" for stamp scaling

  // One shared, viewport-fixed canvas is enough for every PaintDrag instance
  // on the page — they all paint onto the same screen-space surface. Track
  // the most recent paint across all instances so the idle-clear logic below
  // never wipes one instance's active trail just because another went quiet.
  let sharedCanvas = null;
  let sharedCtx = null;
  let lastAnyPaintTime = performance.now();
  let cleared = true;
  let lastFadeTime = performance.now();
  let decayDebt = 0; // fractional alpha decay carried across frames (see _fade)

  function getSharedCanvas() {
    if (sharedCanvas) return sharedCanvas;

    const canvas = document.createElement('canvas');
    canvas.className = 'paint-drag__overlay';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const resize = () => {
      const dpr = global.devicePixelRatio || 1;
      canvas.width = global.innerWidth * dpr;
      canvas.height = global.innerHeight * dpr;
      canvas.style.width = `${global.innerWidth}px`;
      canvas.style.height = `${global.innerHeight}px`;
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    global.addEventListener('resize', resize);

    sharedCanvas = canvas;
    sharedCtx = canvas.getContext('2d');
    return sharedCanvas;
  }

  class PaintDrag {
    constructor(el, options = {}) {
      if (!el) throw new Error('PaintDrag: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };

      getSharedCanvas();
      this.canvas = sharedCanvas;
      this.ctx = sharedCtx;

      this._lastTime = performance.now();
      this._lastCenter = this._getCenter();
      this._velocity = { x: 0, y: 0 };

      this._prepEl();

      this._tick = this._tick.bind(this);
      this._raf = requestAnimationFrame(this._tick);
    }

    _prepEl() {
      const el = this.el;
      el.classList.add('paint-drag');
      const style = getComputedStyle(el);
      if (style.position === 'static') el.style.position = 'relative';
      if (style.zIndex === 'auto') el.style.zIndex = '2';
      if (!el.dataset.text) el.dataset.text = el.textContent.trim();
    }

    _getCenter() {
      const rect = this.el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    // Ratio of the element's actual rendered box to its unscaled layout box
    // — 1 normally, but < 1 when a CSS transform (e.g. the home page
    // carousel shrinking off-focus cards) scales the element down. Without
    // this, the canvas stamp is drawn at the element's raw font-size and
    // ends up larger than the text actually is on screen.
    _getScale() {
      const width = this.el.offsetWidth;
      if (!width) return 1;
      return this.el.getBoundingClientRect().width / width;
    }

    _tick() {
      const now = performance.now();
      // Real elapsed time is used for fading, so a throttled/backgrounded
      // tab still catches up fully instead of the trail getting "stuck".
      const rawDt = (now - this._lastTime) / 1000 || 0;
      const dt = Math.min(MAX_DT, rawDt);
      this._lastTime = now;

      const center = this._getCenter();
      const dx = center.x - this._lastCenter.x;
      const dy = center.y - this._lastCenter.y;

      const instantVx = dt > 0 ? dx / dt : 0;
      const instantVy = dt > 0 ? dy / dt : 0;
      this._velocity.x += (instantVx - this._velocity.x) * 0.35;
      this._velocity.y += (instantVy - this._velocity.y) * 0.35;

      const speed = Math.hypot(this._velocity.x, this._velocity.y);
      if (speed >= 4) lastAnyPaintTime = now;

      this._fade(now);
      this._paint(this._lastCenter, center);

      this._lastCenter = center;
      this._raf = requestAnimationFrame(this._tick);
    }

    _fade(now) {
      const { ctx, canvas } = this;
      const fadeTime = Math.max(0.05, this.options.fadeTime);

      // Canvas's built-in destination-out compositing multiplies existing
      // alpha every frame — an exponential decay that fades fast at first,
      // then hangs at a faint, ever-shrinking residue forever without ever
      // truly reaching zero. That produced a visible light-grey mark that
      // had to be popped away with a hard clear once "done enough".
      //
      // Instead we subtract a constant amount from each pixel's alpha every
      // frame — a real linear fade — so the whole trail reaches exact zero
      // together at precisely `fadeTime` seconds, with no residue and no
      // pop at the end.
      const idleTime = (now - lastAnyPaintTime) / 1000;
      if (idleTime >= fadeTime) {
        if (!cleared) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          cleared = true;
        }
        decayDebt = 0;
        return;
      }
      cleared = false;

      // Multiple PaintDrag instances share this one canvas, so only decay it
      // once per real animation frame (guard against a second instance's
      // _tick firing an instant later and decaying it twice as fast).
      const realDt = (now - lastFadeTime) / 1000;
      if (realDt <= 0) return;
      lastFadeTime = now;

      // Math.round() on a tiny per-frame amount (e.g. a 3s fade at 60fps is
      // only ~1.4 alpha/frame) truncates to a whole number every frame,
      // silently losing the fractional remainder. Over hundreds of frames
      // that adds up to real seconds of drift, so the decay falls behind
      // wall-clock time — exactly what caused the "pop" once `idleTime`
      // caught up and the hard clear above fired while alpha was still
      // stuck partway down. Carrying the fractional remainder in `decayDebt`
      // keeps the applied decay in lockstep with real elapsed time.
      decayDebt += (realDt / fadeTime) * 255;
      const decay = Math.floor(decayDebt);
      if (decay <= 0) return;
      decayDebt -= decay;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i];
        if (a > 0) data[i] = a > decay ? a - decay : 0;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    _paint(from, rawTo) {
      const speed = Math.hypot(this._velocity.x, this._velocity.y);
      if (speed < 4) return;

      const { ctx } = this;
      const { spread, density, blur, skew, smearLength, color } = this.options;
      const speedFactor = Math.min(1, speed / CAP_SPEED);

      // Stretch the stroke beyond the text's actual on-screen movement so the
      // smear reads as an exaggerated drag rather than a literal 1:1 trail.
      const dirX = this._velocity.x / (speed || 1);
      const dirY = this._velocity.y / (speed || 1);
      const reach = smearLength * speedFactor;
      const to = { x: rawTo.x + dirX * reach, y: rawTo.y + dirY * reach };

      const stamps = Math.max(1, Math.round(1 + density * speedFactor));
      const trailColor = color || getComputedStyle(this.el).color || '#000';
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const style = getComputedStyle(this.el);
      const fontSize = parseFloat(style.fontSize) * this._getScale();
      const font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
      const text = this.el.dataset.text;

      ctx.save();
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = trailColor;
      ctx.shadowBlur = blur;
      ctx.fillStyle = trailColor;

      // Interpolate stamps along the path the text actually traveled this
      // frame so fast scrolls leave a continuous stroke, not gaps.
      for (let i = 0; i < stamps; i += 1) {
        const t = (i + 1) / stamps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        const jitterX = (Math.random() - 0.5) * spread;
        const jitterY = (Math.random() - 0.5) * spread;
        const stampAlpha = Math.min(1, 0.35 + speedFactor);

        ctx.save();
        ctx.globalAlpha = stampAlpha;
        ctx.translate(x + jitterX, y + jitterY);
        if (skew) {
          ctx.rotate(angle * 0.15 * speedFactor);
        }
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    }

    update(options = {}) {
      Object.assign(this.options, options);
    }

    setText(value) {
      const text = value || '';
      this.el.dataset.text = text;
      this.el.textContent = text;
    }

    clear() {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
    }
  }

  PaintDrag.initAll = function (selector = '.paint-drag', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__paintDragInstance)
      .map((el) => {
        const instance = new PaintDrag(el, options);
        el.__paintDragInstance = instance;
        return instance;
      });
  };

  PaintDrag.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__paintDragInstance || null : null;
  };

  PaintDrag.getAll = function (selector = '.paint-drag') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__paintDragInstance)
      .filter(Boolean);
  };

  global.PaintDrag = PaintDrag;

  function autoInit() {
    PaintDrag.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
