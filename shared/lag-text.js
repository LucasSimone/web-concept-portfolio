/**
 * LagText
 * -------
 * Clones an element's text into a ghost layer that trails behind during scroll.
 */
(function (global) {
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

  class LagText {
    constructor(el, options = {}) {
      if (!el) throw new Error('LagText: element is required');

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
      el.classList.add('lag-text');

      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

      const computedDisplay = getComputedStyle(el).display;
      if (!el.style.display && (computedDisplay === 'inline' || computedDisplay === 'block')) {
        el.style.display = 'inline-block';
      }

      const front = document.createElement('span');
      front.className = 'lag-text__front';
      front.innerHTML = el.innerHTML;

      const ghost = document.createElement('span');
      ghost.className = 'lag-text__ghost';
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

  LagText.initAll = function (selector = '.lag-text', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__lagTextInstance)
      .map((el) => {
        const instance = new LagText(el, options);
        el.__lagTextInstance = instance;
        return instance;
      });
  };

  global.LagText = LagText;
})(window);
