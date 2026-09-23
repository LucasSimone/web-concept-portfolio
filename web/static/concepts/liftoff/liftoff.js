/**
 * Liftoff
 * -------
 * Hold a card in the pointer for a sustained dwell (default 1.5s) and it
 * lifts off the page, settles into a slow ambient float, and a scatter of
 * short black dashes streams downward beneath it, clustered toward the
 * middle, for as long as it stays lifted. Leaving before the dwell
 * completes cancels cleanly with no visible motion at all; leaving after
 * liftoff eases the card back down and lets the dashes fade out.
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
  --glow-thrust: 0;
  --shadow-color: #000000;
  --dash-color: #000000;
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

/* Thrust lines - simple, disjointed dashes instead of anything soft or
   filled: each is its own small \`<div>\` (a straight bar), spawned one at
   a time by createThrustEmitter() below rather than built once and
   looped, so no two dashes are ever the same shape or timing. Columns are
   evenly spaced across the card's width, each with its own independent
   spawn stream whose max fall distance follows a normal distribution
   (tallest in the middle, thinning toward the edges). Each dash fades in,
   falls straight down its column's full distance while fading back out,
   then is removed and a new one is scheduled after a random pause -
   that's "move" and "dissipate" as two keyframe steps on the same
   element, nothing fancier. The outer element sits flush against the
   card's own bottom edge with no overlap upward into the card
   (\`bottom\`/\`height\` set inline from \`thrustHeight\` so its top edge
   lands exactly on the card's own bottom edge) and spans the card's full
   width so the columns can be distributed across the *whole* bottom edge,
   not just the center. */
.liftoff-card__glow--thrust {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -54px;
  height: 54px;
  opacity: var(--glow-thrust);
  z-index: -1;
  pointer-events: none;
}

.liftoff-card__line {
  position: absolute;
  top: 0;
  width: 2px;
  background-color: var(--dash-color);
  transform: translateX(-50%);
  animation-name: liftoff-line-fall;
  animation-timing-function: ease-in;
  animation-iteration-count: 1;
}
@keyframes liftoff-line-fall {
  0% { opacity: 0; transform: translateX(-50%) translateY(0); }
  15% { opacity: 1; }
  70% { opacity: 0.6; }
  100% { opacity: 0; transform: translateX(-50%) translateY(var(--line-fall, 12px)); }
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // How sharply column height tapers off from the center, in points on the
  // 0-100 local-width scale used below - independent of column count or
  // container width, so the bell shape reads the same regardless of how
  // many columns are packed into it.
  const THRUST_HEIGHT_SIGMA = 20;

  // Small fixed gap (px) between the card's own bottom edge and where the
  // first dash in each column starts, so the thrust visibly breaks contact
  // with the card instead of touching it.
  const THRUST_GAP_PX = 6;

  // Fall speed (px/ms) for a dash at `thrustSpeed: 1` - tuned so the
  // default 54px `thrustHeight` takes about the same ~1.5s a dash took to
  // fall under the old fixed-duration animation.
  const BASE_FALL_SPEED = 0.035;

  // Max fall distance for a column at horizontal position `xPercent`
  // (0-100, local to its container) - a normal distribution centered on
  // the container's middle and peaking at `peakHeight`, so the center
  // column travels close to the full `thrustHeight` and columns toward
  // the edges travel less.
  function envelopeHeight(xPercent, peakHeight) {
    const dz = (xPercent - 50) / THRUST_HEIGHT_SIGMA;
    return Math.max(4, peakHeight * Math.exp(-0.5 * dz * dz));
  }

  // Drives one thrust container's continuous dash spawning. Each column
  // is spaced evenly across the container's width (not random - that's
  // the control surface: `thrustColumns`) and runs its own independent
  // spawn stream: emit a dash with a random length, let it fall the
  // column's own envelope distance while fading out, remove it, then wait
  // a random pause before spawning the next one. Every dash is a fresh
  // element with its own randomized length/duration/pause rather than a
  // shared loop replaying the same shape, so nothing about the effect
  // visibly repeats. `getOptions` is called fresh on every spawn so live
  // changes to speed/length/spacing take effect on the next dash without
  // needing a restart.
  function createThrustEmitter(container, getOptions, isLifted) {
    let timers = [];

    function stop() {
      timers.forEach((id) => clearTimeout(id));
      timers = [];
      container.innerHTML = '';
    }

    function spawn(x, height, slot) {
      const o = getOptions();

      // `glow: false` (e.g. the homepage preset) means these dashes are
      // permanently invisible, and a resting/never-hovered card has
      // `--glow-thrust` at 0 regardless of `glow` - either way, poll
      // cheaply instead of actually creating and animating DOM elements
      // nobody will ever see, so idle cards don't churn them forever in
      // the background. Resumes spawning normally the moment the card
      // lifts with glow on.
      if (!o.glow || !isLifted()) {
        timers[slot] = setTimeout(() => spawn(x, height, slot), 500);
        return;
      }

      const speedPxPerMs = BASE_FALL_SPEED * Math.max(0.05, o.thrustSpeed);

      const lenMin = Math.min(o.lineLengthMin, o.lineLengthMax);
      const lenMax = Math.max(o.lineLengthMin, o.lineLengthMax);
      const len = lenMin + Math.random() * (lenMax - lenMin);
      const durationMs = Math.max(o.minFallDuration, height / speedPxPerMs);

      const line = document.createElement('div');
      line.className = 'liftoff-card__line';
      line.style.left = `${x.toFixed(1)}%`;
      line.style.top = `${THRUST_GAP_PX}px`;
      line.style.width = `${o.lineThickness}px`;
      line.style.height = `${len.toFixed(1)}px`;
      line.style.setProperty('--line-fall', `${height.toFixed(1)}px`);
      line.style.animationDuration = `${(durationMs / 1000).toFixed(2)}s`;
      line.addEventListener('animationend', () => line.remove());
      container.appendChild(line);

      const spaceMin = Math.min(o.spacingMin, o.spacingMax);
      const spaceMax = Math.max(o.spacingMin, o.spacingMax);
      const spacing = spaceMin + Math.random() * (spaceMax - spaceMin);
      const delay = Math.max(16, spacing / speedPxPerMs);
      timers[slot] = setTimeout(() => spawn(x, height, slot), delay);
    }

    // (Re)starts every column's spawn stream from scratch - clears any
    // dashes and pending spawns from a previous column layout first, so
    // changing `thrustColumns`/`thrustHeight` never leaves stale streams
    // running alongside new ones.
    function start(columns, peakHeight) {
      stop();
      const step = 100 / (columns + 1);
      for (let i = 1; i <= columns; i++) {
        const x = step * i;
        const height = envelopeHeight(x, peakHeight);
        // Staggers each column's first dash so they don't all spawn in
        // lockstep the moment a card lifts off.
        timers[i] = setTimeout(() => spawn(x, height, i), Math.random() * 500);
      }
    }

    return { start, stop };
  }

  // Options whose new value requires the dash streams to be restarted
  // (they shape column layout/timing up front) rather than just being
  // read fresh on the next spawn like everything else.
  const THRUST_REBUILD_KEYS = ['thrustColumns', 'thrustHeight'];

  const DEFAULTS = {
    dwell: 1500,        // ms of continuous hover before liftoff triggers
    riseSmoothing: 220, // ms time-constant easing `amount` toward its target
    lift: 22,            // px the card rises at full liftoff
    driftX: 7,           // px of ambient horizontal drift at full liftoff
    driftY: 5,            // px of extra ambient vertical bob at full liftoff
    tilt: 1.6,            // deg of ambient rotation at full liftoff
    scale: 1.035,         // scale at full liftoff
    shadowAtRest: true,   // show the contact shadow while resting on the page
    glow: true,           // show the falling dashes while lifted
    shadowColor: '#000000', // contact shadow color
    dashColor: '#000000', // falling dash color
    thrustColumns: 11,    // number of evenly-spaced dash columns
    lineThickness: 2,     // px width of each dash
    thrustHeight: 54,     // px height of the tallest (center) column
    thrustSpeed: 1,       // multiplier on dash fall/fade speed
    lineLengthMin: 6,     // px, shortest random dash length
    lineLengthMax: 16,    // px, longest random dash length
    spacingMin: 4,        // px, shortest random gap before a column's next dash spawns
    spacingMax: 14,       // px, longest random gap before a column's next dash spawns
    // ms floor on a dash's animation duration, independent of `thrustSpeed`.
    // Columns near the edges of the `thrustHeight` gaussian taper can have
    // only a few px of fall distance, which without this floor finishes
    // its fade-in/fall/fade-out cycle fast enough to read as a flicker
    // instead of a fall. Raising this keeps even a short-distance dash
    // slow enough to look like real (if small) motion.
    minFallDuration: 750,
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

      this._glowThrustEl = document.createElement('div');
      this._glowThrustEl.className = 'liftoff-card__glow--thrust';

      this._thrustEmitter = createThrustEmitter(
        this._glowThrustEl,
        () => this.options,
        () => this.amount > 0.02,
      );
      this._rebuildThrust();

      el.prepend(this._shadowEl, this._glowThrustEl);

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

      // Line opacity - just `a` itself (each individual dash already has
      // its own fade in/out via its CSS animation), gated by `glow` so
      // it's entirely gone at rest instead of just dim.
      const g = this.options.glow ? 1 : 0;
      style.setProperty('--glow-thrust', (g * a).toFixed(4));
      style.setProperty('--shadow-color', this.options.shadowColor);
      style.setProperty('--dash-color', this.options.dashColor);

      // `shadowAtRest` just toggles whether the contact shadow (below) is
      // allowed to show at all - independent of the glow above.
      style.setProperty('--shadow-max', this.options.shadowAtRest ? 1 : 0);

      this.el.style.zIndex = a > 0.02 ? 5 : '';
    }

    // Resizes the thrust container and restarts its dash spawn streams
    // from the current options - called at construction and again
    // whenever `thrustColumns`/`thrustHeight` change (THRUST_REBUILD_KEYS),
    // since those two reshape column layout up front rather than being
    // read fresh on each spawn like everything else the emitter uses.
    _rebuildThrust() {
      const { thrustColumns, thrustHeight } = this.options;
      const pad = 14;

      const thrustContainerHeight = thrustHeight + pad;
      this._glowThrustEl.style.height = `${thrustContainerHeight}px`;
      this._glowThrustEl.style.bottom = `-${thrustContainerHeight}px`;
      this._thrustEmitter.start(thrustColumns, thrustHeight);
    }

    // Merges new option values in - every value is read fresh either each
    // frame by _render() or on each dash spawn by the thrust emitters, so
    // nothing needs to be rebuilt or restarted, except THRUST_REBUILD_KEYS
    // which reshape column layout itself.
    update(options = {}) {
      Object.assign(this.options, options);
      if (Object.keys(options).some((key) => THRUST_REBUILD_KEYS.includes(key))) {
        this._rebuildThrust();
      }
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
      this._thrustEmitter.stop();
      this._shadowEl.remove();
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
