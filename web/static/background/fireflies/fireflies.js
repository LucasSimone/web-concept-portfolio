/**
 * Fireflies
 * ---------
 * A canvas background of soft glowing points that wander an open field:
 * each one drifts on its own slowly-turning heading and blinks
 * independently — long dark stretches punctuated by a brief rise and fall
 * in brightness, each blink's own length randomized between `visibleMin`
 * and `visibleMax` — so the field never reads as a single synchronized pulse,
 * just scattered, overlapping activity. A firefly that drifts off one edge
 * re-enters from the opposite side rather than bouncing, so the field feels
 * unbounded instead of contained in a box. Each firefly also carries its own
 * small hue/size jitter around the base `glowColor`, and occasionally stutters
 * into a quick double-flash instead of a single rise-and-fall, so the swarm
 * reads as a population of individuals rather than one shape repeated.
 * Defaults to a warm yellow-green closer to real bioluminescence; the color
 * picker can still flatten it to solid black or anything else.
 *
 * Usage: give any element `class="bg-fireflies"` — this file injects its
 * own CSS and auto-initializes every matching element on load, so dropping
 * the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'fireflies-styles';
  const CSS = `
.bg-fireflies {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.fireflies__canvas {
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
    count: 100,
    speed: 25,
    wander: 1.4,
    blinkMin: 1.2,
    blinkMax: 4,
    visibleMin: 0.4,
    visibleMax: 1.1,
    glowSize: 9,
    background: '#ffffff',
    glowColor: '154, 205, 50',
  };

  // Chance a given blink stutters into a quick double-flash instead of a
  // single rise-and-fall, and how much longer that takes.
  const DOUBLE_FLASH_CHANCE = 0.16;
  const DOUBLE_FLASH_STRETCH = 1.9;

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  // Single rise-then-fall hump over t in [0, 1].
  function humpEnvelope(t) {
    return t <= 0.5 ? smoothstep(t * 2) : smoothstep((1 - t) * 2);
  }

  function parseRgbString(str) {
    return str.split(',').map((n) => parseInt(n, 10));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hn = h / 360;
    return [
      Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, hn) * 255),
      Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
    ];
  }

  class Fireflies {
    constructor(el, options = {}) {
      if (!el) throw new Error('Fireflies: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._baseHsl = rgbToHsl(...parseRgbString(this.options.glowColor));
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fireflies__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      this._flies = [];
      this._raf = null;
      this._elapsed = 0;
      this._lastNow = performance.now();

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      this._resize();
      if (this._reduced) {
        this._render();
      } else {
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
      if (!this._flies.length) {
        this._spawn(Math.round(this.options.count));
      } else {
        // Clamp existing flies into the new bounds rather than rebuilding
        // the whole population, so a resize doesn't reset every blink cycle
        // already in flight.
        this._flies.forEach((f) => {
          f.x = Math.min(f.x, this._w);
          f.y = Math.min(f.y, this._h);
        });
      }
      if (this._reduced) this._render();
    }

    _spawn(count) {
      for (let i = 0; i < count; i++) {
        this._flies.push({
          x: Math.random() * this._w,
          y: Math.random() * this._h,
          angle: Math.random() * Math.PI * 2,
          speedMul: 0.6 + Math.random() * 0.8,
          sizeMul: 0.7 + Math.random() * 0.6,
          // Fixed per-firefly offset from the base glowColor, so the swarm
          // reads as individuals rather than one color repeated.
          hueJitter: randomBetween(-16, 16),
          satJitter: randomBetween(-0.08, 0.08),
          lightJitter: randomBetween(-0.06, 0.06),
          phase: 'dark',
          blinkStart: 0,
          blinkDuration: this.options.visibleMin,
          doubleFlash: false,
          // Staggered from the start so the initial population doesn't
          // all light up in the same first few seconds.
          nextBlinkAt: randomBetween(0, this.options.blinkMax),
        });
      }
    }

    _setCount(count) {
      const current = this._flies.length;
      if (count > current) this._spawn(count - current);
      else if (count < current) this._flies.length = count;
    }

    _advance(dt) {
      const { wander, speed, blinkMin, blinkMax, visibleMin, visibleMax } = this.options;
      const w = this._w;
      const h = this._h;
      this._flies.forEach((f) => {
        f.angle += (Math.random() * 2 - 1) * wander * dt;
        f.x += Math.cos(f.angle) * speed * f.speedMul * dt;
        f.y += Math.sin(f.angle) * speed * f.speedMul * dt;

        // Wrap around edges rather than bouncing, so the field reads as an
        // unbounded night sky instead of a box fireflies are trapped in.
        if (f.x < 0) f.x += w;
        else if (f.x > w) f.x -= w;
        if (f.y < 0) f.y += h;
        else if (f.y > h) f.y -= h;

        if (f.phase === 'dark') {
          if (this._elapsed >= f.nextBlinkAt) {
            f.phase = 'blink';
            f.blinkStart = this._elapsed;
            const baseDuration = randomBetween(visibleMin, visibleMax);
            f.doubleFlash = Math.random() < DOUBLE_FLASH_CHANCE;
            f.blinkDuration = f.doubleFlash ? baseDuration * DOUBLE_FLASH_STRETCH : baseDuration;
          }
        } else {
          const t = (this._elapsed - f.blinkStart) / f.blinkDuration;
          if (t >= 1) {
            f.phase = 'dark';
            f.nextBlinkAt = this._elapsed + randomBetween(blinkMin, blinkMax);
          }
        }
      });
    }

    // Brightness envelope over a blink's lifetime — 0 while dark, 0 again
    // once the blink completes. Most blinks are a single rise-then-fall
    // hump; a fraction stutter into two smaller humps with a dark gap
    // between, like a real firefly's occasional double-flash.
    _brightness(f) {
      if (f.phase !== 'blink') return 0;
      const t = (this._elapsed - f.blinkStart) / f.blinkDuration;
      if (!f.doubleFlash) return humpEnvelope(t);
      if (t <= 0.42) return humpEnvelope(t / 0.42);
      if (t <= 0.58) return 0;
      return humpEnvelope((t - 0.58) / 0.42) * 0.75;
    }

    _drawFirefly(x, y, b, f) {
      if (b <= 0.02) return;
      const { ctx } = this;
      const [baseH, baseS, baseL] = this._baseHsl;
      let rgb = this.options.glowColor;
      if (baseS > 0.05) {
        const h = (baseH + f.hueJitter + 360) % 360;
        const s = clamp01(baseS + f.satJitter);
        const l = clamp01(baseL + f.lightJitter);
        rgb = hslToRgb(h, s, l).join(', ');
      }
      // Radius pulses a little with brightness, so a blink reads as a
      // twinkle rather than a fixed-size dot fading in and out.
      const r = this.options.glowSize * f.sizeMul * (0.75 + 0.25 * b);

      const halo = ctx.createRadialGradient(x, y, 0, x, y, r);
      halo.addColorStop(0, `rgba(${rgb}, ${(0.55 * b).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(${rgb}, ${b.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    _render() {
      const { ctx, _w: w, _h: h } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.options.background;
      ctx.fillRect(0, 0, w, h);

      const brightnessFn = this._reduced
        // Reduced motion: skip the animation loop but still show a static,
        // mid-blink field instead of a completely dark canvas.
        ? () => 0.6
        : (f) => this._brightness(f);

      this._flies.forEach((f) => {
        this._drawFirefly(f.x, f.y, brightnessFn(f), f);
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

    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
      if ('count' in newOptions) this._setCount(Math.round(this.options.count));
      if ('glowColor' in newOptions) this._baseHsl = rgbToHsl(...parseRgbString(this.options.glowColor));
      if (this._reduced) this._render();
    }

    destroy() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._resizeObserver.disconnect();
      this.canvas.remove();
    }
  }

  Fireflies.initAll = function (selector = '.bg-fireflies', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__firefliesInstance)
      .map((el) => {
        const instance = new Fireflies(el, options);
        el.__firefliesInstance = instance;
        return instance;
      });
  };

  Fireflies.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__firefliesInstance || null : null;
  };

  Fireflies.getAll = function (selector = '.bg-fireflies') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__firefliesInstance)
      .filter(Boolean);
  };

  global.Fireflies = Fireflies;

  function autoInit() {
    Fireflies.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
