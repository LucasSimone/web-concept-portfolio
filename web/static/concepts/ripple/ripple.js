/**
 * Ripple
 * ------
 * Press an element and a ripple spreads out from the point you pressed,
 * reaching the element's farthest corner. Held, it stays; let go and it
 * fades. A quick click lets it finish spreading as it fades, so even the
 * shortest tap reads as a ripple rather than a flash.
 *
 * Ripples are drawn on a layer inside the element, beneath its content
 * but above its background, so text on the element stays exactly as
 * legible as it was. By default the layer clips to the element's own
 * rounded outline; `contained: false` lets a ripple spread past it, which
 * suits a ring around an icon button.
 *
 * What a ripple looks like is open: `shape` takes a built-in name
 * ('fill', 'ring', 'soft', 'rings') or one you add with
 * Ripple.addShape(). A shape only styles one square element at its full
 * size; the spreading and fading are done here, the same way for every
 * shape. Ripples take the element's text color unless `color` says
 * otherwise.
 *
 * No animation loop: each ripple is a single element animated with the
 * Web Animations API and removed when it has faded.
 *
 * Usage: give any element class="ripple-el". This file injects its own
 * CSS and sets every matching element up on load. `data-ripple-shape`,
 * `data-ripple-color` and friends change that per element. To ripple
 * from your own code instead, call Ripple.at(el, x, y).
 */
(function (global) {
  const STYLE_ID = 'ripple-styles';
  const CSS = `
.ripple-layer {
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.ripple-layer--free {
  overflow: visible;
}

.ripple {
  position: absolute;
  box-sizing: border-box;
  border-radius: 50%;
  pointer-events: none;
  transform: scale(0);
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
    shape: 'fill',
    color: null,          // any CSS color; null takes the element's text color
    opacity: null,        // null takes the shape's own
    duration: 550,        // ms to spread to full size
    fadeDuration: 450,    // ms to fade once released
    origin: 'pointer',    // 'pointer' or 'center'
    contained: true,      // clip to the element's outline
    size: null,           // full radius in px; null reaches the farthest corner
  };

  // A ripple released early still shows for at least this share of its
  // spread before it starts to fade, so a fast click isn't just a blink.
  const MIN_SHOW = 0.35;

  // Under reduced motion a ripple fades in over this many ms instead of
  // spreading, and isn't let go until it has, so even a press and release
  // in the same instant (a keyboard click) shows at full strength.
  const STILL_FADE_IN = 120;

  // Fast out of the press point, easing in to its full size.
  const SPREAD_EASING = 'cubic-bezier(0.2, 0.6, 0.35, 1)';

  function prefersReducedMotion() {
    return Boolean(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // --- Shapes ----------------------------------------------------------
  // Each styles one square, `size` px across, centered on the press
  // point. Its color is already set as the CSS `color`, so a shape paints
  // with currentColor. The scale-up from nothing and the fade are applied
  // on top, the same for every shape.

  const SHAPES = {
    fill: {
      opacity: 0.22,
      draw(el) {
        el.style.background = 'currentColor';
      },
    },
    ring: {
      opacity: 0.6,
      draw(el, { size }) {
        // The border scales with the ripple, so this is how thick it is
        // at full size.
        el.style.border = `${Math.max(2, Math.round(size * 0.03))}px solid currentColor`;
      },
    },
    soft: {
      opacity: 0.4,
      draw(el) {
        el.style.background = 'radial-gradient(circle closest-side, currentColor, transparent)';
      },
    },
    rings: {
      opacity: 0.45,
      draw(el, { size }) {
        // Three rings, the same thickness, at a third, two thirds and the
        // full radius.
        const t = `${Math.max(2, Math.round(size * 0.015))}px`;
        el.style.background = `radial-gradient(circle closest-side,
          transparent calc(33% - ${t}), currentColor calc(33% - ${t}) 33%,
          transparent 33% calc(66% - ${t}), currentColor calc(66% - ${t}) 66%,
          transparent 66% calc(100% - ${t}), currentColor calc(100% - ${t}) 100%,
          transparent 100%)`;
      },
    },
  };

  function shapeOf(name) {
    if (typeof name === 'function') return { opacity: 0.3, draw: name };
    return SHAPES[name] || SHAPES.fill;
  }

  // --- The ripple itself ----------------------------------------------

  // The layer ripples are drawn on, made the first time an element
  // ripples. It sits at z-index -1 in a stacking context of the element's
  // own, which paints it over the element's background but under all of
  // its content.
  function layerFor(el, contained) {
    let layer = el.__rippleLayer;
    if (!layer || layer.parentNode !== el) {
      const cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
      if (cs.isolation !== 'isolate') el.style.isolation = 'isolate';
      layer = document.createElement('span');
      layer.className = 'ripple-layer';
      layer.setAttribute('aria-hidden', 'true');
      el.appendChild(layer);
      el.__rippleLayer = layer;
    }
    layer.classList.toggle('ripple-layer--free', !contained);
    return layer;
  }

  // Spreads a ripple on `el` from window point (x, y), or from its center
  // when either is missing. Returns a handle whose release() fades it.
  function at(el, x, y, options = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return { release() {} };
    injectStyles();
    const opts = { ...DEFAULTS, ...options };
    const layer = layerFor(el, opts.contained !== false);
    const box = layer.getBoundingClientRect();

    let px = Number.isFinite(x) ? x - box.left : box.width / 2;
    let py = Number.isFinite(y) ? y - box.top : box.height / 2;
    if (opts.origin === 'center') {
      px = box.width / 2;
      py = box.height / 2;
    }

    const radius = Number.isFinite(opts.size) && opts.size > 0
      ? opts.size
      : Math.hypot(Math.max(px, box.width - px), Math.max(py, box.height - py));
    const size = radius * 2;

    const shape = shapeOf(opts.shape);
    const opacity = Number.isFinite(opts.opacity) ? opts.opacity : shape.opacity;

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${px - radius}px`;
    ripple.style.top = `${py - radius}px`;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    if (opts.color) ripple.style.color = opts.color;
    try {
      shape.draw(ripple, { size, color: opts.color });
    } catch (err) {
      console.error('Ripple: shape threw, drawing a fill instead', err);
      SHAPES.fill.draw(ripple, { size });
    }
    layer.appendChild(ripple);

    // Under reduced motion there's no spread: the ripple fades in at full
    // size instead, so a press still shows without anything moving.
    const still = prefersReducedMotion();
    const started = performance.now();
    const spread = still
      ? ripple.animate(
        [{ transform: 'scale(1)', opacity: 0 }, { transform: 'scale(1)', opacity }],
        { duration: STILL_FADE_IN, fill: 'forwards' },
      )
      : ripple.animate(
        [{ transform: 'scale(0)', opacity }, { transform: 'scale(1)', opacity }],
        { duration: opts.duration, easing: SPREAD_EASING, fill: 'forwards' },
      );

    let released = false;
    function release() {
      if (released) return;
      released = true;
      const minShow = still ? STILL_FADE_IN : opts.duration * MIN_SHOW;
      const wait = Math.max(0, minShow - (performance.now() - started));
      setTimeout(() => {
        // By now it's at full strength either way: spreading keeps its
        // opacity throughout, and a still one has finished fading in.
        const fade = ripple.animate(
          [{ opacity }, { opacity: 0 }],
          { duration: opts.fadeDuration, easing: 'ease-out', fill: 'forwards' },
        );
        fade.onfinish = () => {
          spread.cancel();
          ripple.remove();
        };
      }, wait);
    }

    return { release, element: ripple };
  }

  // --- Press-bound elements -------------------------------------------

  const DATA_OPTIONS = {
    rippleShape: 'shape',
    rippleColor: 'color',
    rippleOpacity: 'opacity',
    rippleDuration: 'duration',
    rippleOrigin: 'origin',
    rippleContained: 'contained',
    rippleSize: 'size',
  };
  const NUMERIC = ['opacity', 'duration', 'size'];

  function dataOptions(el) {
    const out = {};
    Object.keys(DATA_OPTIONS).forEach((attr) => {
      const value = el.dataset[attr];
      if (value == null || value === '') return;
      const key = DATA_OPTIONS[attr];
      if (NUMERIC.includes(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) out[key] = n;
      } else if (key === 'contained') {
        out[key] = value !== 'false';
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  function isDisabled(el) {
    return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
  }

  class Ripple {
    constructor(el, options = {}) {
      if (!el) throw new Error('Ripple: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...options, ...dataOptions(el) };
      // Ripples still held down, by pointer id.
      this._held = new Map();

      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onClick = this._onClick.bind(this);
      // On pointerdown rather than click, so the ripple starts the moment
      // the element is pressed, and can be held.
      this.el.addEventListener('pointerdown', this._onPointerDown);
      this.el.addEventListener('pointerleave', this._onPointerUp);
      this.el.addEventListener('click', this._onClick);
      global.addEventListener('pointerup', this._onPointerUp);
      global.addEventListener('pointercancel', this._onPointerUp);
    }

    _onPointerDown(event) {
      if (event.button !== 0 || isDisabled(this.el)) return;
      this._release(event.pointerId);
      this._held.set(event.pointerId, this.press(event.clientX, event.clientY));
    }

    // Releases on pointerup or pointercancel anywhere, or the pointer
    // leaving the element, which is also how a touch that turns into a
    // scroll lets its ripple go.
    _onPointerUp(event) {
      this._release(event.pointerId);
    }

    _release(pointerId) {
      const handle = this._held.get(pointerId);
      if (!handle) return;
      this._held.delete(pointerId);
      handle.release();
    }

    _onClick(event) {
      // detail is 0 for a click that came from the keyboard (Enter or
      // Space on a button), which has no pointerdown before it and no
      // position, so it ripples from the center and lets go at once.
      if (event.detail !== 0 || isDisabled(this.el)) return;
      this.fire();
    }

    // Starts a ripple at window point (x, y), or the center, and returns
    // its handle. It stays until handle.release() is called.
    press(x, y) {
      return at(this.el, x, y, this.options);
    }

    // A whole press and release, as if the element had been clicked.
    fire(x, y) {
      this.press(x, y).release();
    }

    // Merges new options in. They apply from the next ripple.
    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
    }

    destroy() {
      this._held.forEach((handle) => handle.release());
      this._held.clear();
      this.el.removeEventListener('pointerdown', this._onPointerDown);
      this.el.removeEventListener('pointerleave', this._onPointerUp);
      this.el.removeEventListener('click', this._onClick);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__rippleInstance;
    }
  }

  Ripple.at = at;

  // Adds a shape that `shape: name` and data-ripple-shape="name" can then
  // use. `draw(el, { size, color })` styles one square `size` px across;
  // `opacity` is its default.
  Ripple.addShape = function (name, draw, { opacity = 0.3 } = {}) {
    SHAPES[name] = { opacity, draw };
  };

  // The opacity a shape (a name or a drawing function) draws at when
  // `opacity` is left null.
  Ripple.shapeOpacity = function (shape) {
    return shapeOf(shape).opacity;
  };

  Ripple.DEFAULTS = DEFAULTS;
  Object.defineProperty(Ripple, 'SHAPES', { get: () => Object.keys(SHAPES) });

  Ripple.initAll = function (selector = '.ripple-el', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__rippleInstance)
      .map((el) => {
        const instance = new Ripple(el, options);
        el.__rippleInstance = instance;
        return instance;
      });
  };

  Ripple.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__rippleInstance || null : null;
  };

  Ripple.getAll = function (selector = '.ripple-el') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__rippleInstance)
      .filter(Boolean);
  };

  global.Ripple = Ripple;

  // Not skipped under reduced motion: a ripple is feedback that the press
  // landed, so it still shows, fading in place instead of spreading.
  function autoInit() {
    Ripple.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
