/**
 * TripleVisionText
 * ----------------
 * Old-school red/cyan 3D-glasses print effect. Like DoubleSpeak, it clones the
 * element's text into extra layers that trail behind during scroll — but
 * instead of one grey ghost, it's two tinted ghosts (red + cyan) that split
 * apart in opposite directions as you scroll and snap back together when
 * you stop, mimicking a misregistered anaglyph print. The color layers use
 * mix-blend-mode: multiply so they combine naturally over a white page,
 * the same way actual red/cyan 3D print separations do.
 */
(function (global) {
  const DEFAULTS = {
    offsetX: 0,
    offsetY: 60,
    lag: 0.15,
    speed: 1,
    opacity: 0.75,
    blur: 0,
    redColor: '#ff2b3d',
    cyanColor: '#00c2ff',
    inverted: false,
    rebound: 0,
    scrollSource: null,
  };

  const SCALE_X = 1;
  const SCALE_Y = 2.3;
  const TARGET_DECAY = 0.88;

  class TripleVisionText {
    constructor(el, options = {}) {
      if (!el) throw new Error('TripleVisionText: element is required');

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
      el.classList.add('triple-vision');

      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

      const computedDisplay = getComputedStyle(el).display;
      if (!el.style.display && (computedDisplay === 'inline' || computedDisplay === 'block')) {
        el.style.display = 'inline-block';
      }

      const front = document.createElement('span');
      front.className = 'triple-vision__front';
      front.innerHTML = el.innerHTML;

      const red = document.createElement('span');
      red.className = 'triple-vision__channel triple-vision__channel--red';
      red.innerHTML = el.innerHTML;
      red.setAttribute('aria-hidden', 'true');

      const cyan = document.createElement('span');
      cyan.className = 'triple-vision__channel triple-vision__channel--cyan';
      cyan.innerHTML = el.innerHTML;
      cyan.setAttribute('aria-hidden', 'true');

      el.innerHTML = '';
      el.appendChild(red);
      el.appendChild(cyan);
      el.appendChild(front);

      this.frontEl = front;
      this.redEl = red;
      this.cyanEl = cyan;
      this._applyStaticStyles();
    }

    _applyStaticStyles() {
      const { opacity, blur, redColor, cyanColor } = this.options;
      const filter = blur > 0 ? `blur(${blur}px)` : 'none';

      this.redEl.style.opacity = opacity;
      this.redEl.style.filter = filter;
      this.redEl.style.color = redColor;

      this.cyanEl.style.opacity = opacity;
      this.cyanEl.style.filter = filter;
      this.cyanEl.style.color = cyanColor;
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

      // Red and cyan split apart in opposite directions from the same lag
      // value — inverting the sign for `inverted` swaps which channel leads,
      // just like flipping a pair of 3D glasses.
      const sign = this.options.inverted ? -1 : 1;
      const redTransform = `translate(${(-this._x * sign).toFixed(2)}px, ${(-this._y * sign).toFixed(2)}px)`;
      const cyanTransform = `translate(${(this._x * sign).toFixed(2)}px, ${(this._y * sign).toFixed(2)}px)`;

      this.redEl.style.transform = redTransform;
      this.cyanEl.style.transform = cyanTransform;
      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
      this._applyStaticStyles();
    }

    setText(html) {
      this.frontEl.innerHTML = html;
      this.redEl.innerHTML = html;
      this.cyanEl.innerHTML = html;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this.scrollSource.removeEventListener('scroll', this._onScroll);
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  TripleVisionText.initAll = function (selector = '.triple-vision', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__tripleVisionInstance)
      .map((el) => {
        const instance = new TripleVisionText(el, options);
        el.__tripleVisionInstance = instance;
        return instance;
      });
  };

  global.TripleVisionText = TripleVisionText;
})(window);
