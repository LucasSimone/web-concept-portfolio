/**
 * InFlightOut
 * ----------
 * Characters enter from below in scattered paths, assemble while the element
 * crosses the viewport, then disperse above it. Viewport progress is derived
 * from scroll position, so reversing scroll reverses the flight exactly.
 */
(function (global) {
  const DEFAULTS = {
    scatter: 1,
    maxDistance: 140,
    rotation: 0.4,
    maxAngle: 60,
    entryPercent: 48,
    hangPercent: 10,
    exitPercent: 42,
    path: 'linear',
  };

  class InFlightOut {
    constructor(el, options = {}) {
      if (!el) throw new Error('InFlightOut: element is required');

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._chars = [];
      this._progress = 0;
      this._seed = 0;
      this._onScroll = this._onScroll.bind(this);
      this._tick = this._tick.bind(this);

      this._buildDOM();
      global.addEventListener('scroll', this._onScroll, { passive: true });
      global.addEventListener('resize', this._onScroll);
      this._onScroll();
      this._raf = requestAnimationFrame(this._tick);
    }

    _buildDOM() {
      const value = this.el.dataset.text || this.el.textContent.trim();
      this.el.innerHTML = '';
      this.el.dataset.text = value;

      this._chars = Array.from(value).map((char, index) => {
        const span = document.createElement('span');
        span.className = 'in-flight-out__char';
        span.textContent = char === ' ' ? '\u00a0' : char;
        span.setAttribute('aria-hidden', char === ' ' ? 'true' : 'false');
        span.style.setProperty('--char-index', index);
        this.el.appendChild(span);

        const random = this._randomFor(index);
        return { el: span, ...this._randomizeChar(random) };
      });
    }

    // Every randomized property that defines a character's flight path —
    // its entry/exit points (both linear and random-edge variants) and its
    // rotation behavior. Pulled out on its own so reshuffle() can re-roll
    // just these values without rebuilding the DOM or touching any option.
    _randomizeChar(random) {
      return {
        // Linear path: everyone enters from below and exits above, like
        // the classic scrolling-credits crawl.
        entryLinear: { x: random(-0.95, 0.95), y: random(0.75, 1.45) },
        exitLinear: { x: random(-0.95, 0.95), y: random(-1.45, -0.75) },
        // Random path: each letter gets its own independent off-screen
        // edge point to enter from and exit to (any of top/right/bottom/
        // left), so letters can fly in and out from any direction.
        entryRandom: this._randomEdgePoint(random),
        exitRandom: this._randomEdgePoint(random),
        rotationRoll: random(0, 1),
        rotationFactorEntry: random(-1, 1),
        rotationFactorExit: random(-1, 1),
        // Fractions (0-1) of this character's own entry/exit phase window
        // that it uses for its start delay and travel duration — the
        // absolute phase window itself is driven by the entry/hang/exit
        // percent options, recomputed every frame in _tick().
        entryJitterStart: random(0, 0.6),
        entryJitterDuration: random(0.4, 1),
        exitJitterStart: random(0, 0.6),
        exitJitterDuration: random(0.4, 1),
      };
    }

    // A random point just off one of the four viewport edges. `x` and `y`
    // are fractions meant to be multiplied by viewport width/height
    // respectively (matching the linear entry/exit points), so a value
    // like 1.1 pushes a letter comfortably past that edge off-screen.
    _randomEdgePoint(random) {
      const edge = Math.floor(random(0, 4));
      if (edge === 0) return { x: random(-0.95, 0.95), y: -random(0.75, 1.45) }; // top
      if (edge === 1) return { x: random(0.75, 1.45), y: random(-0.6, 0.6) }; // right
      if (edge === 2) return { x: random(-0.95, 0.95), y: random(0.75, 1.45) }; // bottom
      return { x: -random(0.75, 1.45), y: random(-0.6, 0.6) }; // left
    }

    _randomFor(index) {
      // Mix the index (and current reshuffle seed) through a few avalanche
      // rounds before use — a bare linear seed (e.g. index * constant)
      // produces a first draw that is nearly linear in index, so
      // consecutive characters would all land in the same region instead
      // of scattering independently.
      let hash = (index + 1) * 2654435761;
      hash ^= Math.imul(this._seed + 1, 0x9e3779b1);
      hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
      hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
      hash = (hash ^ (hash >>> 16)) >>> 0;

      let state = hash || 1;
      return (min, max) => {
        // mulberry32
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        return min + (max - min) * value;
      };
    }

    _onScroll() {
      const rect = this.el.getBoundingClientRect();
      const range = global.innerHeight + rect.height;
      this._progress = range > 0
        ? clamp((global.innerHeight - rect.top) / range, 0, 1)
        : 0.5;
    }

    _tick() {
      const { scatter, maxAngle } = this.options;
      // `rotation` is a 0-1 chance-and-intensity dial: at low values only a
      // few letters rotate, and only a little; at high values most letters
      // rotate, up to the full maxAngle.
      const rotation = clamp(this.options.rotation, 0, 1);
      const viewportWidth = global.innerWidth || 1200;
      const viewportHeight = global.innerHeight || 800;
      // `maxDistance` is a percentage of the viewport diagonal — it caps how
      // far off-screen a letter's flight path can carry it, regardless of
      // how large `scatter` pushes the raw entry/exit point.
      const maxDistancePx = Math.max(0, this.options.maxDistance) / 100
        * Math.hypot(viewportWidth, viewportHeight);

      // entry/hang/exit percents describe how the 0-1 scroll-progress range
      // is split into three phases. Only entry/exit widths matter here (hang
      // is simply the untouched middle gap between them) — normalize in case
      // the three don't sum to exactly 100.
      const totalPercent = Math.max(
        1,
        this.options.entryPercent + this.options.hangPercent + this.options.exitPercent,
      );
      const entryWidth = clamp(this.options.entryPercent / totalPercent, 0.001, 1);
      const exitWidth = clamp(this.options.exitPercent / totalPercent, 0.001, 1 - entryWidth);
      const exitPhaseStart = 1 - exitWidth;
      const useRandomPath = this.options.path === 'random';

      this._chars.forEach((char) => {
        const entryPoint = useRandomPath ? char.entryRandom : char.entryLinear;
        const exitPoint = useRandomPath ? char.exitRandom : char.exitLinear;

        const entryStart = char.entryJitterStart * entryWidth;
        const entryDuration = Math.max(
          0.001,
          char.entryJitterDuration * (entryWidth - entryStart),
        );
        const exitStart = exitPhaseStart + char.exitJitterStart * exitWidth;
        const exitDuration = Math.max(
          0.001,
          char.exitJitterDuration * (exitWidth - char.exitJitterStart * exitWidth),
        );

        const entry = smoothstep((this._progress - entryStart) / entryDuration);
        const exit = smoothstep((this._progress - exitStart) / exitDuration);
        let x = (
          entryPoint.x * (1 - entry) +
          exitPoint.x * exit
        ) * viewportWidth * scatter;
        let y = (
          entryPoint.y * (1 - entry) +
          exitPoint.y * exit
        ) * viewportHeight * scatter;

        const distance = Math.hypot(x, y);
        if (distance > maxDistancePx && distance > 0) {
          const clampFactor = maxDistancePx / distance;
          x *= clampFactor;
          y *= clampFactor;
        }

        const rotationActive = char.rotationRoll <= rotation ? 1 : 0;
        const angle = (
          char.rotationFactorEntry * (1 - entry) +
          char.rotationFactorExit * exit
        ) * rotation * maxAngle * rotationActive;
        // Fully transparent at both ends of the flight (freshly spawned or
        // about to vanish) and fully opaque only once a letter has actually
        // arrived — no lingering minimum opacity.
        const opacity = clamp(entry * (1 - exit), 0, 1);

        char.el.style.transform =
          `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) ` +
          `rotate(${angle.toFixed(2)}deg)`;
        char.el.style.opacity = opacity.toFixed(3);
      });

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
    }

    // Re-rolls each character's random entry/exit points and rotation
    // factors in place — a fresh flight path every time, without touching
    // any slider/option value and without rebuilding the DOM.
    reshuffle() {
      this._seed += 1;
      this._chars.forEach((char, index) => {
        const random = this._randomFor(index);
        Object.assign(char, this._randomizeChar(random));
      });
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._onScroll();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onScroll);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  InFlightOut.initAll = function (selector = '.in-flight-out', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__inFlightOutInstance)
      .map((el) => {
        const instance = new InFlightOut(el, options);
        el.__inFlightOutInstance = instance;
        return instance;
      });
  };

  global.InFlightOut = InFlightOut;
})(window);
