(function (global) {
  const DEFAULTS = {
    amplitude: 16,
    frequency: 0.8,
    spread: 1.2,
    drift: 0.7,
    fade: true,
  };

  class WaveText {
    constructor(el, options = {}) {
      if (!el) throw new Error('WaveText: element is required');

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
        span.className = 'wave-text__char';
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

  WaveText.initAll = function (selector = '.wave-text', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__waveTextInstance)
      .map((el) => {
        const instance = new WaveText(el, options);
        el.__waveTextInstance = instance;
        return instance;
      });
  };

  global.WaveText = WaveText;
})(window);
