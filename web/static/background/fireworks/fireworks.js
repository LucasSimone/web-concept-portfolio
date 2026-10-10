/**
 * Fireworks
 * ---------
 * A canvas background of fireworks. Rockets go up from
 * the bottom edge at random places and times, wobbling slightly and
 * leaving a faint trail of sparks, slow under gravity, and burst near the
 * top of their arc. A burst throws particles outward that slow with drag,
 * fall under gravity, shrink and fade, and leave short trails. A few of
 * them twinkle as they go out, and a few crackle into a pop of tiny
 * sparks. Clicking the element sends a rocket up to burst at the cursor.
 *
 * The sky defaults to white, like the rest of the site, and `background`
 * takes any color. A dark sky switches the drawing to additive light, so
 * overlapping bursts glow brighter where they cross, hot particles run
 * whiter rather than darker, and the host's text turns white.
 *
 * What a burst looks like is open: `patterns` takes built-in names
 * ('peony', 'ring', 'willow', 'crossette', 'palm') or your own pattern, a
 * function returning each particle's starting velocity. `colors` takes
 * any list of CSS colors. By default each burst is one of those colors;
 * with `blend` on, the list is read as a gradient and each burst lands
 * anywhere along it. Either way about a quarter of bursts are two-tone,
 * split down the middle, when there's more than one color to pick from.
 *
 * Usage: give any element `class="bg-fireworks"` — this file injects its
 * own CSS and auto-initializes every matching element on load, so
 * dropping the `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'fireworks-styles';
  const CSS = `
.bg-fireworks {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

/* Added by the script while the sky is a dark color. */
.bg-fireworks.bg-fireworks--dark {
  color: #fff;
}

.fireworks__canvas {
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
    launchRate: 1,
    burstSize: 90,
    burstRadius: 130,
    gravity: 80,
    trailLength: 0.3,
    particleSize: 2,
    background: '#ffffff',
    colors: ['#e63946', '#f3722c', '#e9a800', '#2a9d8f', '#3a6ff7', '#9b3fd4'],
    blend: false,
    patterns: ['peony', 'peony', 'ring', 'willow', 'crossette', 'palm'],
    clickToLaunch: true,
  };

  // How quickly a burst particle's speed dies away, per second: its speed
  // is multiplied by e^-DRAG each second, so a particle launched at v
  // coasts v / DRAG px in all before stopping (ignoring gravity). Burst
  // speed is set from that, so `burstRadius` is how far a peony's fastest
  // particles would get with gravity off.
  const DRAG = 1.6;

  // Hard ceiling on live particles of every kind. A burst only gets the
  // room that's left, and the extras (rocket sparks, willow embers) stop
  // first, so a high launch rate thins out instead of piling up.
  const MAX_PARTICLES = 2500;
  const EXTRAS_LIMIT = MAX_PARTICLES * 0.7;

  // Share of burst particles that twinkle or crackle as they fade.
  const TWINKLE_SHARE = 0.12;
  const CRACKLE_SHARE = 0.08;
  // Share of bursts that come out two colors, when there are two to pick.
  const TWO_TONE_SHARE = 0.25;

  // The smallest share of the trails erased in one go; see _render.
  const MIN_FADE = 0.12;

  const EMBER_INTERVAL = 0.08;
  const SPARK_INTERVAL = 0.03;

  // How the show is drawn, picked by how light the sky is. Over a dark sky
  // it's light: colors add together where they overlap (lighter), hot
  // particles run toward white, and the rocket and its sparks are a warm
  // glow. Over a light sky that would add up to white and vanish, so
  // colors are laid over each other as paint instead (source-over), hot
  // particles run toward black, and the rocket is a dark streak.
  const THEMES = {
    dark: {
      composite: 'lighter',
      tintTo: [255, 255, 255],
      rocket: 'rgb(255, 226, 176)',
      spark: 'rgb(255, 207, 138)',
      crackle: 'rgb(255, 250, 235)',
      flash: 0.35,
    },
    light: {
      composite: 'source-over',
      tintTo: [0, 0, 0],
      rocket: 'rgb(70, 70, 80)',
      spark: 'rgb(214, 140, 50)',
      crackle: 'rgb(40, 40, 48)',
      flash: 0.2,
    },
  };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // Evenly spread points on a sphere (a Fibonacci spiral), seen from the
  // front, with a little jitter so two peonies never match. Flattening a
  // sphere crowds its points toward the middle, which is what makes a
  // burst read as a ball rather than a flat disc.
  function sphere(count) {
    const out = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const z = 1 - (2 * (i + 0.5)) / count;
      const r = Math.sqrt(1 - z * z);
      const a = i * golden + turn;
      const speed = randomBetween(0.9, 1);
      out.push([Math.cos(a) * r * speed, Math.sin(a) * r * speed]);
    }
    return out;
  }

  // Built-in patterns. `velocities(count)` returns each particle's starting
  // velocity as [x, y], where a length of 1 is full burst speed. The other
  // fields scale that pattern's particles against the base values: how
  // long they live, how hard drag slows them, how much gravity pulls them,
  // how thick they're drawn. `embers` leaves a fading spark behind each
  // particle as it goes, and `split` breaks each one into that many once,
  // a third of the way through its life.
  const PATTERNS = {
    peony: { velocities: sphere },
    ring: {
      // A circle in a random tilted plane, which seen from the front is an
      // ellipse at a random angle.
      velocities(count) {
        const squash = randomBetween(0.3, 1);
        const tilt = Math.random() * Math.PI;
        const cos = Math.cos(tilt);
        const sin = Math.sin(tilt);
        const out = [];
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const x = Math.cos(a);
          const y = Math.sin(a) * squash;
          out.push([x * cos - y * sin, x * sin + y * cos]);
        }
        return out;
      },
    },
    willow: {
      velocities: (count) => sphere(count).map(([x, y]) => [x * 0.8, y * 0.8]),
      life: 2.2,
      drag: 1.5,
      gravity: 0.7,
      size: 0.8,
      embers: true,
    },
    crossette: {
      // Few particles, since each one becomes four.
      velocities: (count) => sphere(Math.max(6, Math.round(count / 6))).map(([x, y]) => [x * 0.8, y * 0.8]),
      size: 1.3,
      split: 4,
    },
    palm: {
      // A handful of thick arms, each a run of particles along one
      // direction at different speeds, so it reads as a streak rather
      // than a dot.
      velocities(count) {
        const arms = Math.round(randomBetween(5, 8));
        const perArm = Math.max(3, Math.round((count * 0.5) / arms));
        const turn = Math.random() * Math.PI * 2;
        const out = [];
        for (let i = 0; i < arms; i++) {
          const a = turn + (i / arms) * Math.PI * 2;
          for (let j = 0; j < perArm; j++) {
            const spread = a + randomBetween(-0.05, 0.05);
            const speed = 0.55 * (0.45 + (0.55 * j) / perArm);
            out.push([Math.cos(spread) * speed, Math.sin(spread) * speed]);
          }
        }
        return out;
      },
      life: 1.3,
      drag: 0.6,
      gravity: 1.3,
      size: 1.6,
    },
  };

  const PATTERN_DEFAULTS = {
    life: 1, drag: 1, gravity: 1, size: 1, embers: false, split: 0,
  };

  // Accepts a built-in name, a velocities function, or a pattern object
  // with the same fields as a built-in. An unknown name, or an object with
  // no velocities function, falls back to peony's shape rather than
  // throwing mid-frame.
  function resolvePatterns(list) {
    return (list.length ? list : DEFAULTS.patterns).map((pattern) => {
      if (typeof pattern === 'function') return { ...PATTERN_DEFAULTS, velocities: pattern };
      if (typeof pattern === 'object' && pattern) {
        const resolved = { ...PATTERN_DEFAULTS, ...pattern };
        if (typeof resolved.velocities !== 'function') resolved.velocities = sphere;
        return resolved;
      }
      return { ...PATTERN_DEFAULTS, ...(PATTERNS[pattern] || PATTERNS.peony) };
    });
  }

  // A custom pattern runs inside the animation loop, where a throw would
  // stop the loop for good, so one that throws or returns something
  // unusable just bursts as nothing.
  function burstVelocities(pattern, count) {
    let out;
    try {
      out = pattern.velocities(count);
    } catch (err) {
      console.error('Fireworks: burst pattern threw', err);
      return [];
    }
    if (!Array.isArray(out)) return [];
    return out.filter((v) => v && Number.isFinite(v[0]) && Number.isFinite(v[1]));
  }

  // Any CSS color the canvas understands, as [r, g, b]: painted onto a
  // 1x1 scratch canvas and read back as a pixel. Reading fillStyle back
  // as a string isn't enough, since a browser hands wide-gamut colors
  // (oklch(), color(display-p3 ...)) back in their own syntax. Any
  // transparency in the color is dropped; particles are drawn at their
  // own fade. A string the browser rejects leaves the
  // fill as it was, so it comes back black.
  let scratch = null;
  function parseRgba(color) {
    if (!scratch) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      scratch = canvas.getContext('2d', { willReadFrequently: true });
    }
    scratch.fillStyle = '#000000';
    scratch.fillStyle = color;
    scratch.globalCompositeOperation = 'copy';
    scratch.fillRect(0, 0, 1, 1);
    scratch.globalCompositeOperation = 'source-over';
    // ImageData comes back un-premultiplied, so a half-transparent color
    // still reads as its full color here.
    return Array.from(scratch.getImageData(0, 0, 1, 1).data);
  }

  function parseColor(color) {
    return parseRgba(color).slice(0, 3);
  }

  // A parsed [r, g, b, a] laid over an opaque [r, g, b] backdrop, as the
  // eye would see it.
  function over([r, g, b, a], backdrop) {
    const k = a / 255;
    return [r, g, b].map((c, i) => c * k + backdrop[i] * (1 - k));
  }

  // Whether an opaque [r, g, b] reads as light: its relative luminance,
  // roughly, past the midpoint.
  function isLight([r, g, b]) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
  }

  function resolveColors(list) {
    return (list.length ? list : DEFAULTS.colors).map(parseColor);
  }

  function mix(a, b, t) {
    return a.map((c, i) => Math.round(c + (b[i] - c) * t));
  }

  function sampleGradient(stops, t) {
    if (stops.length === 1) return stops[0];
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    return mix(stops[i], stops[i + 1], seg - i);
  }

  function rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  // A color plus two hotter versions of it (whiter on a dark sky, darker
  // on a light one). Each particle takes one of the three, so a burst
  // glitters a little instead of being one flat color, without a fresh
  // color string per particle.
  function tints(rgb, theme) {
    return [0, 0.2, 0.4].map((k) => rgbCss(mix(rgb, theme.tintTo, k)));
  }

  class Fireworks {
    constructor(el, options = {}) {
      if (!el) throw new Error('Fireworks: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._patterns = resolvePatterns(this.options.patterns);
      this._stops = resolveColors(this.options.colors);
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fireworks__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');
      this._applyBackground();

      this._rockets = [];
      this._particles = [];
      this._flashes = [];
      this._raf = null;
      this._lastNow = performance.now();
      this._nextLaunchIn = this._launchGap();
      // Whether anything has been drawn since the canvas was last cleared
      // outright; see _render.
      this._dirty = false;
      // Time since the trails were last faded; see _render.
      this._fadeDue = 0;

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onClick = this._onClick.bind(this);

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

      // A click rather than a pointerdown, so a drag (a carousel swipe that
      // starts on the element, a touch scroll, selecting text) doesn't set
      // one off, and anything that cancels a click cancels the launch too.
      this.el.addEventListener('click', this._onClick);

      this._resize();
      if (!this._reduced) this._start();
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

    // The sky is the canvas element's own CSS background, not something
    // painted into it: the trails fade by erasing toward transparent every
    // frame (see _render), which then works the same whether there's a
    // sky color behind them or the host's own background.
    //
    // It also picks the theme, from the sky as it actually looks: a
    // see-through sky color is laid over the host's own background (and
    // that over a white page) before it's measured. A sky that isn't a
    // plain color - 'transparent', 'none', a gradient or an image - can't
    // be measured, so the host's background color alone decides. That's
    // read once, here: a host that changes its own background later should
    // call update({ background }) again. Only a sky color this script
    // paints turns the host's text white; otherwise the host's own styles
    // are in charge of it.
    _applyBackground() {
      const { background } = this.options;
      const paints = Boolean(background) && background !== 'transparent';
      const isColor = paints && global.CSS.supports('color', background);
      this.canvas.style.background = paints ? background : '';
      const host = over(parseRgba(getComputedStyle(this.el).backgroundColor), [255, 255, 255]);
      const sky = isColor ? over(parseRgba(background), host) : host;
      this._theme = isLight(sky) ? THEMES.light : THEMES.dark;
      this.el.classList.toggle('bg-fireworks--dark', isColor && this._theme === THEMES.dark);
    }

    // clientWidth/clientHeight rather than getBoundingClientRect, for the
    // same reason as Fireflies: the host may sit under a CSS transform the
    // canvas already inherits, and the bounding rect would apply it twice.
    //
    // A host with no size at all is hidden (display: none, or the homepage
    // filter's `hidden`), not resized: that's skipped outright, so the
    // show picks up where it left off when it's shown again. Otherwise
    // everything in flight keeps its place proportionally.
    _resize() {
      const width = this.el.clientWidth;
      const height = this.el.clientHeight;
      if (!width || !height) return;
      // Setting a canvas's size wipes it, even to the size it already has,
      // and the observer reports once on observe and again on each
      // unhide, so a callback with nothing changed would cut every trail.
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (width === this._w && height === this._h && dpr === this._dpr) return;
      const oldW = this._w;
      const oldH = this._h;
      this._dpr = dpr;
      this._w = width;
      this._h = height;
      this.canvas.width = Math.round(this._w * this._dpr);
      this.canvas.height = Math.round(this._h * this._dpr);
      this.canvas.style.width = `${this._w}px`;
      this.canvas.style.height = `${this._h}px`;
      if (oldW) {
        const sx = this._w / oldW;
        const sy = this._h / oldH;
        const scale = (item) => {
          item.x *= sx;
          item.y *= sy;
          item.px *= sx;
          item.py *= sy;
        };
        // A rocket's climb is scaled along with it, so it still stops (and
        // bursts) at the same proportional height, in the same time.
        this._rockets.forEach((r) => {
          scale(r);
          r.fromX *= sx;
          r.fromY *= sy;
          r.vx *= sx;
          r.vy *= sy;
          r.decel *= sy;
        });
        this._particles.forEach(scale);
        this._flashes.forEach((f) => {
          f.x *= sx;
          f.y *= sy;
        });
      }
      // Resizing a canvas wipes it, so there's nothing left to fade.
      this._dirty = false;
      if (this._reduced) this._drawStill();
    }

    // Exponentially distributed, so launches come at random rather than on
    // a beat, and average out to `launchRate` per second.
    _launchGap() {
      const rate = this.options.launchRate;
      if (!(rate > 0)) return Infinity;
      return -Math.log(1 - Math.random()) / rate;
    }

    _onClick(event) {
      if (!this.options.clickToLaunch || event.button !== 0) return;
      // Leave clicks on the host's own controls alone. Only ones inside the
      // host, though: a host that is itself inside a link should still fire.
      const control = event.target.closest('a, button, input, select, textarea, label, [contenteditable]');
      if (control && this.el.contains(control) && control !== this.el) return;
      // Mapped through the rendered size, so a host scaled by a CSS
      // transform still bursts under the cursor, then in past the border,
      // since the canvas fills the inside of it. (A rotated host's
      // bounding box is larger than the host, so clicks there land a few
      // px off toward its corners.)
      const rect = this.el.getBoundingClientRect();
      const scaleX = rect.width / this.el.offsetWidth;
      const scaleY = rect.height / this.el.offsetHeight;
      const x = (event.clientX - rect.left) / scaleX - this.el.clientLeft;
      const y = (event.clientY - rect.top) / scaleY - this.el.clientTop;
      this.launch(x, y);
    }

    // Sends a rocket up from the bottom edge to burst at (x, y), in px
    // from the element's top-left. Leaves from somewhere near below the
    // target rather than straight under it, so it arcs in at a slight
    // angle like a launched one would.
    launch(x, y) {
      if (!this._w || this._reduced) return;
      const fromX = Math.min(this._w, Math.max(0, x + randomBetween(-0.12, 0.12) * this._w));
      this._addRocket(fromX, x, Math.max(0, Math.min(y, this._h - 20)));
    }

    _launchRandom() {
      const w = this._w;
      const h = this._h;
      const fromX = randomBetween(0.1, 0.9) * w;
      const toX = fromX + randomBetween(-0.1, 0.1) * w;
      // Burst high enough that most of a burst fits under the top edge,
      // and never lower than halfway down.
      const top = Math.min(h * 0.5, Math.max(h * 0.1, this.options.burstRadius * 0.6));
      this._addRocket(fromX, toX, randomBetween(top, h * 0.5));
    }

    // Constant upward deceleration, picked so the rocket stops rising
    // exactly at the target: that's where it bursts. The climb takes
    // longer the farther it has to go, but not proportionally, so a short
    // climb in a small card doesn't look sluggish.
    _addRocket(fromX, toX, toY) {
      const rise = Math.max(1, this._h - toY);
      const duration = randomBetween(0.9, 1.2) * Math.sqrt(rise / 300);
      this._rockets.push({
        fromX,
        fromY: this._h,
        x: fromX,
        y: this._h,
        px: fromX,
        py: this._h,
        vx: (toX - fromX) / duration,
        vy: (-2 * rise) / duration,
        decel: (2 * rise) / (duration * duration),
        age: 0,
        duration,
        wobble: Math.random() * Math.PI * 2,
        sparkIn: 0,
        pattern: this._patterns[Math.floor(Math.random() * this._patterns.length)],
      });
    }

    // The color(s) for one burst. Two-tone bursts take a second color well
    // away from the first: a different entry for Specific, or a point at
    // least 30% further along the gradient for Range.
    _burstTones() {
      const stops = this._stops;
      const { blend } = this.options;
      const pickT = Math.random();
      const pick = (t) => (blend
        ? sampleGradient(stops, t)
        : stops[Math.min(stops.length - 1, Math.floor(t * stops.length))]);
      const first = pick(pickT);
      const theme = this._theme;
      if (stops.length < 2 || Math.random() >= TWO_TONE_SHARE) return [tints(first, theme)];
      let secondT;
      if (blend) {
        secondT = (pickT + randomBetween(0.3, 0.7)) % 1;
      } else {
        const i = Math.min(stops.length - 1, Math.floor(pickT * stops.length));
        const j = (i + 1 + Math.floor(Math.random() * (stops.length - 1))) % stops.length;
        secondT = (j + 0.5) / stops.length;
      }
      return [tints(first, theme), tints(pick(secondT), theme)];
    }

    _room() {
      return MAX_PARTICLES - this._particles.length;
    }

    _burst(x, y, pattern) {
      const room = this._room();
      if (room <= 0) return;
      const { burstSize, burstRadius } = this.options;
      const velocities = burstVelocities(pattern, Math.round(burstSize)).slice(0, room);
      const speed = burstRadius * DRAG;
      const tones = this._burstTones();
      // Two-tone bursts split across a line through the middle at a random
      // angle, one color either side.
      const axis = Math.random() * Math.PI * 2;
      const ax = Math.cos(axis);
      const ay = Math.sin(axis);
      velocities.forEach(([ux, uy]) => {
        const tone = tones.length > 1 && ux * ax + uy * ay < 0 ? tones[1] : tones[0];
        const roll = Math.random();
        this._particles.push({
          x, y, px: x, py: y,
          vx: ux * speed,
          vy: uy * speed,
          age: 0,
          life: randomBetween(1.3, 1.9) * pattern.life,
          drag: DRAG * pattern.drag,
          gravity: pattern.gravity,
          size: pattern.size * randomBetween(0.8, 1.2),
          color: tone[Math.floor(Math.random() * tone.length)],
          twinkle: roll < TWINKLE_SHARE,
          crackle: roll >= TWINKLE_SHARE && roll < TWINKLE_SHARE + CRACKLE_SHARE,
          embers: pattern.embers,
          emberIn: Math.random() * EMBER_INTERVAL,
          split: pattern.split,
          alpha: 1,
        });
      });
      this._flashes.push({
        x, y, age: 0, life: 0.25, radius: burstRadius * 0.35, color: tones[0][2],
      });
    }

    // Small, short-lived, mostly-falling bits: a rocket's trailing sparks,
    // a willow's embers, a crackle's pop. Dropped when particles are
    // running short.
    _spark(x, y, vx, vy, life, size, color, alpha) {
      this._particles.push({
        x, y, px: x, py: y, vx, vy,
        age: 0, life, drag: DRAG, gravity: 0.4, size, color,
        twinkle: false, crackle: false, embers: false, split: 0, alpha,
      });
    }

    _splitParticle(p) {
      const n = p.split;
      if (this._room() < n) return;
      const speed = this.options.burstRadius * DRAG * 0.45;
      const turn = Math.atan2(p.vy, p.vx) + Math.PI / n;
      for (let i = 0; i < n; i++) {
        const a = turn + (i / n) * Math.PI * 2;
        this._particles.push({
          ...p,
          px: p.x,
          py: p.y,
          vx: p.vx * 0.3 + Math.cos(a) * speed,
          vy: p.vy * 0.3 + Math.sin(a) * speed,
          age: 0,
          life: (p.life - p.age) * randomBetween(0.9, 1.1),
          size: p.size * 0.75,
          split: 0,
          crackle: false,
        });
      }
    }

    _crackle(p) {
      if (this._room() < 5) return;
      const count = Math.round(randomBetween(3, 5));
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = randomBetween(40, 90);
        this._spark(p.x, p.y, Math.cos(a) * s, Math.sin(a) * s, randomBetween(0.12, 0.25), 0.6, this._theme.crackle, 1);
      }
    }

    _advance(dt, launching) {
      // Nothing to launch into until the host has had a size at least once
      // (see _resize): a rocket worked out against a 0px sky never arrives.
      if (!this._w) return;
      const { gravity } = this.options;

      if (launching) {
        this._nextLaunchIn -= dt;
        while (this._nextLaunchIn <= 0) {
          this._launchRandom();
          this._nextLaunchIn += this._launchGap();
        }
      }

      const rockets = this._rockets;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.px = r.x;
        r.py = r.y;
        r.age += dt;
        // Worked out from the climb's own formula rather than stepped
        // frame by frame, which overshoots by a little every frame and so
        // bursts short of the target, more so the slower the frame rate.
        // The wobble is a small side-to-side sway, eased in and out over the
        // climb so it leaves the launch point and reaches the target
        // exactly.
        const t = Math.min(r.age, r.duration);
        const sway = Math.sin(r.wobble + t * 9) * 2.5 * Math.sin((Math.PI * t) / r.duration);
        r.x = r.fromX + r.vx * t + sway;
        r.y = r.fromY + r.vy * t + 0.5 * r.decel * t * t;
        r.sparkIn -= dt;
        if (r.sparkIn <= 0 && this._particles.length < EXTRAS_LIMIT) {
          r.sparkIn = SPARK_INTERVAL;
          this._spark(r.x, r.y, randomBetween(-12, 12), randomBetween(10, 40), randomBetween(0.3, 0.6), 0.6, this._theme.spark, 0.6);
        }
        if (r.age >= r.duration) {
          rockets.splice(i, 1);
          this._burst(r.x, r.y, r.pattern);
        }
      }

      // Spent particles are swap-removed (the last one moves into the gap)
      // rather than spliced, since a burst expiring all at once would
      // otherwise shift the whole array once per particle. Draw order
      // doesn't matter: light adds up the same in any order.
      const particles = this._particles;
      const remove = (i) => {
        const last = particles.pop();
        if (i < particles.length) particles[i] = last;
      };
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.px = p.x;
        p.py = p.y;
        p.age += dt;
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vy = p.vy * damp + gravity * p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.embers && p.age < p.life) {
          p.emberIn -= dt;
          if (p.emberIn <= 0) {
            p.emberIn += EMBER_INTERVAL;
            if (this._particles.length < EXTRAS_LIMIT) {
              this._spark(p.x, p.y, p.vx * 0.05, p.vy * 0.05, randomBetween(0.6, 1), p.size * 0.6, p.color, 0.5 * (1 - p.age / p.life));
            }
          }
        }
        if (p.split && p.age >= p.life / 3) {
          remove(i);
          this._splitParticle(p);
          continue;
        }
        if (p.age >= p.life) {
          remove(i);
          if (p.crackle) this._crackle(p);
        }
      }

      const flashes = this._flashes;
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].age += dt;
        if (flashes[i].age >= flashes[i].life) flashes.splice(i, 1);
      }
    }

    // Trails come from never fully clearing: each frame erases a share of
    // what's already there (destination-out), then draws everything new on
    // top: added together (lighter) on a dark sky, so overlapping light
    // glows brighter, or simply painted over on a light one (see THEMES).
    // The share is worked out from the time passed, so a trail fades over
    // the same time on a 60Hz or a 120Hz screen. Whenever the sky is empty
    // it's wiped clean outright, which clears even the faintest leftovers.
    _render(dt) {
      if (!this._w) return;
      const { ctx, _w: w, _h: h, _dpr: dpr } = this;
      const { particleSize, trailLength } = this.options;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const empty = !this._rockets.length && !this._particles.length && !this._flashes.length;
      if (empty) {
        if (this._dirty) ctx.clearRect(0, 0, w, h);
        this._dirty = false;
        return;
      }
      this._dirty = true;

      // trailLength is how long a trail takes to fade to about 5%, which
      // is three time constants of an exponential fade. It's applied in
      // steps of at least MIN_FADE rather than every frame: at a fast frame
      // rate or a long trail, a frame's share would be so small that a
      // faint pixel loses less than one step of alpha and rounds straight
      // back to where it was, leaving the trail stuck on screen as a
      // ghost. Erased in coarser steps, what's left over is too faint to
      // see.
      const tau = Math.max(0.01, trailLength) / 3;
      this._fadeDue += dt;
      if (this._fadeDue >= -Math.log(1 - MIN_FADE) * tau) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-this._fadeDue / tau)})`;
        ctx.fillRect(0, 0, w, h);
        this._fadeDue = 0;
      }

      const theme = this._theme;
      ctx.globalCompositeOperation = theme.composite;
      // Butt, not round: each frame's segment starts exactly where the last
      // one ended, and round caps would overlap there, adding the color to
      // itself at every joint (or darkening it, on a light sky) until it
      // no longer reads as the color it is.
      ctx.lineCap = 'butt';

      this._flashes.forEach((f) => {
        const t = f.age / f.life;
        const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
        glow.addColorStop(0, f.color);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = theme.flash * (1 - t);
        ctx.fillStyle = glow;
        ctx.fillRect(f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2);
      });

      ctx.strokeStyle = theme.rocket;
      ctx.lineWidth = particleSize * 0.9;
      ctx.globalAlpha = 0.85;
      this._rockets.forEach((r) => {
        ctx.beginPath();
        ctx.moveTo(r.px, r.py);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      });

      // Each particle is a line from where it was last frame to where it
      // is now, so a fast one draws a streak rather than a row of dots.
      this._particles.forEach((p) => {
        const t = p.age / p.life;
        // Full brightness for the first 60% of its life, then a straight
        // fade to nothing.
        let alpha = p.alpha * Math.min(1, (1 - t) * 2.5);
        if (p.twinkle && t > 0.5 && Math.random() < 0.5) alpha *= 0.15;
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = particleSize * p.size * (1 - 0.6 * t);
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      });

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Reduced motion: no loop, just one still frame of a few bursts caught
    // mid-spread. They're run forward a second, frame by frame, so they
    // have their trails, then left there.
    _drawStill() {
      if (!this._w) return;
      this._rockets = [];
      this._particles = [];
      this._flashes = [];
      this._fadeDue = 0;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      [[0.25, 0.3], [0.55, 0.22], [0.8, 0.38]].forEach(([fx, fy]) => {
        const pattern = this._patterns[Math.floor(Math.random() * this._patterns.length)];
        this._burst(fx * this._w, fy * this._h, pattern);
      });
      // A second in, a peony is about 80% of the way out and still bright.
      const dt = 1 / 60;
      for (let i = 0; i < 60; i++) {
        this._advance(dt, false);
        this._render(dt);
      }
    }

    _tick(now) {
      // Clamped below too: rAF's timestamp is the frame's start, which can
      // fall slightly before the performance.now() that _start() recorded.
      const dt = Math.min(0.05, Math.max(0, (now - this._lastNow) / 1000));
      this._lastNow = now;
      this._advance(dt, true);
      this._render(dt);
      this._raf = requestAnimationFrame(this._tick);
    }

    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
      if ('colors' in newOptions) this._stops = resolveColors(this.options.colors);
      if ('patterns' in newOptions) this._patterns = resolvePatterns(this.options.patterns);
      if ('background' in newOptions) this._applyBackground();
      // A new rate takes over now, rather than after whatever wait the old
      // one had already scheduled (which at a low rate can be many seconds,
      // and at 0 would still let one more go up). Drawing a fresh wait is
      // fair: random launches have no memory of how long it's been.
      if ('launchRate' in newOptions) this._nextLaunchIn = this._launchGap();
      if (this._reduced) this._drawStill();
    }

    destroy() {
      this._stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      this.el.removeEventListener('click', this._onClick);
      this.el.classList.remove('bg-fireworks--dark');
      this.canvas.remove();
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__fireworksInstance;
    }
  }

  Fireworks.PATTERNS = Object.keys(PATTERNS);

  Fireworks.initAll = function (selector = '.bg-fireworks', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__fireworksInstance)
      .map((el) => {
        const instance = new Fireworks(el, options);
        el.__fireworksInstance = instance;
        return instance;
      });
  };

  Fireworks.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__fireworksInstance || null : null;
  };

  Fireworks.getAll = function (selector = '.bg-fireworks') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__fireworksInstance)
      .filter(Boolean);
  };

  global.Fireworks = Fireworks;

  function autoInit() {
    Fireworks.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
