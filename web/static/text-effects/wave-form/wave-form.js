/**
 * WaveForm
 * --------
 * Each character of an element's text drifts independently on a sine wave,
 * with the pointer's position nudging the drift's direction and rotation.
 *
 * Usage: give any element `class="wave-form"` with the text as its content
 * (or a `data-text` attribute). This file injects its own CSS and
 * auto-initializes every matching element on load.
 */
(function (global) {
  const STYLE_ID = 'wave-form-styles';
  const CSS = `
.wave-form {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.01em;
  font-size: var(--wave-size, clamp(48px, 9vw, 150px));
  line-height: 0.8;
  letter-spacing: -0.08em;
  font-weight: 700;
  user-select: none;
  cursor: pointer;
}

.wave-form__char {
  position: relative;
  display: inline-block;
  will-change: transform, opacity;
  transition: transform 60ms linear;
  text-shadow: 0 0 0 rgba(0, 0, 0, 0.2);
}

.wave-form__char::after {
  content: attr(data-char);
  position: absolute;
  inset: 0;
  color: transparent;
  -webkit-text-stroke: 1px rgba(0, 0, 0, 0.4);
  transform: translate(-0.08em, 0.1em);
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
    amplitude: 16,
    frequency: 0.8,
    spread: 1.2,
    drift: 0.7,
    fade: true,
  };

  class WaveForm {
    constructor(el, options = {}) {
      if (!el) throw new Error('WaveForm: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._chars = [];
      this._pointerX = 0;
      this._pointerY = 0;
      this._onPointerMove = this._onPointerMove.bind(this);
      this._tick = this._tick.bind(this);

      this._buildDOM();
      this.el.addEventListener('pointermove', this._onPointerMove, { passive: true });
      this.el.addEventListener('pointerleave', () => {
        this._pointerX = 0;
        this._pointerY = 0;
      });
      this._raf = requestAnimationFrame(this._tick);
    }

    _buildDOM() {
      const value = this.el.dataset.text || this.el.textContent.trim();
      this.el.innerHTML = '';
      this.el.dataset.text = value;

      this._chars = Array.from(value).map((char, index) => {
        const span = document.createElement('span');
        span.className = 'wave-form__char';
        const visible = char === ' ' ? '\u00A0' : char;
        span.textContent = visible;
        span.setAttribute('data-char', visible);
        span.style.setProperty('--char-index', index);
        this.el.appendChild(span);
        return span;
      });
    }

    _onPointerMove(event) {
      const rect = this.el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      this._pointerX = (x - 0.5) * 2;
      this._pointerY = (y - 0.5) * 2;
    }

    _tick() {
      const now = performance.now() * 0.001;
      const { amplitude, frequency, spread, drift, fade } = this.options;

      this._chars.forEach((char, index) => {
        const phase = index * spread;
        const wave = Math.sin(now * (frequency * (1.6 + drift)) + phase) * amplitude;
        const shimmer = Math.cos(now * (frequency * 1.4) + phase * 0.75) * amplitude * 0.55;
        const x = this._pointerX * (index * 2.6 + 8);
        const y = wave + shimmer + (this._pointerY * 18);
        const rotate = this._pointerX * 18 + Math.sin(now * frequency * 2.8 + phase) * 9;
        const opacity = fade
          ? 0.5 + (Math.sin(now * frequency * 2.4 + phase * 1.3) + 1) * 0.25
          : 1;

        char.style.transform = `translate(${x}px, ${y}px) rotate(${rotate}deg)`;
        char.style.opacity = opacity.toFixed(3);
      });

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
    }

    setText(value) {
      const text = value || '';
      if (!text) {
        this.el.innerHTML = '';
        this._chars = [];
        this.el.dataset.text = '';
        return;
      }
      this.el.dataset.text = text;
      this._buildDOM();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this.el.removeEventListener('pointermove', this._onPointerMove);
    }
  }

  WaveForm.initAll = function (selector = '.wave-form', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__waveFormInstance)
      .map((el) => {
        const instance = new WaveForm(el, options);
        el.__waveFormInstance = instance;
        return instance;
      });
  };

  WaveForm.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__waveFormInstance || null : null;
  };

  WaveForm.getAll = function (selector = '.wave-form') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__waveFormInstance)
      .filter(Boolean);
  };

  global.WaveForm = WaveForm;

  function autoInit() {
    WaveForm.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
