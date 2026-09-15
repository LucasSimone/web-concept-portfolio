/**
 * DoubleSpeak
 * -------
 * Clones an element's text into a ghost layer that trails behind during scroll.
 *
 * Usage: give any element `class="double-speak"` with the text/markup as
 * its content. This file injects its own CSS and auto-initializes every
 * matching element on load.
 */
(function (global) {
  const STYLE_ID = 'double-speak-styles';
  const CSS = `
.double-speak {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 1.1;
  white-space: pre-wrap;
  user-select: none;
}

.double-speak__front,
.double-speak__ghost {
  display: block;
  color: var(--fg, #000);
}

.double-speak__ghost {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  will-change: transform;
  pointer-events: none;
}

.double-speak__front {
  position: relative;
  z-index: 1;
  will-change: transform;
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
    offsetX: 0,
    offsetY: 60,
    lag: 0.15,
    speed: 1,
    opacity: 0.5,
    blur: 0,
    color: null,
    inverted: false,
    rebound: 0,
    scrollSource: null,
  };

  const SCALE_X = 1;
  const SCALE_Y = 2.3;
  const TARGET_DECAY = 0.88;

  class DoubleSpeak {
    constructor(el, options = {}) {
      if (!el) throw new Error('DoubleSpeak: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this.scrollSource = this.options.scrollSource || global;
      this._scrollY = this._getScrollPos();
      this._x = 0;
      this._y = 0;
      this._vx = 0;
      this._vy = 0;
      this._targetX = 0;
      this._targetY = 0;

      this._buildDOM();
      this._onScroll = this._onScroll.bind(this);
      this._tick = this._tick.bind(this);

      this.scrollSource.addEventListener('scroll', this._onScroll, { passive: true });
      this._raf = requestAnimationFrame(this._tick);
    }

    _getScrollPos() {
      return this.scrollSource === global ? (global.scrollY || 0) : this.scrollSource.scrollTop;
    }

    resync() {
      this._scrollY = this._getScrollPos();
    }

    _buildDOM() {
      const el = this.el;
      el.classList.add('double-speak');

      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

      const computedDisplay = getComputedStyle(el).display;
      if (!el.style.display && (computedDisplay === 'inline' || computedDisplay === 'block')) {
        el.style.display = 'inline-block';
      }

      const front = document.createElement('span');
      front.className = 'double-speak__front';
      front.innerHTML = el.innerHTML;

      const ghost = document.createElement('span');
      ghost.className = 'double-speak__ghost';
      ghost.innerHTML = el.innerHTML;
      ghost.setAttribute('aria-hidden', 'true');

      el.innerHTML = '';
      el.appendChild(ghost);
      el.appendChild(front);

      this.frontEl = front;
      this.ghostEl = ghost;
      this._applyStaticStyles();
    }

    _applyStaticStyles() {
      const { opacity, blur, color } = this.options;
      this.ghostEl.style.opacity = opacity;
      this.ghostEl.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
      this.ghostEl.style.color = color || '';
    }

    _onScroll() {
      const y = this._getScrollPos();
      const delta = (y - this._scrollY) * this.options.speed;
      this._scrollY = y;

      const { offsetX, offsetY } = this.options;
      this._targetX = offsetX > 0 ? clamp(delta * SCALE_X, -offsetX, offsetX) : 0;
      this._targetY = offsetY > 0 ? clamp(delta * SCALE_Y, -offsetY, offsetY) : 0;
    }

    _tick() {
      const { lag, offsetX, offsetY } = this.options;
      const ease = clamp(lag, 0.01, 1);

      const rebound = clamp(this.options.rebound, 0, 2);

      if (rebound > 0) {
        const spring = Math.sqrt(rebound / 2);
        const stiffness = ease * (0.12 + spring * 0.35);
        const damping = 0.76 + spring * 0.2;

        this._vx += (this._targetX - this._x) * stiffness;
        this._vy += (this._targetY - this._y) * stiffness;
        this._vx *= damping;
        this._vy *= damping;
        this._x += this._vx;
        this._y += this._vy;
      } else {
        this._x += (this._targetX - this._x) * ease;
        this._y += (this._targetY - this._y) * ease;
        this._vx = 0;
        this._vy = 0;
      }

      this._targetX *= TARGET_DECAY;
      this._targetY *= TARGET_DECAY;

      if (offsetX <= 0) {
        this._x = 0;
        this._vx = 0;
      }
      if (offsetY <= 0) {
        this._y = 0;
        this._vy = 0;
      }

      const transform = `translate(${this._x.toFixed(2)}px, ${this._y.toFixed(2)}px)`;
      const movingEl = this.options.inverted ? this.frontEl : this.ghostEl;
      const fixedEl = this.options.inverted ? this.ghostEl : this.frontEl;

      movingEl.style.transform = transform;
      fixedEl.style.transform = '';
      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
      this._applyStaticStyles();
    }

    setText(html) {
      this.frontEl.innerHTML = html;
      this.ghostEl.innerHTML = html;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this.scrollSource.removeEventListener('scroll', this._onScroll);
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  DoubleSpeak.initAll = function (selector = '.double-speak', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__doubleSpeakInstance)
      .map((el) => {
        const instance = new DoubleSpeak(el, options);
        el.__doubleSpeakInstance = instance;
        return instance;
      });
  };

  DoubleSpeak.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__doubleSpeakInstance || null : null;
  };

  DoubleSpeak.getAll = function (selector = '.double-speak') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__doubleSpeakInstance)
      .filter(Boolean);
  };

  global.DoubleSpeak = DoubleSpeak;

  function autoInit() {
    DoubleSpeak.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
