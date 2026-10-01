/**
 * Dial
 * ----
 * The View-Master reel itself - the cardboard disc you push into the
 * viewer - rather than the viewer. Cards are mounted radially around a
 * disc whose center sits at the bottom of the box, so what you see is the
 * top half of the reel: a fan of cards arcing over, each one tilted to
 * point outward from the hub, cropped where the disc runs out of window.
 * Twelve o'clock is the gate. Whatever card is standing there is the
 * selected one, and because a radially-mounted card is only upright at
 * the top of its arc, the selected card is also the only one the right
 * way up - the mechanism does the highlighting for free.
 *
 * This is the third take on the same toy in this category and the
 * distinction is purely which thing you're looking at. Reel watches a
 * ring of upright cards orbit a focus point from outside and never tilts
 * any of them. Deck's `stereoscope` transition puts you at the eyepiece,
 * where one frame at a time swings through a masked window. Dial hands
 * you the disc itself.
 *
 * Because every card is rigidly mounted to one disc, its angle is the
 * whole of its state: `theta = (i - pos) * cardAngle`, and position
 * (`radius * sin/cos theta`), tilt, opacity and scale all read off that
 * single number. `cardAngle` defaults to 26deg, which puts 14 cards
 * around a closed disc with 7 of them above the horizon at once - a real
 * View-Master reel's 14 frames, 7 to a view. The disc's radius defaults
 * to whatever fits the box (`min(width / 2, pivot height)`), so CSS
 * sizing the element is normally all it takes and the whole thing stays
 * responsive for free; `radius` overrides that when the number itself
 * matters. Each card's own ring radius is then derived from its own
 * measured height, so a disc can carry a mix of card sizes and every one
 * of them still sits `rimInset` short of the rim.
 *
 * Input is rotational, which is the real departure from the others.
 * Sweep, Reel and Deck all read a *linear* drag - pixels across,
 * converted to cards. A disc doesn't work that way: grabbing it anywhere
 * and moving the pointer turns it by the angle swept around the hub, 1:1,
 * so the card under your finger stays under your finger wherever on the
 * face you grabbed it. Deltas are accumulated per pointer-move rather
 * than measured from the press, so dragging back across the hub - where
 * the angle is undefined and flips - doesn't throw the disc a half turn
 * (see _onPointerMove). Releasing hands the remaining angular velocity to
 * the same damped spring Sweep and Reel coast on, which always settles
 * exactly on a card.
 *
 * Clicking is the other way through: a click on a card that isn't
 * selected spins it up to the gate by the shortest way round and is
 * swallowed; a click on the card already at the gate passes straight
 * through to whatever is inside it. So a card full of links behaves like
 * "bring it to the front, then use it" rather than needing a separate
 * control.
 *
 * The wheel takes whichever axis dominates an event, governed by
 * `wheelAxis`, and defaults to accepting both - the same control, the
 * same default and the same trade-off as Reel's. A mouse wheel reports
 * nothing but deltaY, so horizontal-only (which is what Sweep does, and
 * what Deck's `wheel: 'x'` does) means the wheel is dead for anyone not
 * on a trackpad. The cost of taking deltaY is that it has to be
 * preventDefault'd, which stops the page scrolling while the pointer is
 * over the disc, and a closed loop has no boundary at which to hand that
 * back the way Sweep's strip does. `wheelAxis: 'horizontal'` buys the
 * never-interferes behavior back for anyone who wants it.
 *
 * Usage: wrap cards in `<div class="dial"><div class="dial-face">
 * <div class="dial-card">...</div>...</div></div>`, then load this file -
 * it injects the structural CSS and auto-initializes against every
 * `.dial:not(.is-empty)` on the page, drawing the reel's rim, hub and
 * gate itself (they're parts of the object, not content). The host
 * supplies the box's own size and the cards' size and chrome. A box
 * around 2:1 gives the default half-circle its room; `pivot` moves the
 * hub up or down from there, down to showing the whole disc at once. Add
 * `.is-empty` to keep a lab's shelf on the page before its first card.
 */
(function (global) {
  // See shared/carousel-kit.js - the arithmetic, the per-tab memory of
  // which card was selected, and the initAll/get/getAll surface that all
  // four carousels here share. Already bundled into the file this URL
  // serves, so there is nothing extra to load.
  const {
    clamp, mod, wrapDelta, wrapAngle, ownsArrowKeys, createIndexMemory, registerEffect,
  } = global.CarouselKit;

  const STYLE_ID = 'dial-styles';

  const CSS = `
.dial {
  /* Makes this element a container-query context, so the host can size
     cards in cqw units and have them track the dial's own width rather
     than the viewport's. Nothing here scales cards automatically - that
     stays the host's CSS - but without this there is no unit that
     follows this box, and fixed-px cards on a fluid dial crowd together
     as it shrinks. Costs nothing when unused. */
  container-type: inline-size;
  --dl-pivot: 100%;
  --dl-line: currentColor;
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.dial.is-dragging { cursor: grabbing; }
.dial.is-empty { cursor: default; }
.dial-face {
  position: absolute;
  inset: 0;
}
.dial-empty {
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
.dial-card {
  position: absolute;
  left: 50%;
  top: 50%;
  will-change: transform, opacity;
}
.dial-card[hidden] { display: none; }

/* The reel body. All three are sized and placed from JS off the measured
   disc, and all three are inert - the face above them takes every
   pointer event. */
.dial-rim,
.dial-hub,
.dial-gate {
  position: absolute;
  pointer-events: none;
}
.dial-rim {
  border: 1px solid var(--dl-line);
  border-radius: 50%;
  opacity: 0.22;
}
.dial-hub {
  border: 1px solid var(--dl-line);
  border-radius: 50%;
  opacity: 0.45;
}
/* The reel's center hole. */
.dial-hub::after {
  content: '';
  position: absolute;
  inset: 32%;
  border: 1px solid var(--dl-line);
  border-radius: 50%;
}
/* The index mark at twelve o'clock, sitting in the margin between the
   rim and the cards' outer edge. */
.dial-gate {
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 7px solid var(--dl-line);
  opacity: 0.75;
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Hub radius, as a fraction of the disc's, with a floor so it stays
  // visible on a small dial.
  const HUB_FACTOR = 0.13;
  const HUB_MIN = 16;

  // A pointer this close to the hub (as a fraction of the disc radius)
  // has no meaningful angle around it, so drag deltas from inside this
  // radius are ignored rather than amplified into a spin.
  const DEAD_ZONE = 0.1;

  // Any single pointer-move that appears to sweep more than this many
  // degrees is a jump across the hub, not a turn of the disc - see
  // _onPointerMove.
  const MAX_MOVE_DEGREES = 90;

  // Velocity and distance below which the settle spring is called done
  // and the loop parks itself.
  const REST_EPSILON = 0.0004;

  // The three parts of the reel body the component draws for itself:
  // instance property, class name, and the option that turns it on. One
  // table so that building them and tearing them back down can't drift
  // apart - see _buildChrome.
  const CHROME_PARTS = [
    ['_rim', 'dial-rim', 'rim'],
    ['_hub', 'dial-hub', 'hub'],
    ['_gate', 'dial-gate', 'gate'],
  ];

  const DEFAULTS = {
    // Degrees of disc between one card and the next. 26 puts 14 cards
    // around a closed disc with 7 above the horizon at once, which is a
    // real View-Master reel. Lower packs more cards into the visible arc.
    //
    // Cards sit apart only while the chord between neighbors clears their
    // width - 2 * ringRadius * sin(cardAngle / 2) >= card width. Below
    // that they shingle, which is a legitimate look (a fanned deck, the
    // z-order stacking outward from the gate) rather than a failure, so
    // it isn't prevented. It does mean card size has to come down with
    // the disc: lifting `pivot` to show more of the face shrinks the disc
    // to fit the box, and cards sized for a half circle will then pile
    // over the hub.
    cardAngle: 26,
    // Where the disc's center sits, as a fraction of the box height. 1
    // puts it exactly on the bottom edge, so precisely half the disc is
    // in view; below 1 lifts it into the box and shows more than half;
    // above 1 drops it away for a shallower arc.
    pivot: 1,
    // The disc's radius in pixels. null (or 0) fits it to the box -
    // min(width / 2, pivot height) - which is what keeps it responsive,
    // since the box is the thing CSS is already sizing. A number takes
    // over from that and is not clamped to the box, so a disc larger than
    // its own window is allowed: the root clips, leaving a shallow slice
    // of something big.
    radius: null,
    // Space between a card's outer edge and the rim. In pixels, except
    // that a value below 1 is read as a fraction of the disc's radius -
    // which is what keeps the layout proportional on a fluid dial, since
    // a fixed pixel margin takes a bigger and bigger bite out of a
    // shrinking disc. The cards' ring radius is derived from this and
    // their own height, so they stay seated against the rim at any size.
    rimInset: 20,
    // How much bigger a card is once it reaches the gate. Interpolated
    // over the last card-step of its approach rather than switched on at
    // the end, so nothing pops.
    selectedScale: 1.14,
    // Degrees from the gate at which a card has faded out completely.
    // Below the hub's own level by default: with the hub on the bottom
    // edge, a card much past 80deg is being cut in half by the window,
    // and a half-card at full strength reads as a clipping bug rather
    // than as the disc continuing past the frame.
    horizon: 84,
    // Degrees over which it fades, ending at horizon.
    fadeRange: 36,
    // Pixels of wheel delta that turn the disc by exactly one card.
    cardStep: 120,
    wheelSensitivity: 1,
    wheelIdleDelay: 140,
    wheelEnabled: true,
    // Which wheel axis turns the disc: 'vertical', 'horizontal' or
    // 'both' (whichever axis dominates a given event).
    //
    // 'both' by default, same as Reel, because a mouse wheel only ever
    // reports deltaY - horizontal-only silently leaves the wheel dead for
    // everyone not on a trackpad.
    // The cost is that taking the vertical axis means calling
    // preventDefault on it, so the page stops scrolling while the
    // pointer is over the disc. A disc is a closed loop with no end to
    // release capture at, so there's no boundary that hands it back the
    // way Sweep's strip does - moving the pointer off is the only
    // escape. 'horizontal' restores the never-interferes behavior for
    // anyone who'd rather have that than a working mouse wheel.
    wheelAxis: 'both',
    maxVelocity: 0.4,
    friction: 0.86,
    snapStrength: 0.055,
    // Pixels of pointer travel before a press counts as a turn rather
    // than a click.
    dragThreshold: 6,
    // Whether clicking a card that isn't at the gate brings it there
    // (and swallows that click). The card already at the gate always
    // passes its clicks through regardless.
    clickToSelect: true,
    rim: true,
    hub: true,
    gate: true,
  };

  class Dial {
    constructor(root, options = {}) {
      if (!root) throw new Error('Dial: root element is required');
      injectStyles();
      this.root = root;
      this.face = root.querySelector('.dial-face');
      if (!this.face) throw new Error('Dial: root must contain a .dial-face');
      this.options = { ...DEFAULTS, ...options };

      // Disc position in cards. Continuous and never clamped - a disc has
      // no end to run into, so spin it as many turns as you like.
      this._pos = 0;
      this._velocity = 0;
      // A sticky settle target set by to()/click-to-select, in the same
      // unbounded units as _pos; null means "the nearest card".
      this._target = null;
      this._cards = [];
      // Derived geometry, all of it re-read in _measure. Seeded to zero
      // rather than left undefined because _measure bails on a box that
      // measures 0x0 - a dial built inside a `display: none` container -
      // and a render against undefined would compose NaN into every
      // transform. At zero the cards simply stack on the hub until the
      // ResizeObserver reports a real box and the geometry is derived
      // properly.
      this._pivotY = 0;
      this._radius = 0;
      this._hubOffsetY = 0;
      this._rimInset = 0;
      this._ringRadius = 0;
      this._dragging = false;
      this._dragMoved = 0;
      this._lastAngle = 0;
      this._wheelActive = false;
      this._wheelIdleTimer = null;
      // -1 so the very first settle (including card 0) always fires.
      this._settledIndex = -1;
      this._selectedIndex = -1;
      // Remembers the selected card across page loads within the same tab.
      this._memory = createIndexMemory(root, 'dial');
      this._restored = false;

      this._onWheel = this._onWheel.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onClickCapture = this._onClickCapture.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);

      this.root.addEventListener('wheel', this._onWheel, { passive: false });
      this.root.addEventListener('pointerdown', this._onPointerDown);
      this.root.addEventListener('keydown', this._onKeyDown);
      this.face.addEventListener('click', this._onClickCapture, true);
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

      // Stop the loop once the disc has scrolled out of view, same
      // reasoning (and rootMargin) as Reel/Sweep/Fireflies.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (!on) this._stop();
        else if (this._needsLoop()) this._start();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.root);

      this._buildChrome();
      this.refresh();
    }

    // Re-reads which cards are on the disc (anything .dial-card and not
    // `hidden`) and brings card 0 to the gate. The very first call - from
    // the constructor - instead restores whatever card was last selected,
    // if one was persisted.
    refresh() {
      this._cards = Array.from(this.face.children)
        .filter((el) => el.classList.contains('dial-card') && !el.hidden);

      let startIndex = 0;
      if (!this._restored) {
        this._restored = true;
        const stored = this._memory.read();
        if (stored !== null && this._cards.length > 0) {
          startIndex = mod(stored, this._cards.length);
        }
      }

      this._pos = startIndex;
      this._velocity = 0;
      this._target = null;
      this._settledIndex = -1;
      this._selectedIndex = -1;
      this._measure();
      if (this._cards.length > 0) this._setSettledIndex(startIndex);
      this._render();
    }

    // Merges new option values in. cardAngle/pivot/rimInset/selectedScale
    // all feed the derived geometry and rim/hub/gate decide which parts
    // exist, so both get redone here.
    update(options = {}) {
      Object.assign(this.options, options);
      this._buildChrome();
      this._measure();
      this._render();
    }

    // The disc's actual radius in pixels, after fitting or clamping - so
    // a caller showing the size can report what's really being drawn
    // rather than what was asked for.
    get radius() {
      return this._radius;
    }

    // The largest radius that still keeps the gate on screen, which is
    // simply how far the hub sits below the top of the box. A UI offering
    // a size control wants this as its ceiling: it moves with `pivot`, so
    // pushing the hub down genuinely buys room for a bigger disc rather
    // than the control going dead partway along.
    get maxRadius() {
      return this._pivotY;
    }

    // The selected card's index - the one standing at the gate - or -1 on
    // an empty disc.
    get index() {
      if (this._cards.length === 0) return -1;
      return mod(Math.round(this._pos), this._cards.length);
    }

    // Turns the disc by `count` cards. A nudge to the settle spring rather
    // than a queued step: several in a row blend into one turn rather than
    // playing out one by one. (Deck is the one that queues, because a
    // frame change is a discrete move with a duration.)
    step(direction = 1, count = 1) {
      const n = this._cards.length;
      if (n < 2 || !count) return;
      const delta = Math.sign(direction) * Math.abs(count);
      this._target = (this._target === null ? Math.round(this._pos) : this._target) + delta;
      this._start();
    }

    // Brings `index` to the gate by the shortest way round - resolved
    // against the current unbounded position so a disc that has been spun
    // several turns doesn't unwind them all to "arrive from the front".
    to(index) {
      const n = this._cards.length;
      if (n < 2) return;
      this._target = this._pos + wrapDelta(mod(index, n) - this._pos, n);
      this._start();
    }

    // ----- the reel body -----

    // Creates or removes each drawn part to match the options. `wanted:
    // false` forces all of them off regardless, which is how destroy()
    // takes back the DOM this instance added.
    _buildChrome(wanted = true) {
      CHROME_PARTS.forEach(([key, className, option]) => {
        this._chrome(key, className, wanted && this.options[option]);
      });
    }

    // Creates or removes one of the drawn parts. They go before .dial-face
    // so the cards (and the face's own pointer handling) stay above them.
    _chrome(key, className, wanted) {
      if (wanted && !this[key]) {
        const el = document.createElement('div');
        el.className = className;
        el.setAttribute('aria-hidden', 'true');
        this.root.insertBefore(el, this.face);
        this[key] = el;
      } else if (!wanted && this[key]) {
        this[key].remove();
        this[key] = null;
      }
    }

    // ----- geometry -----

    _onResize() {
      this._measure();
      this._render();
    }

    // Everything positional is derived here off the measured box and the
    // host's own card size. The disc is as big as the box allows: half its
    // width, or the height down to the hub, whichever runs out first.
    _measure() {
      const o = this.options;
      const width = this.root.clientWidth;
      const height = this.root.clientHeight;
      if (width === 0 || height === 0) return;

      this._pivotY = height * o.pivot;
      // Fitted by default, so CSS sizing the box is all it takes. An
      // explicit radius overrides that, and is clamped vertically but not
      // horizontally: wider than the box is fine and gives the useful
      // look (a shallow slice of something huge, cropped at the sides),
      // but taller than the hub is above it would lift the whole gate off
      // the top of the box and leave the selected card invisible. Going
      // genuinely bigger means pushing `pivot` down to make room, which
      // raises this ceiling with it.
      const fitted = Math.max(0, Math.min(width / 2, this._pivotY));
      this._radius = o.radius > 0 ? Math.min(o.radius, this._pivotY) : fitted;
      // Cards are positioned from the box's center (that's where the CSS
      // parks them), so the hub is carried as an offset from there.
      this._hubOffsetY = this._pivotY - height / 2;

      // Every card gets its own distance from the hub, worked out from its
      // own height, so a disc can carry a mix of sizes and each card still
      // sits flush against the rim with rimInset to spare. (A single
      // shared ring radius measured off one card would seat that card and
      // leave every differently-sized one floating short of the rim or
      // hanging over it.) Measured at the card's *selected* size rather
      // than its resting one, so growing into the gate never eats the
      // margin, or runs over the index mark sitting in it.
      //
      // rimInset below 1 is read as a fraction of the radius rather than
      // as pixels, which is what makes the whole layout scale-invariant:
      // a fixed pixel margin eats proportionally more of a shrinking
      // disc, pulling the ring in faster than cards sized in cqw shrink,
      // until neighbors that cleared each other at full size overlap.
      // (A sub-pixel margin is meaningless, so nothing useful is lost to
      // the ambiguity.)
      const rimInset = o.rimInset > 0 && o.rimInset < 1
        ? this._radius * o.rimInset
        : Math.max(0, o.rimInset);
      this._rimInset = rimInset;
      const selectedScale = Math.max(1, o.selectedScale);
      this._cards.forEach((card) => {
        const reach = (card.offsetHeight * selectedScale) / 2;
        card.__dialRadius = Math.max(0, this._radius - rimInset - reach);
      });
      // Card 0's, kept as the representative figure for anything that
      // wants one number for the ring.
      this._ringRadius = this._cards.length > 0 ? this._cards[0].__dialRadius : 0;

      const left = width / 2;
      if (this._rim) {
        const d = this._radius * 2;
        setBox(this._rim, left - this._radius, this._pivotY - this._radius, d, d);
      }
      if (this._hub) {
        const hub = Math.max(HUB_MIN, this._radius * HUB_FACTOR);
        setBox(this._hub, left - hub, this._pivotY - hub, hub * 2, hub * 2);
      }
      if (this._gate) {
        // Centered in the rim margin the cards leave free, and only drawn
        // where there's actually room for it.
        const mark = Math.min(7, Math.max(0, rimInset - 6));
        this._gate.style.borderTopWidth = `${mark}px`;
        this._gate.style.left = `${(left - 5).toFixed(1)}px`;
        this._gate.style.top = `${(this._pivotY - this._radius + (rimInset - mark) / 2).toFixed(1)}px`;
        this._gate.style.display = mark > 1 ? '' : 'none';
      }
    }

    // ----- input -----

    _onWheel(event) {
      if (!this.options.wheelEnabled || this._cards.length < 2) return;
      // Each event is assigned to whichever axis dominates it, then kept
      // or passed through depending on wheelAxis. A trackpad produces
      // both axes and a mouse wheel only ever deltaY, so 'both' is what
      // makes one dial work for either.
      const axis = this.options.wheelAxis;
      const isVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);
      if (isVertical ? axis === 'horizontal' : axis === 'vertical') return;

      // Down and right both read as forward, so the two axes agree about
      // which way the disc turns.
      const delta = isVertical ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      event.preventDefault();

      const deltaIndex = (delta * this.options.wheelSensitivity) / this.options.cardStep;
      this._pos += deltaIndex;
      this._velocity = clamp(deltaIndex, -this.options.maxVelocity, this.options.maxVelocity);
      this._target = null;

      this._wheelActive = true;
      clearTimeout(this._wheelIdleTimer);
      this._wheelIdleTimer = setTimeout(() => {
        this._wheelActive = false;
        this._start();
      }, this.options.wheelIdleDelay);
      this._start();
    }

    _onPointerDown(event) {
      if (this._cards.length < 2) return;
      const angle = this._angleAt(event);
      if (angle === null) return;
      this._dragging = true;
      this._dragMoved = 0;
      this._velocity = 0;
      this._target = null;
      this._lastAngle = angle;
      this._dragStart = { x: event.clientX, y: event.clientY };
      this.root.classList.add('is-dragging');
      global.addEventListener('pointermove', this._onPointerMove);
      global.addEventListener('pointerup', this._onPointerUp);
      global.addEventListener('pointercancel', this._onPointerUp);
      this._start();
    }

    _onPointerMove(event) {
      if (!this._dragging) return;
      this._dragMoved = Math.max(this._dragMoved, Math.hypot(
        event.clientX - this._dragStart.x,
        event.clientY - this._dragStart.y,
      ));

      const angle = this._angleAt(event);
      if (angle === null) return;
      // Per-move deltas, not angle-since-press. Measuring from the press
      // would be simpler but breaks the moment the pointer crosses the
      // hub, where the angle is undefined and flips by 180deg - the disc
      // would snap a half turn. Accumulating instead means a pass over the
      // hub costs one discarded frame, and MAX_MOVE_DEGREES is what
      // discards it.
      const swept = wrapAngle(angle - this._lastAngle);
      this._lastAngle = angle;
      if (Math.abs(swept) > MAX_MOVE_DEGREES) return;

      // Turning the disc clockwise raises each card's angle, which lowers
      // the position of whichever card is standing at the gate.
      const deltaIndex = -swept / Math.max(1, this.options.cardAngle);
      this._pos += deltaIndex;
      this._velocity = clamp(deltaIndex, -this.options.maxVelocity, this.options.maxVelocity);
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

    // Degrees clockwise from twelve o'clock, or null inside the hub's dead
    // zone where the angle carries no usable information.
    _angleAt(event) {
      const box = this.root.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = (box.top + this._pivotY) - event.clientY;
      if (Math.hypot(dx, dy) < this._radius * DEAD_ZONE) return null;
      return Math.atan2(dx, dy) * (180 / Math.PI);
    }

    // Two jobs: suppress the click that ends a turn, and run
    // click-to-select. A card already at the gate is left entirely alone,
    // so its own links and buttons work normally - the rule being "bring
    // it to the front, then use it".
    _onClickCapture(event) {
      if (this._dragMoved > this.options.dragThreshold) {
        event.preventDefault();
        event.stopPropagation();
        this._dragMoved = 0;
        return;
      }
      this._dragMoved = 0;
      if (!this.options.clickToSelect || this._cards.length < 2) return;
      const card = event.target.closest('.dial-card');
      if (!card) return;
      const index = this._cards.indexOf(card);
      if (index === -1 || index === this.index) return;
      event.preventDefault();
      event.stopPropagation();
      this.to(index);
    }

    _onKeyDown(event) {
      // A card can hold anything, text fields included, and turning the
      // disc out from under a caret is not what the arrow keys mean there.
      if (ownsArrowKeys(event.target)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.step(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.step(-1);
      }
    }

    // ----- loop -----

    _settleTarget() {
      return this._target === null ? Math.round(this._pos) : this._target;
    }

    // Whether the settle spring has arrived. One predicate, used both to
    // finalize the settle in _tick and to decide in _needsLoop whether the
    // loop keeps running - and they have to be the same test, or the loop
    // can quit a hair short of the card without ever running the branch
    // that lands on it and fires 'dial-settle'. See reel.js's _atRest for
    // the full account; this disc's spring tuning happens not to trip it,
    // which is exactly why it isn't left as two comparisons to drift apart.
    _atRest(target) {
      return Math.abs(this._velocity) <= REST_EPSILON
        && Math.abs(target - this._pos) <= REST_EPSILON;
    }

    // The loop parks whenever the disc is genuinely still - there's nothing
    // to animate between turns. Sweep is the one that ticks unconditionally;
    // Reel parks the same way this does.
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
      const o = this.options;
      const fadeStart = Math.max(0, o.horizon - Math.max(0.001, o.fadeRange));
      const fadeSpan = Math.max(0.001, o.horizon - fadeStart);
      const selected = mod(Math.round(this._pos), n);

      this._cards.forEach((card, i) => {
        // Shortest signed distance in cards, wrapping at the card count,
        // then the card's actual angle on the disc. Clamped at half a turn
        // so a dense disc - many cards, or a big cardAngle - piles up at
        // the point opposite the gate instead of doubling back round the
        // wrong side, exactly as Reel does.
        const delta = wrapDelta(i - this._pos, n);
        const deg = clamp(delta * o.cardAngle, -180, 180);
        const theta = deg * (Math.PI / 180);
        const away = Math.abs(deg);

        // Each card's own distance from the hub (see _measure), so a disc
        // of mismatched cards still seats every one of them at the rim.
        const radius = card.__dialRadius !== undefined ? card.__dialRadius : this._ringRadius;
        const x = radius * Math.sin(theta);
        const y = this._hubOffsetY - radius * Math.cos(theta);
        // Grown over the last card-step of the approach rather than
        // switched on at arrival, so the card swells into the gate.
        const scale = 1 + (o.selectedScale - 1) * Math.max(0, 1 - Math.abs(delta));
        const opacity = away > fadeStart
          ? 1 - clamp((away - fadeStart) / fadeSpan, 0, 1)
          : 1;

        card.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px))`
          + ` rotate(${deg.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        card.style.opacity = opacity.toFixed(3);
        card.style.pointerEvents = opacity < 0.05 ? 'none' : '';
        card.style.zIndex = String(100 - Math.round(away));
      });

      if (selected !== this._selectedIndex) {
        const previous = this._cards[this._selectedIndex];
        if (previous) previous.classList.remove('is-selected');
        const current = this._cards[selected];
        if (current) current.classList.add('is-selected');
        this._selectedIndex = selected;
      }
    }

    // ----- settle / persistence -----

    // Fires 'dial-settle' (bubbling) on a card once it's actually come to
    // rest at the gate - not on every card turned past on the way there.
    // The is-selected class is the live counterpart: it tracks whichever
    // card is nearest the gate even mid-spin, where this doesn't.
    _setSettledIndex(index) {
      if (index === this._settledIndex) return;
      this._settledIndex = index;
      this._memory.write(index);
      const card = this._cards[index];
      if (card) card.dispatchEvent(new CustomEvent('dial-settle', { bubbles: true }));
    }

    destroy() {
      this._stop();
      this._intersectionObserver.disconnect();
      clearTimeout(this._wheelIdleTimer);
      this.root.removeEventListener('wheel', this._onWheel);
      this.root.removeEventListener('pointerdown', this._onPointerDown);
      this.root.removeEventListener('keydown', this._onKeyDown);
      this.face.removeEventListener('click', this._onClickCapture, true);
      this._resizeObserver.disconnect();
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);
      // The rim, hub and gate were created by this instance, so they go
      // with it - otherwise they outlive the mechanism that positions them,
      // and a destroy()/re-init cycle leaves a second set stacked on the
      // first.
      this._buildChrome(false);
      this.root.classList.remove('is-dragging');
    }
  }

  function setBox(el, left, top, width, height) {
    el.style.left = `${left.toFixed(1)}px`;
    el.style.top = `${top.toFixed(1)}px`;
    el.style.width = `${width.toFixed(1)}px`;
    el.style.height = `${height.toFixed(1)}px`;
  }

  Dial.DEFAULTS = DEFAULTS;

  global.Dial = Dial;

  registerEffect(Dial, {
    slug: 'dial',
    selector: '.dial:not(.is-empty)',
    prepare: injectStyles,
  });
})(window);
