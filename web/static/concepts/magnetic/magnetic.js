/**
 * Magnetic
 * --------
 * The element leans toward the cursor as it comes near, as if pulled by a
 * magnet, and springs back when the cursor moves away. The pull is a
 * fraction (`strength`) of the distance from the element's center to the
 * pointer, and it fades in over a band `radius` px wide around the
 * element, so the element starts moving before the cursor reaches it and
 * never jumps as the cursor crosses its edge.
 *
 * Two rules keep neighbours from colliding. Only one element pulls at a
 * time, whichever the cursor is nearest, so two buttons side by side
 * can't both lean into the gap between them; moving across hands the pull
 * from one to the other, each riding its own spring. And an element can
 * reach the cursor but never pass it, so the one that is pulling can't
 * cross over to where its neighbour sits.
 *
 * The element doesn't follow the target directly. It rides a spring
 * (`stiffness` and `damping`), so it eases in, overshoots a little, and
 * wobbles back to rest when released. One spring per element, all of them
 * stepped by one shared animation loop that stops whenever every element
 * is at rest and the cursor isn't near any of them, so a page full of
 * magnetic buttons costs nothing while the cursor is elsewhere.
 *
 * The extension point is CSS, not JS. Each frame writes three custom
 * properties onto the element, all plain numbers so CSS can multiply
 * them into any unit (px for a move, deg for a tilt):
 *
 *   --magnetic-x, --magnetic-y   the current pull, in px
 *   --magnetic-amount            0 to 1, how engaged the element is
 *
 * The default rule turns the first two into a translate. Override
 * `transform` on your own element to use them some other way (a tilt, a
 * scale, a shadow that falls the other way) without touching this file.
 * Children with `data-magnetic-depth="1.5"` move that many times as far
 * as the element itself, for a layered, parallax look.
 *
 * Usage: give any element class="magnetic-el". This file injects its own
 * CSS and sets every matching element up on load. `data-magnetic-strength`,
 * `data-magnetic-radius` and `data-magnetic-area` change that per element.
 */
(function (global) {
  const STYLE_ID = 'magnetic-styles';
  // Both rules sit inside :where(), which has no specificity, so any
  // transform of your own wins over them however it's selected, even
  // though this sheet is added to the page after yours.
  const CSS = `
:where(.magnetic-el) {
  --magnetic-x: 0;
  --magnetic-y: 0;
  --magnetic-amount: 0;
  transform: translate(calc(var(--magnetic-x) * 1px), calc(var(--magnetic-y) * 1px));
  will-change: transform;
}

/* A depth of 1 moves with the element; 2 moves twice as far in total, so
   this child adds the difference on top of what it inherits. Inline
   elements ignore transform, so give a depth child display: inline-block
   or block. */
:where(.magnetic-el [data-magnetic-depth]) {
  transform: translate(
    calc(var(--magnetic-x) * (var(--magnetic-depth, 1) - 1) * 1px),
    calc(var(--magnetic-y) * (var(--magnetic-depth, 1) - 1) * 1px)
  );
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
    strength: 0.35,  // pull as a fraction of the cursor's offset from center
    radius: 60,      // px band around the area where the pull fades in
    stiffness: 220,  // spring constant, per second squared
    damping: 16,     // spring friction, per second
    area: null,      // element or closest() selector to measure instead of the element
  };

  // Below these the spring counts as at rest and snaps to its target, in
  // px and px/s, so the loop can stop instead of chasing sub-pixel wobble.
  const REST_DISTANCE = 0.05;
  const REST_SPEED = 0.05;

  // How fast --magnetic-amount follows the engagement it's heading for,
  // per second. Eased rather than written raw so a custom style built on
  // it doesn't step as the cursor crosses into the area.
  const AMOUNT_RATE = 12;

  // A long frame (a background tab coming back, a debugger pause) is
  // stepped as this long instead, so the spring can't fling the element.
  const MAX_DT = 1 / 30;

  function smoothstep(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  }

  // Distance from a point to the nearest point of a rect, 0 inside it.
  function distanceToRect(x, y, r) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  }

  // How far an element's own transform moves it, in px. A rotation or a
  // scale about its center doesn't move its center, so only the
  // translation part matters here.
  function translationOf(el) {
    const value = getComputedStyle(el).transform;
    if (!value || value === 'none') return [0, 0];
    try {
      const m = new DOMMatrixReadOnly(value);
      return [m.m41, m.m42];
    } catch (e) {
      return [0, 0];
    }
  }

  // --- The shared loop ------------------------------------------------
  // One pointer, one loop, one list of instances for the whole page.

  const stage = {
    instances: new Set(),
    pointer: null,     // { x, y } in window coordinates, or null when away
    raf: null,
    last: 0,
    bound: false,
  };

  function onPointerMove(event) {
    // Magnetism follows a hovering cursor. A finger only touches down, so
    // it has nothing to lean toward between taps.
    if (event.pointerType === 'touch') {
      stage.pointer = null;
    } else {
      stage.pointer = { x: event.clientX, y: event.clientY };
    }
    startLoop();
  }

  function onPointerAway() {
    stage.pointer = null;
    startLoop();
  }

  function onPointerOut(event) {
    // relatedTarget is null when the pointer leaves the window itself.
    if (!event.relatedTarget) onPointerAway();
  }

  function bindStage() {
    if (stage.bound) return;
    stage.bound = true;
    global.addEventListener('pointermove', onPointerMove, { passive: true });
    global.addEventListener('pointerdown', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    global.addEventListener('blur', onPointerAway);
    // Scrolling moves elements under a still cursor, so it re-measures.
    global.addEventListener('scroll', startLoop, { passive: true, capture: true });
    global.addEventListener('resize', startLoop, { passive: true });
  }

  function startLoop() {
    if (stage.raf || stage.instances.size === 0) return;
    stage.last = performance.now();
    stage.raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(MAX_DT, Math.max(0, (now - stage.last) / 1000));
    stage.last = now;

    // Every read before any write, so measuring one element never forces
    // layout for a style just written to another.
    const instances = Array.from(stage.instances);
    instances.forEach((instance) => instance._measure(stage.pointer));

    // Only the element nearest the cursor keeps its pull; every other one
    // within reach lets go. Nearest is measured to each element's area,
    // so with the cursor over two at once (one nested in the other) it's
    // a tie, which goes to the smaller: the one more specifically under
    // the cursor.
    let nearest = null;
    instances.forEach((instance) => {
      if (instance._engage <= 0) return;
      if (!nearest
        || instance._distance < nearest._distance
        || (instance._distance === nearest._distance && instance._zoneArea < nearest._zoneArea)) {
        nearest = instance;
      }
    });
    instances.forEach((instance) => {
      if (instance !== nearest) instance._letGo();
    });

    let busy = false;
    instances.forEach((instance) => {
      if (instance._step(dt)) busy = true;
    });

    stage.raf = busy ? requestAnimationFrame(tick) : null;
  }

  // --- Per-element ----------------------------------------------------

  const DATA_OPTIONS = {
    magneticStrength: 'strength',
    magneticRadius: 'radius',
    magneticStiffness: 'stiffness',
    magneticDamping: 'damping',
    magneticArea: 'area',
  };
  const NUMERIC = ['strength', 'radius', 'stiffness', 'damping'];

  function dataOptions(el) {
    const out = {};
    Object.keys(DATA_OPTIONS).forEach((attr) => {
      const value = el.dataset[attr];
      if (value == null || value === '') return;
      const key = DATA_OPTIONS[attr];
      if (NUMERIC.includes(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) out[key] = n;
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  class Magnetic {
    constructor(el, options = {}) {
      if (!el) throw new Error('Magnetic: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options, ...dataOptions(el) };
      // The injected CSS keys off the class, so an element set up by a
      // selector of its own gets it too, or it would track the cursor
      // without ever moving. Taken back off by destroy() only if added
      // here.
      this._addedClass = !el.classList.contains('magnetic-el');
      el.classList.add('magnetic-el');

      // Spring position and velocity, and where it's heading.
      this.x = 0;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.tx = 0;
      this.ty = 0;
      this.amount = 0;
      this._engage = 0;

      this._syncDepths();
      stage.instances.add(this);
      bindStage();
    }

    // Copies each depth child's attribute into the custom property the
    // injected CSS reads, since CSS can't read a number out of an
    // attribute in every browser yet.
    _syncDepths() {
      this.el.querySelectorAll('[data-magnetic-depth]').forEach((child) => {
        const depth = Number(child.dataset.magneticDepth);
        if (Number.isFinite(depth)) child.style.setProperty('--magnetic-depth', depth);
      });
    }

    _areaEl() {
      const { area } = this.options;
      if (!area) return null;
      if (typeof area === 'string') return this.el.closest(area);
      return area;
    }

    // Works out where the spring is heading for this pointer position.
    _measure(pointer) {
      if (!pointer || !this.el.isConnected) {
        this._letGo();
        return;
      }
      // The element's own rect includes whatever its transform moves it
      // by; taking that back off gives where it sits at rest, so the pull
      // can't feed back into itself. Read off the computed transform
      // rather than assumed from the pull, since a custom style might
      // tilt or scale instead and not move the element at all.
      const r = this.el.getBoundingClientRect();
      const [ox, oy] = translationOf(this.el);
      const rest = {
        left: r.left - ox,
        right: r.right - ox,
        top: r.top - oy,
        bottom: r.bottom - oy,
      };
      const areaEl = this._areaEl();
      const zone = areaEl ? areaEl.getBoundingClientRect() : rest;

      const { strength, radius } = this.options;
      const d = distanceToRect(pointer.x, pointer.y, zone);
      let engage;
      if (d === 0) engage = 1;
      else if (radius > 0) engage = 1 - smoothstep(d / radius);
      else engage = 0;

      const cx = (rest.left + rest.right) / 2;
      const cy = (rest.top + rest.bottom) / 2;
      let tx = (pointer.x - cx) * strength * engage;
      let ty = (pointer.y - cy) * strength * engage;

      // Reaches the cursor but never passes it: with the cursor off to one
      // side, the near edge stops where the cursor is. That's what keeps
      // the element out of a neighbour's space when the cursor sits in the
      // gap between them.
      if (pointer.x > rest.right) tx = Math.min(tx, pointer.x - rest.right);
      else if (pointer.x < rest.left) tx = Math.max(tx, pointer.x - rest.left);
      if (pointer.y > rest.bottom) ty = Math.min(ty, pointer.y - rest.bottom);
      else if (pointer.y < rest.top) ty = Math.max(ty, pointer.y - rest.top);

      this.tx = tx;
      this.ty = ty;
      this._engage = engage;
      this._distance = d;
      this._zoneArea = (zone.right - zone.left) * (zone.bottom - zone.top);
    }

    // Heads back to rest: the cursor has gone, or a nearer element has
    // the pull.
    _letGo() {
      this.tx = 0;
      this.ty = 0;
      this._engage = 0;
    }

    // Steps the spring one frame and writes it out. Returns whether this
    // element still needs the loop: moving, or near enough the cursor
    // that the element under it could still shift.
    _step(dt) {
      const { stiffness, damping } = this.options;
      this.vx += (-stiffness * (this.x - this.tx) - damping * this.vx) * dt;
      this.vy += (-stiffness * (this.y - this.ty) - damping * this.vy) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.amount += (this._engage - this.amount) * (1 - Math.exp(-AMOUNT_RATE * dt));

      const atRest = Math.abs(this.x - this.tx) < REST_DISTANCE
        && Math.abs(this.y - this.ty) < REST_DISTANCE
        && Math.abs(this.vx) < REST_SPEED
        && Math.abs(this.vy) < REST_SPEED
        && Math.abs(this.amount - this._engage) < 0.001;
      if (atRest) {
        this.x = this.tx;
        this.y = this.ty;
        this.vx = 0;
        this.vy = 0;
        this.amount = this._engage;
      }

      this._write();
      // Kept running while engaged even when still: the element can move
      // under a cursor that isn't (a carousel sliding it along, say), and
      // nothing else would notice.
      return !atRest || this._engage > 0;
    }

    _write() {
      const style = this.el.style;
      style.setProperty('--magnetic-x', this.x.toFixed(2));
      style.setProperty('--magnetic-y', this.y.toFixed(2));
      style.setProperty('--magnetic-amount', this.amount.toFixed(3));
    }

    // The current pull, in px.
    get offset() {
      return { x: this.x, y: this.y };
    }

    // Merges new options in. A changed `strength` or `radius` takes effect
    // on the next frame; the spring carries on from where it is.
    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
      this._syncDepths();
      startLoop();
    }

    destroy() {
      stage.instances.delete(this);
      ['--magnetic-x', '--magnetic-y', '--magnetic-amount'].forEach((prop) => {
        this.el.style.removeProperty(prop);
      });
      if (this._addedClass) this.el.classList.remove('magnetic-el');
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__magneticInstance;
    }
  }

  Magnetic.DEFAULTS = DEFAULTS;

  Magnetic.initAll = function (selector = '.magnetic-el', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__magneticInstance)
      .map((el) => {
        const instance = new Magnetic(el, options);
        el.__magneticInstance = instance;
        return instance;
      });
  };

  Magnetic.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__magneticInstance || null : null;
  };

  Magnetic.getAll = function (selector = '.magnetic-el') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__magneticInstance)
      .filter(Boolean);
  };

  global.Magnetic = Magnetic;

  function autoInit() {
    Magnetic.initAll();
  }

  // Skipped under reduced motion, like Liftoff and Spotlight: the element
  // stays put. Calling initAll yourself still sets elements up.
  if (!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }
})(window);
