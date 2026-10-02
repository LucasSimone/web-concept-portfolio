/**
 * Reel
 * ----
 * A View-Master-style carousel: cards sit on a ring that wraps around and
 * behind a single focus point, the focused card parked dead center at full
 * size - "held up to the eye" - while the rest curve away into a halo
 * behind it, shrinking and fading the further back around the ring they
 * sit. Stepping forward or back rotates the whole ring by one card, same
 * as spinning a real reel's click wheel.
 *
 * Every card except the one actually settling into focus sits at a
 * constant distance from center - a real ring, not a spiral - varying
 * only by angle (`theta`, the card's distance from the focus position in
 * `cardAngle` steps): side cards sit at full radius around eye-level,
 * the card directly behind the focus at full radius too but straight up.
 * Only the single card currently transitioning into or out of focus
 * interpolates its distance from center linearly, reaching full ring
 * radius after just one card-step - which is also what makes its
 * approach into center read as "growing" rather than "sliding into a
 * separately-sized slot": the same interpolation that pulls it inward
 * also grows it back up to full scale (scale and opacity instead follow
 * `depth = (1 - cos(theta)) / 2`, a gentler falloff by angle that isn't
 * tied to that one-step ramp). Cards don't vanish toward the center as
 * they shrink further around the back, either - they just get smaller in
 * place on the same ring.
 *
 * The ring itself is fitted to the root's box by default - as wide and
 * tall as it can be while still leaving the focused card room to sit at
 * full size inside it - so CSS sizing the element is normally all it
 * takes. `ringSize` scales that fit: below 1 draws the ring in tight
 * around the focus, above 1 pushes it past the box's own edges for a
 * ring bigger than its window.
 *
 * Index distance (not raw angle) is what's actually unbounded while
 * `loop` is on: `_pos` is a continuous, never-clamped real number - spin
 * it as many times around as you like, same as a real wheel never runs
 * out of rotation. Each card's on-screen angle is computed from the
 * *shortest* circular distance between its index and `_pos` (wrapping at
 * the card count), then that angle is clamped to +/-180deg so a dense
 * ring (many cards, or a large `cardAngle`) never overshoots past the one
 * point directly behind the focus - cards beyond that just pile up there
 * instead of doubling back round the wrong way. `loop: false` instead
 * gives the ring two ends: distances stop wrapping, `_pos` is clamped to
 * the first and last card, and what's left reads as an arc that runs out
 * rather than a wheel.
 *
 * Input has the same two-phase model as Sweep: while wheel/drag input is
 * arriving, position tracks it 1:1; once idle, a damped spring coasts the
 * remaining velocity down while pulling toward the nearest card, always
 * settling exactly on one. Which wheel axis is taken is `wheelAxis`, same
 * control (and same defaults and trade-off) as Dial's: 'both' makes one
 * ring work for a mouse, which only ever reports deltaY, as well as a
 * trackpad, at the cost of stopping page scroll while the pointer is over
 * a looping ring; 'horizontal' never interferes with the page but leaves
 * a mouse wheel dead. With `loop` off, wheel capture is additionally
 * handed back at either end of the ring exactly as Sweep does, so a
 * scroll that can't turn it any further carries on down the page.
 *
 * What there is deliberately no longer is hover-follow - Sweep's trick of
 * making whatever card is under the pointer the settle target. On a flat
 * strip that reads as scrubbing; on a ring it feeds back on itself, since
 * turning the ring is itself what slides the next card under a pointer
 * that never moved, and the ring ends up chasing its own motion. It was
 * tried here with a latch and a reach cap holding it down, and the honest
 * conclusion was that a mechanism needing two governors to stop fighting
 * the pointer doesn't belong on this one. Spinning a reel is a deliberate
 * act: wheel, drag, click a card, or the arrow keys.
 *
 * Once a card actually comes to rest in focus (not just passed through),
 * it gets a bubbling 'reel-settle' event, exactly like Sweep's
 * 'sweep-settle'. `.is-focused` is the live counterpart: it tracks
 * whichever card is nearest the focus even mid-spin. The pointer merely
 * being over the ring does only one thing - it pauses `autoplay`, so
 * a self-turning ring holds still while someone is reading it.
 *
 * `autoplay` is milliseconds between automatic steps, 0 for off, and with
 * `loop` off `autoplayEnd` decides what happens on reaching the last card
 * - spool back through the ring, ping-pong, cut back to the first, or park
 * there. Both live in shared/carousel-kit.js, identically for all four
 * carousels here. Driving the ring from a script instead: step/next/prev,
 * to/first/last for an animated move, jump for an instant one, and
 * play/pause/playing over the timer.
 *
 * Usage: wrap cards in `<div class="reel"><div class="reel-track">
 * <div class="reel-card">...</div>...</div></div>`, then load this file -
 * it injects the structural/positioning CSS (`.reel`, `.reel-track`,
 * `.reel-card`) automatically and auto-initializes against every
 * `.reel:not(.is-empty)` on the page. The host still supplies its own
 * size and card chrome (width, height, border, background, and whatever's
 * inside - text, an image, a video, anything) - the injected CSS only
 * ever sets what the mechanism itself needs to function. Add `.is-empty`
 * to keep a lab's shelf on the page before it has its first card.
 */
(function (global) {
  // See shared/carousel-kit.js - the arithmetic, the per-tab memory of
  // which card was focused, and the initAll/get/getAll surface that all
  // four carousels here share. Already bundled into the file this URL
  // serves, so there is nothing extra to load.
  const {
    clamp, mod, wrapDelta, resolveIndex, ownsArrowKeys, createIndexMemory,
    createAutoplay, addCommonApi, registerEffect,
  } = global.CarouselKit;

  const STYLE_ID = 'reel-styles';

  const CSS = `
.reel {
  /* Makes this element a container-query context, so the host can size
     cards in cqw units and have them track the reel's own width rather
     than the viewport's. Nothing here scales cards automatically - that
     stays the host's CSS - but without this there is no unit that
     follows this box, and fixed-px cards on a fluid ring crowd together
     as it shrinks. Costs nothing when unused. */
  container-type: inline-size;
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  touch-action: pan-y;
  cursor: grab;
}
.reel.is-dragging { cursor: grabbing; }
.reel.is-empty { cursor: default; }
.reel-track {
  position: relative;
  width: 100%;
  height: 100%;
}
.reel-empty {
  position: absolute;
  inset: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.4;
  pointer-events: none;
}
.reel-card {
  position: absolute;
  top: 50%;
  left: 50%;
  will-change: transform, opacity;
  user-select: none;
}
.reel-card[hidden] { display: none; }
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // The ring's radii are fitted to the track's own box rather than taken
  // as pixel options - these are how much of that measured space the ring
  // uses at `ringSize` 1, leaving room for the focused card to sit at
  // full size without its background neighbors crowding past the track
  // edge. `ringSize` scales both.
  const RADIUS_X_FACTOR = 0.95;
  const RADIUS_Y_FACTOR = 0.8;

  // Cards fade out over this many depth units immediately before
  // maxDepth, rather than popping instantly from visible to gone once
  // they cross it.
  const FADE_RANGE = 0.15;

  // Velocity and distance below which the settle spring is called done
  // and the loop parks itself.
  const REST_EPSILON = 0.0004;

  const DEFAULTS = {
    // Degrees of ring rotation per card step. Lower packs more cards into
    // view at once (denser); higher spreads them further apart and shows
    // fewer before they swing past the back.
    cardAngle: 34,
    // How big the ring is, as a multiple of the largest one that fits the
    // root's box - so 1 is "as big as the box allows" and the whole thing
    // stays responsive for free, since the box is what CSS is already
    // sizing. Below 1 draws the ring in tight around the focus; above 1
    // is deliberately not clamped, pushing cards past the box's edges for
    // a ring bigger than its own window.
    ringSize: 1,
    // The smallest a card ever shrinks to, directly behind the focus.
    minScale: 0.32,
    // Depth (0 = focus, 1 = directly behind it) beyond which a card is
    // faded out entirely - how much of the ring's far side stays
    // populated versus decluttered away.
    maxDepth: 0.92,
    // Whether the ring is a closed loop. false gives it a first and last
    // card to stop against, which also hands wheel capture back at either
    // end so page scroll continues past it (see _onWheel).
    loop: true,
    // Pixels of wheel/drag input that rotate the ring by exactly one card.
    cardStep: 140,
    wheelSensitivity: 1,
    wheelIdleDelay: 140,
    wheelEnabled: true,
    // Which wheel axis spins the ring: 'both' (whichever axis dominates a
    // given event), 'vertical' or 'horizontal'. Same control and same
    // trade-off as Dial's - see the header.
    wheelAxis: 'both',
    maxVelocity: 0.4,
    friction: 0.8,
    snapStrength: 0.045,
    // Pixels of pointer travel before a press counts as a spin rather
    // than a click.
    dragThreshold: 6,
    // Whether clicking a card that isn't in focus brings it there (and
    // swallows that click). The focused card always passes its clicks
    // through regardless, so its own links keep working.
    clickToSelect: true,
    // Milliseconds between automatic steps; 0 is off. Paused while
    // hovered, dragged, off screen, in a hidden tab, or under
    // prefers-reduced-motion.
    autoplay: 0,
    // What autoplay does on reaching the last card with `loop` off:
    // 'rewind' (spool back through the ring to the first), 'bounce'
    // (ping-pong a card per beat), 'jump' (cut back to the first after one
    // beat) or 'stop' (park there). Ignored entirely while looping, which
    // has no last card. See createAutoplay in shared/carousel-kit.js.
    autoplayEnd: 'rewind',
  };

  class Reel {
    constructor(root, options = {}) {
      if (!root) throw new Error('Reel: root element is required');
      injectStyles();
      this.root = root;
      this.track = root.querySelector('.reel-track');
      this.options = { ...DEFAULTS, ...options };

      this._pos = 0;
      this._velocity = 0;
      // A sticky settle target set by to()/step()/click-to-select, in the
      // same units as _pos; null means "the nearest card".
      this._target = null;
      this._cards = [];
      this._maxIndex = 0;
      this._width = root.clientWidth;
      this._height = root.clientHeight;
      this._cardWidth = 0;
      this._cardHeight = 0;
      this._radiusX = 0;
      this._radiusY = 0;
      this._dragging = false;
      this._dragStartX = 0;
      this._dragStartPos = 0;
      this._dragMoved = 0;
      this._dragPrevPos = 0;
      this._wheelActive = false;
      this._wheelIdleTimer = null;
      // Whether the pointer is over the ring at all. Nothing moves on it -
      // it only holds autoplay still while someone is reading.
      this._hovering = false;
      // -1 so the very first settle (including index 0) always fires.
      this._settledIndex = -1;
      this._focusedIndex = -1;
      // Remembers the focused card across page loads within the same tab.
      this._memory = createIndexMemory(root, 'reel');
      this._restored = false;

      // Every reason a self-turning ring should hold still, handed to the
      // shared timer: the pointer resting on it, a spin already in
      // progress, and the two "nobody is looking" cases.
      this._auto = createAutoplay(this, {
        blocked: () => !this._onScreen || this._hovering || document.hidden
          || this._dragging || this._wheelActive,
        looping: () => !!this.options.loop,
      });

      this._onWheel = this._onWheel.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onClickCapture = this._onClickCapture.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onEnter = this._onEnter.bind(this);
      this._onLeave = this._onLeave.bind(this);
      this._onVisibility = this._onVisibility.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);

      this.root.addEventListener('wheel', this._onWheel, { passive: false });
      this.root.addEventListener('pointerdown', this._onPointerDown);
      this.root.addEventListener('keydown', this._onKeyDown);
      this.root.addEventListener('pointerenter', this._onEnter);
      this.root.addEventListener('pointerleave', this._onLeave);
      this.track.addEventListener('click', this._onClickCapture, true);
      document.addEventListener('visibilitychange', this._onVisibility);
      // A ResizeObserver on the root rather than a window resize listener.
      // The element's size doesn't only change when the viewport does - a
      // sidebar opening, a container query, a font finally loading, or
      // anything sized off its container all resize it with no resize
      // event at all, and the geometry derived here would silently go
      // stale until the window happened to change. The observer also
      // covers the window case, so it replaces that listener outright.
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this.root);

      if (!this.root.hasAttribute('tabindex')) this.root.tabIndex = 0;
      if (!this.root.hasAttribute('role')) this.root.setAttribute('role', 'group');

      // Stop the loop once the track has scrolled out of view, same
      // reasoning (and rootMargin) as Dial/Sweep/Fireflies.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (!on) this._stop();
        else if (this._needsLoop()) this._start();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.root);

      this.refresh();
    }

    // Re-reads which cards are visible (e.g. after a filter change) and
    // jumps back to the first one - call after hiding/showing cards. The
    // very first call (from the constructor) instead restores whatever
    // card was last focused, if one was persisted (see this._memory).
    refresh() {
      this._cards = Array.from(this.track.children).filter((el) => !el.hidden);
      this._maxIndex = Math.max(0, this._cards.length - 1);
      this._measure();

      let startIndex = 0;
      if (!this._restored) {
        this._restored = true;
        const stored = this._memory.read();
        if (stored !== null && this._cards.length > 0) startIndex = mod(stored, this._cards.length);
      }

      this._pos = startIndex;
      this._velocity = 0;
      this._target = null;
      this._settledIndex = -1;
      this._focusedIndex = -1;
      if (this._cards.length > 0) this._setSettledIndex(startIndex);
      this._render();
      this._auto.reset();
    }

    // Merges new option values in. Everything positional is derived from
    // the options on the way through, and the loop parks itself when the
    // ring is still, so a live change has to be remeasured and redrawn
    // rather than waiting for the next frame that happens to run.
    update(options = {}) {
      Object.assign(this.options, options);
      this._measure();
      this._render();
      this._auto.sync();
      this._start();
    }

    // The focused card's index - the one at rest in the center - or -1 on
    // an empty ring.
    get index() {
      if (this._cards.length === 0) return -1;
      return mod(Math.round(this._pos), this._cards.length);
    }

    // How many cards are on the ring.
    get length() {
      return this._cards.length;
    }

    // The ring's actual radii in pixels, after fitting and scaling, so a
    // caller showing the size can report what's really being drawn rather
    // than what was asked for.
    get radiusX() {
      return this._radiusX || 0;
    }

    get radiusY() {
      return this._radiusY || 0;
    }

    // Spins the ring by `count` cards. A nudge to the settle spring, not a
    // queued step: several in a row blend into one spin rather than
    // playing out one by one.
    step(direction = 1, count = 1) {
      const n = this._cards.length;
      if (n < 2 || !count) return;
      const delta = Math.sign(direction) * Math.abs(count);
      const base = this._target === null ? Math.round(this._pos) : this._target;
      this._target = this.options.loop
        ? base + delta
        : clamp(base + delta, 0, this._maxIndex);
      this._start();
    }

    // Brings `index` into focus - by the shortest way round while looping,
    // resolved against the current unbounded position so a ring that has
    // been spun several laps doesn't unwind them all to "arrive from the
    // front". An index outside the ring wraps round it while looping and
    // stops at the nearer end when not - see resolveIndex in
    // shared/carousel-kit.js.
    to(index) {
      const n = this._cards.length;
      if (n < 2) return;
      const target = resolveIndex(index, n, this.options.loop);
      this._target = this.options.loop
        ? this._pos + wrapDelta(target - this._pos, n)
        : target;
      this._start();
    }

    // Puts `index` in focus at once, with no spin at all - the cut to
    // to()'s travelling shot. The ring lands dead on the card, so the
    // settle event and the persisted position both fire from here just as
    // they would at the end of a spin.
    jump(index) {
      const n = this._cards.length;
      if (n === 0) return;
      const target = resolveIndex(index, n, this.options.loop);
      this._pos = target;
      this._velocity = 0;
      this._target = null;
      this._stop();
      this._render();
      this._setSettledIndex(target);
    }

    // ----- geometry -----

    _onResize() {
      this._measure();
      this._render();
    }

    // Reads the natural (unscaled) card box and the track's own box, then
    // derives how far the ring's radii can reach while still leaving the
    // focused card room to sit at full size inside the track. `ringSize`
    // scales that fit, and is deliberately not clamped above 1 - a ring
    // wider than its own window is a legitimate look, not a mistake.
    _measure() {
      this._width = this.root.clientWidth;
      this._height = this.root.clientHeight;
      const card = this._cards[0];
      if (!card) return;
      this._cardWidth = card.offsetWidth;
      this._cardHeight = card.offsetHeight;
      const ring = Math.max(0, this.options.ringSize);
      this._radiusX = Math.max(0, (this._width - this._cardWidth) / 2) * RADIUS_X_FACTOR * ring;
      this._radiusY = Math.max(0, (this._height - this._cardHeight) / 2) * RADIUS_Y_FACTOR * ring;
    }

    // ----- input -----

    _onWheel(event) {
      const o = this.options;
      if (!o.wheelEnabled || this._cards.length < 2) return;
      // Each event is assigned to whichever axis dominates it, then kept
      // or passed through depending on wheelAxis - Dial's rule exactly. A
      // trackpad produces both axes and a mouse wheel only ever deltaY,
      // so 'both' is what makes one ring work for either.
      const isVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);
      if (isVertical ? o.wheelAxis === 'horizontal' : o.wheelAxis === 'vertical') return;

      // Down and right both read as forward, so the two axes agree about
      // which way the ring spins.
      const delta = isVertical ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const deltaIndex = (delta * o.wheelSensitivity) / o.cardStep;

      // With the loop off the ring has two ends, so wheel capture is
      // handed back at either of them exactly as Sweep's strip does: a
      // scroll that can't turn the ring any further is left completely
      // alone, and the page carries on scrolling past it. A closed loop
      // never runs out of ring, so there's no boundary to release at and
      // wheelAxis is the only thing deciding what passes through.
      if (!o.loop) {
        const atStart = this._pos <= 0.0005 && deltaIndex < 0;
        const atEnd = this._pos >= this._maxIndex - 0.0005 && deltaIndex > 0;
        if (atStart || atEnd) return;
      }

      event.preventDefault();
      this._pos += deltaIndex;
      if (!o.loop) this._pos = clamp(this._pos, 0, this._maxIndex);
      this._velocity = clamp(deltaIndex, -o.maxVelocity, o.maxVelocity);
      // A scroll overrides whatever to()/click-to-select was aiming at.
      this._target = null;
      this._wheelActive = true;
      clearTimeout(this._wheelIdleTimer);
      this._wheelIdleTimer = setTimeout(() => {
        this._wheelActive = false;
        this._start();
      }, o.wheelIdleDelay);
      this._start();
    }

    _onPointerDown(event) {
      if (this._cards.length < 2) return;
      this._dragging = true;
      this._dragMoved = 0;
      this._velocity = 0;
      this._target = null;
      this._dragStartX = event.clientX;
      this._dragStartPos = this._pos;
      this._dragPrevPos = this._pos;
      this.root.classList.add('is-dragging');
      global.addEventListener('pointermove', this._onPointerMove);
      global.addEventListener('pointerup', this._onPointerUp);
      global.addEventListener('pointercancel', this._onPointerUp);
      this._start();
    }

    _onPointerMove(event) {
      if (!this._dragging) return;
      const dx = event.clientX - this._dragStartX;
      this._dragMoved = Math.max(this._dragMoved, Math.abs(dx));
      // Unclamped while looping - a reel just keeps spinning in either
      // direction; stopped at the first and last card when it doesn't.
      const next = this._dragStartPos - dx / this.options.cardStep;
      this._pos = this.options.loop ? next : clamp(next, 0, this._maxIndex);
      this._velocity = this._pos - this._dragPrevPos;
      this._dragPrevPos = this._pos;
    }

    _onPointerUp() {
      if (!this._dragging) return;
      this._dragging = false;
      this.root.classList.remove('is-dragging');
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);
      this._start();
    }

    // Two jobs: suppress the click that ends a spin, and run
    // click-to-select. The focused card is left entirely alone, so its own
    // links and buttons work normally - the rule being "bring it to the
    // front, then use it", same as Dial's gate.
    _onClickCapture(event) {
      if (this._dragMoved > this.options.dragThreshold) {
        event.preventDefault();
        event.stopPropagation();
        this._dragMoved = 0;
        return;
      }
      this._dragMoved = 0;
      if (!this.options.clickToSelect || this._cards.length < 2) return;
      const card = event.target.closest('.reel-card');
      if (!card) return;
      const index = this._cards.indexOf(card);
      if (index === -1 || index === this.index) return;
      event.preventDefault();
      event.stopPropagation();
      this.to(index);
    }

    _onKeyDown(event) {
      // A card can hold anything, text fields included, and spinning the
      // ring out from under a caret is not what the arrow keys mean there.
      if (ownsArrowKeys(event.target)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.step(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.step(-1);
      }
    }

    // The pointer being over the ring moves nothing by itself - this pair
    // exists only so autoplay holds still while someone is reading it.
    _onEnter() {
      this._hovering = true;
    }

    _onLeave() {
      this._hovering = false;
    }

    // Beats are already blocked while the tab is hidden, so this isn't what
    // stops the ring turning out of sight. It's the interval that needs the
    // attention: a hidden tab throttles it to roughly once a minute, so
    // rebuilding it here is what gives the first beat after the tab comes
    // back a full interval rather than whatever the throttle left. See
    // sync() in shared/carousel-kit.js.
    _onVisibility() {
      this._auto.sync();
    }

    // ----- loop -----

    _settleTarget() {
      if (this._target !== null) return this._target;
      const nearest = Math.round(this._pos);
      return this.options.loop ? nearest : clamp(nearest, 0, this._maxIndex);
    }

    // Whether the settle spring has arrived. One predicate, used both to
    // finalize the settle in _tick and to decide in _needsLoop whether the
    // loop keeps running - and they have to be the same test. When they
    // were two separate comparisons the loop could quit a hair short of the
    // card: _tick would integrate, the loop's own exit check would then see
    // a ring close enough to call it still and cancel itself, and the
    // branch that lands exactly on the card never ran. Position stayed at
    // 1.0003 instead of 1 (invisible), but 'reel-settle' and the persisted
    // index were never written at all (not invisible).
    _atRest(target) {
      return Math.abs(this._velocity) <= REST_EPSILON
        && Math.abs(target - this._pos) <= REST_EPSILON;
    }

    // The loop parks whenever the ring is genuinely still - there's
    // nothing to animate between spins.
    _needsLoop() {
      if (this._dragging || this._wheelActive) return true;
      if (this._cards.length === 0) return false;
      return !this._atRest(this._settleTarget());
    }

    _start() {
      if (this._raf || !this._onScreen || !this._needsLoop()) return;
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    _tick() {
      const n = this._cards.length;
      const settling = !this._dragging && !this._wheelActive;
      if (settling && n > 0) {
        const target = this._settleTarget();
        this._velocity += (target - this._pos) * this.options.snapStrength;
        this._velocity *= this.options.friction;
        this._pos += this._velocity;
        if (!this.options.loop) this._pos = clamp(this._pos, 0, this._maxIndex);
        // Arrived: land exactly on the card rather than a hair off it, and
        // report it. Tested after integrating, so this sees the same state
        // _needsLoop is about to see when it decides whether to schedule
        // another frame - see _atRest.
        if (this._atRest(target)) {
          this._velocity = 0;
          this._pos = target;
          this._target = null;
          this._setSettledIndex(mod(Math.round(this._pos), n));
        }
      }
      this._render();

      if (this._needsLoop()) this._raf = requestAnimationFrame(this._tick);
      else this._raf = null;
    }

    _render() {
      const n = this._cards.length;
      if (n === 0) return;
      const { cardAngle, minScale, maxDepth, loop } = this.options;
      const fadeStart = Math.max(0, maxDepth - FADE_RANGE);
      const fadeSpan = Math.max(0.0001, maxDepth - fadeStart);
      const focused = mod(Math.round(this._pos), n);

      this._cards.forEach((card, i) => {
        // Signed distance in card-index units from the current position to
        // this card. Looping takes the *shortest* way round, wrapping at
        // the card count - e.g. with 8 cards, index 0 is 1 step from index
        // 7, not 7 steps the long way. Without the loop it's the plain
        // distance, so cards far ahead of or behind the focus stay far
        // away rather than reappearing on the other side.
        const delta = loop ? wrapDelta(i - this._pos, n) : i - this._pos;
        // theta is this card's angle away from the focus point. Clamped
        // to +/-180deg (not just left to run past it) so a dense ring -
        // many cards, or a high cardAngle - never overshoots past the one
        // point directly behind the focus; cards beyond that pile up
        // there instead of swinging back round the wrong side.
        const thetaDeg = clamp(delta * cardAngle, -180, 180);
        const theta = thetaDeg * (Math.PI / 180);
        // Depth drives scale and opacity only: 0 at the focus (theta = 0),
        // 1 directly behind it (theta = +/-180deg) - a gentle, gradual
        // falloff by angle.
        const depth = (1 - Math.cos(theta)) / 2;
        const scale = 1 - (1 - minScale) * depth;

        // Position uses a *different* radial factor than scale/opacity -
        // ramp, linear in index distance, reaching full ring radius by one
        // card-step away and staying there for every card beyond. Using
        // `depth` for position too (as a single cardioid radius) was the
        // first pass here, and it looked right in principle, but
        // `x = depth * radiusX * sin(theta)` is tangent to zero right at
        // the focus regardless of depth's own shape - sin(theta) itself
        // vanishes linearly there, so close neighbors ended up sitting
        // almost exactly behind the focused card instead of beside it,
        // hidden rather than forming a visible ring. Ramping to full
        // radius immediately (rather than growing it out from zero the
        // same way scale/opacity do) means every card except the one
        // actually mid-transition sits at a constant distance from
        // center, varying only by angle - a real ring - and only the
        // settling card itself interpolates smoothly inward as it
        // approaches focus.
        const ramp = clamp(Math.abs(delta), 0, 1);
        const x = ramp * this._radiusX * Math.sin(theta);
        const y = ramp * this._radiusY * Math.cos(theta);

        const opacity = depth > fadeStart
          ? 1 - clamp((depth - fadeStart) / fadeSpan, 0, 1)
          : 1;

        card.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px)) scale(${scale.toFixed(3)})`;
        card.style.opacity = opacity.toFixed(3);
        card.style.pointerEvents = opacity < 0.03 ? 'none' : '';
        card.style.zIndex = Math.round(1000 - Math.abs(delta) * 10);
      });

      if (focused !== this._focusedIndex) {
        const previous = this._cards[this._focusedIndex];
        if (previous) previous.classList.remove('is-focused');
        const current = this._cards[focused];
        if (current) current.classList.add('is-focused');
        this._focusedIndex = focused;
      }
    }

    // ----- settle / persistence -----

    // Fires a 'reel-settle' event (bubbling) on the card at `index` once
    // it's the one actually at rest in focus - not on every card passed
    // through while moving. See sweep-settle for the full rationale. The
    // is-focused class is the live counterpart: it tracks whichever card
    // is nearest the focus even mid-spin, where this doesn't.
    _setSettledIndex(index) {
      if (index === this._settledIndex) return;
      this._settledIndex = index;
      this._memory.write(index);
      const card = this._cards[index];
      if (card) card.dispatchEvent(new CustomEvent('reel-settle', { bubbles: true }));
    }

    destroy() {
      this._stop();
      this._intersectionObserver.disconnect();
      clearTimeout(this._wheelIdleTimer);
      this._auto.destroy();
      this.root.removeEventListener('wheel', this._onWheel);
      this.root.removeEventListener('pointerdown', this._onPointerDown);
      this.root.removeEventListener('keydown', this._onKeyDown);
      this.root.removeEventListener('pointerenter', this._onEnter);
      this.root.removeEventListener('pointerleave', this._onLeave);
      this.track.removeEventListener('click', this._onClickCapture, true);
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._resizeObserver.disconnect();
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);
    }
  }

  // next/prev/first/last/play/pause/playing - the derivations of step, to
  // and the autoplay controller above, written once in the kit for all
  // four carousels.
  addCommonApi(Reel.prototype);

  Reel.DEFAULTS = DEFAULTS;

  global.Reel = Reel;

  registerEffect(Reel, {
    slug: 'reel',
    selector: '.reel:not(.is-empty)',
    prepare: injectStyles,
  });
})(window);
