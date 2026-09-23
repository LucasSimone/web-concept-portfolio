/**
 * Liftoff
 * -------
 * Hold a card in the pointer for a sustained dwell (default 1.5s) and it
 * lifts off the page, settles into a slow ambient float, and grows an
 * underglow beneath it - somewhere between a car's underglow and a
 * rocket's exhaust plume. Leaving before the dwell completes cancels
 * cleanly with no visible motion at all; leaving after liftoff eases the
 * card back down and lets the glow fade out.
 *
 * Everything is driven by one continuous scalar per card (`amount`, 0-1)
 * rather than a CSS class + transition: entry, the ambient float, and the
 * settle-back all read the same value every frame, so a pointer leaving
 * mid lift-in reverses smoothly from wherever it currently sits instead
 * of snapping or fighting an in-flight CSS transition.
 *
 * Usage: give any element class="liftoff-card" - this file injects its
 * own CSS and the shadow/glow layers behind whatever content you put
 * inside it, so dropping the <script> tag in and adding the class is the
 * whole setup. The host element needs its own size and content; the
 * injected CSS sets neither.
 */
(function (global) {
  const STYLE_ID = 'liftoff-styles';
  const CSS = `
.liftoff-card {
  --lift-x: 0px;
  --lift-y: 0px;
  --lift-r: 0deg;
  --lift-s: 1;
  --lift-amount: 0;
  --glow-ambient: 0;
  --glow-thrust: 0;
  --glow-ambient-color: #ff8c28;
  --glow-thrust-color: #ff7a1a;
  --shadow-color: #000000;
  --shadow-max: 1;

  position: relative;
  isolation: isolate;
  background: #fff;
  color: #000;
  transform: translate(var(--lift-x), var(--lift-y)) rotate(var(--lift-r)) scale(var(--lift-s));
  will-change: transform;
}

/* Contact shadow on the ground - shrinks and fades as the card lifts, as
   if its light source becomes the glow underneath instead. \`--shadow-max\`
   (the \`shadowAtRest\` option) drops this to 0 to hide it entirely,
   independent of the glow layers below. */
.liftoff-card__shadow {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: -14px;
  height: 14px;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--shadow-color) 28%, transparent), transparent 70%);
  filter: blur(4px);
  opacity: calc(var(--shadow-max) * (1 - var(--lift-amount)));
  transform: scaleX(calc(1 - 0.3 * var(--lift-amount)));
  z-index: -1;
  pointer-events: none;
}

/* Ambient underglow - broad, soft, slow-pulsing - the "car underglow" half.
   Color comes from \`--glow-ambient-color\` (the \`glowColor\` option);
   color-mix blends in its own transparency rather than the option itself
   carrying alpha, since a hex color can't. */
.liftoff-card__glow--ambient {
  position: absolute;
  left: -25%;
  right: -25%;
  bottom: -42px;
  height: 92px;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--glow-ambient-color) 55%, transparent), transparent 72%);
  filter: blur(18px);
  opacity: var(--glow-ambient);
  z-index: -1;
  pointer-events: none;
}

/* Thrust plume - tighter, taller, flickering - the "rocket exhaust" half.
   Anchored to the card's bottom edge and scaled from the top so it reads
   as streaming further down the more the card lifts, not just fading in
   place. The core is \`--glow-thrust-color\` mixed toward white for a hot
   center, fading through the plain color to transparent at the edge. */
.liftoff-card__glow--thrust {
  position: absolute;
  left: 34%;
  right: 34%;
  bottom: -58px;
  height: 72px;
  background: radial-gradient(
    ellipse at 50% 0%,
    color-mix(in srgb, var(--glow-thrust-color) 60%, white),
    color-mix(in srgb, var(--glow-thrust-color) 35%, transparent) 55%,
    transparent 80%
  );
  filter: blur(6px);
  opacity: var(--glow-thrust);
  transform: scaleY(calc(0.55 + 0.45 * var(--lift-amount)));
  transform-origin: top center;
  z-index: -1;
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
    dwell: 1500,        // ms of continuous hover before liftoff triggers
    riseSmoothing: 220, // ms time-constant easing `amount` toward its target
    lift: 22,            // px the card rises at full liftoff
    driftX: 7,           // px of ambient horizontal drift at full liftoff
    driftY: 5,            // px of extra ambient vertical bob at full liftoff
    tilt: 1.6,            // deg of ambient rotation at full liftoff
    scale: 1.035,         // scale at full liftoff
    shadowAtRest: true,   // show the contact shadow while resting on the page
    glow: true,           // show the underglow + thrust plume while lifted
    shadowColor: '#000000', // contact shadow color
    glowColor: '#ff8c28', // underglow color
    thrustColor: '#ff7a1a', // thrust plume color
    // Auto-bind pointerenter/pointerleave/focusin/focusout on the host
    // element. Set false to skip that entirely and drive the card only
    // through enter()/leave() - for a host whose hover is already owned
    // by something else (e.g. a carousel card whose own hover-follow
    // slides it under a stationary cursor, which would otherwise
    // retrigger native hover on its own).
    hoverEvents: true,
  };

  class LiftoffCard {
    constructor(el, options) {
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this.amount = 0;   // 0 = resting on the page, 1 = fully lifted
      this.target = 0;
      this.phase = Math.random() * Math.PI * 2; // desyncs cards' float cycles
      this._dwellTimer = null;
      this._lastT = performance.now();

      this._shadowEl = document.createElement('div');
      this._shadowEl.className = 'liftoff-card__shadow';
      this._glowAmbientEl = document.createElement('div');
      this._glowAmbientEl.className = 'liftoff-card__glow--ambient';
      this._glowThrustEl = document.createElement('div');
      this._glowThrustEl.className = 'liftoff-card__glow--thrust';
      el.prepend(this._shadowEl, this._glowAmbientEl, this._glowThrustEl);

      this._onPointerEnter = this._onPointerEnter.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this._tick = this._tick.bind(this);

      if (this.options.hoverEvents) {
        el.addEventListener('pointerenter', this._onPointerEnter);
        el.addEventListener('pointerleave', this._onPointerLeave);
        el.addEventListener('focusin', this._onPointerEnter);
        el.addEventListener('focusout', this._onPointerLeave);
      }

      requestAnimationFrame(this._tick);
    }

    // Public: starts the dwell timer toward liftoff, exactly like a real
    // hover would. Called automatically by the bound listeners above
    // unless `hoverEvents: false`; call directly to drive the card from
    // an external hover source instead.
    enter() {
      clearTimeout(this._dwellTimer);
      this._dwellTimer = setTimeout(() => {
        this.target = 1;
      }, this.options.dwell);
    }

    // Public: cancels any pending liftoff and eases back down, exactly
    // like hover ending would.
    leave() {
      clearTimeout(this._dwellTimer);
      this.target = 0;
    }

    _onPointerEnter(event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      this.enter();
    }

    _onPointerLeave() {
      this.leave();
    }

    _tick(t) {
      const dt = Math.min(64, t - this._lastT);
      this._lastT = t;

      const k = 1 - Math.exp(-dt / this.options.riseSmoothing);
      this.amount += (this.target - this.amount) * k;
      if (Math.abs(this.target - this.amount) < 0.0008) this.amount = this.target;

      this._render(t / 1000);
      this._raf = requestAnimationFrame(this._tick);
    }

    _render(tSec) {
      const { lift, driftX, driftY, tilt, scale } = this.options;
      const a = this.amount;
      const p = this.phase;

      // Ambient float: three slightly-detuned sines so the motion reads as
      // organic drifting rather than a metronome, scaled by `a` so it's
      // fully still at rest and only breathes once lifted.
      const bobY = Math.sin(tSec * 0.9 + p) * driftY;
      const bobX = Math.sin(tSec * 0.6 + p * 1.7) * driftX;
      const bobR = Math.sin(tSec * 0.5 + p * 2.3) * tilt;

      const style = this.el.style;
      style.setProperty('--lift-x', `${(bobX * a).toFixed(2)}px`);
      style.setProperty('--lift-y', `${(-lift * a + bobY * a).toFixed(2)}px`);
      style.setProperty('--lift-r', `${(bobR * a).toFixed(2)}deg`);
      style.setProperty('--lift-s', (1 + (scale - 1) * a).toFixed(4));
      style.setProperty('--lift-amount', a.toFixed(4));

      // Glow: a slow ambient pulse (the "underglow" half) plus a faster,
      // noisier flicker (the "thrust" half, squared against `a` so it only
      // shows up once the card is mostly airborne), both gated by `a` so
      // the glow is entirely gone at rest instead of just dim.
      const ambientPulse = 0.85 + Math.sin(tSec * 1.3 + p) * 0.15;
      const flicker = 0.9 + Math.sin(tSec * 11 + p * 4) * 0.07 + Math.sin(tSec * 23 + p * 7) * 0.04;
      const g = this.options.glow ? 1 : 0;
      style.setProperty('--glow-ambient', (g * a * ambientPulse).toFixed(4));
      style.setProperty('--glow-thrust', (g * a * a * flicker).toFixed(4));
      style.setProperty('--glow-ambient-color', this.options.glowColor);
      style.setProperty('--glow-thrust-color', this.options.thrustColor);
      style.setProperty('--shadow-color', this.options.shadowColor);
      // `shadowAtRest` just toggles whether the contact shadow (below) is
      // allowed to show at all - independent of the glow above.
      style.setProperty('--shadow-max', this.options.shadowAtRest ? 1 : 0);

      this.el.style.zIndex = a > 0.02 ? 5 : '';
    }

    // Merges new option values in - every value is read fresh each frame
    // by _render(), so nothing needs to be rebuilt or restarted.
    update(options = {}) {
      Object.assign(this.options, options);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._dwellTimer);
      if (this.options.hoverEvents) {
        this.el.removeEventListener('pointerenter', this._onPointerEnter);
        this.el.removeEventListener('pointerleave', this._onPointerLeave);
        this.el.removeEventListener('focusin', this._onPointerEnter);
        this.el.removeEventListener('focusout', this._onPointerLeave);
      }
      this._shadowEl.remove();
      this._glowAmbientEl.remove();
      this._glowThrustEl.remove();
    }
  }

  function initAll(selector, options) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__liftoffInstance)
      .map((el) => {
        const instance = new LiftoffCard(el, options);
        el.__liftoffInstance = instance;
        return instance;
      });
  }

  function get(elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__liftoffInstance || null : null;
  }

  // The tuning home.js applies to every card on the homepage - exported so
  // the demo page's "Homepage" preset can reuse these exact values instead
  // of a hand-copied duplicate that can silently drift out of sync.
  const HOMEPAGE_PRESET = {
    dwell: 500, riseSmoothing: 300, lift: 30, driftX: 12, driftY: 12, tilt: 3, scale: 1.05,
    shadowAtRest: false, glow: false,
  };

  global.Liftoff = { initAll, get, LiftoffCard, DEFAULTS, HOMEPAGE_PRESET };

  if (!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    document.addEventListener('DOMContentLoaded', () => initAll('.liftoff-card'));
  }
})(window);
