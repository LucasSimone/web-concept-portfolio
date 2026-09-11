/**
 * TypePanHorizontal
 * -----------------
 * The horizontal twin of TypePanVertical. Instead of the browser's native
 * vertical scroll driving the effect, ordinary mouse-wheel input is
 * captured and converted into typing progress — so "scrolling" here pans
 * the whole element horizontally rather than the page moving down.
 *
 * The caret always sits immediately after the last revealed character
 * (never at an independent fixed reveal line), so new characters reveal
 * to its right exactly like a real typewriter. Once the typed line grows
 * wider than the element, it pans left underneath a pinned caret — the
 * same "camera follows the caret" behavior as the vertical variant.
 *
 * Scrolling back (wheel up / trackpad reverse) rewinds the caret. By
 * default that also erases characters past the caret; toggling
 * `eraseOnReverse` off keeps every typed character permanently and turns
 * reverse-scroll into a pure camera rewind across the already-typed text.
 *
 * This only concerns itself with revealing a single line of text as you
 * "pan" across it — what happens once the whole line is visible (keep
 * panning, hand off to a normal vertical scroll, etc.) is left entirely
 * up to the page/developer using it.
 */
(function (global) {
  const DEFAULTS = {
    panPosition: 0.4, // fraction of the element width the caret pins to once text overflows
    lag: 0.18, // smoothing applied to the pan (0-1, higher = snappier)
    eraseOnReverse: true, // erase typed characters when scrolling back
    cursorBlink: true,
    sensitivity: 1, // multiplier applied to wheel delta before it becomes typing progress
  };

  class TypePanHorizontal {
    constructor(el, options = {}) {
      if (!el) throw new Error('TypePanHorizontal: element is required');

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._typedPx = 0; // virtual "scroll" accumulator, driven by wheel input
      this._maxTypedPx = 0;
      this._panX = 0;
      this._totalWidth = 0;

      this._onWheel = this._onWheel.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);

      this._buildDOM();
      this.el.addEventListener('wheel', this._onWheel, { passive: false });
      global.addEventListener('resize', this._onResize);
      this._measure();
      this._raf = requestAnimationFrame(this._tick);
    }

    _buildDOM() {
      const value = this.el.dataset.text || this.el.textContent.trim();
      this.el.dataset.text = value;
      this.el.innerHTML = '';
      this.el.classList.add('type-pan');

      const viewport = document.createElement('div');
      viewport.className = 'type-pan__viewport';

      const track = document.createElement('div');
      track.className = 'type-pan__track';

      this._chars = Array.from(value).map((char) => {
        const span = document.createElement('span');
        span.className = 'type-pan__char';
        span.textContent = char === ' ' ? '\u00A0' : char;
        track.appendChild(span);
        return span;
      });

      const cursor = document.createElement('span');
      cursor.className = 'type-pan__cursor';
      track.appendChild(cursor);

      viewport.appendChild(track);
      this.el.appendChild(viewport);

      this.viewportEl = viewport;
      this.trackEl = track;
      this.cursorEl = cursor;
      this._typedPx = 0;
      this._maxTypedPx = 0;
      this._panX = 0;
      this._applyCursorStyle();
    }

    _applyCursorStyle() {
      this.cursorEl.classList.toggle('type-pan__cursor--blink', !!this.options.cursorBlink);
    }

    // The track holds every character up front (visibility is toggled via
    // opacity, not attach/detach), so its natural width — measured once all
    // characters are laid out — is a stable conversion factor between wheel
    // distance and "how far through the line" the caret has traveled.
    _measure() {
      const cursorWidth = this.cursorEl.offsetWidth;
      this._totalWidth = Math.max(1, this.trackEl.scrollWidth - cursorWidth);
    }

    _onResize() {
      this._measure();
    }

    _onWheel(event) {
      // Ordinary vertical wheel motion (plus any native horizontal delta,
      // e.g. trackpad swipes) is redirected into typing progress instead of
      // the page scrolling — this element owns "scrolling" while active.
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      event.preventDefault();

      const next = this._typedPx + delta * this.options.sensitivity;
      this._typedPx = clamp(next, 0, this._totalWidth);
    }

    _tick() {
      const total = this._chars.length;
      this._maxTypedPx = Math.max(this._maxTypedPx, this._typedPx);
      const revealPx = this.options.eraseOnReverse ? this._typedPx : this._maxTypedPx;

      const fraction = this._totalWidth > 0 ? clamp(revealPx / this._totalWidth, 0, 1) : 0;
      const revealedCount = clamp(Math.round(fraction * total), 0, total);

      this._chars.forEach((span, index) => {
        span.classList.toggle('type-pan__char--visible', index < revealedCount);
      });

      // Snap the caret to the boundary right after the last revealed
      // character (or the very start, if nothing is revealed yet) — this
      // keeps it glued to real character edges instead of a raw pixel
      // value, so it always sits precisely between typed and untyped text.
      const lastChar = revealedCount > 0 ? this._chars[revealedCount - 1] : null;
      const caretPx = lastChar ? lastChar.offsetLeft + lastChar.offsetWidth : 0;
      const caretPxStr = `${caretPx}px`;
      if (this.cursorEl.style.left !== caretPxStr) {
        this.cursorEl.style.left = caretPxStr;
      }

      const viewportWidth = this.el.clientWidth || 1;
      const targetPan = Math.min(0, this.options.panPosition * viewportWidth - caretPx);
      const ease = clamp(this.options.lag, 0.01, 1);
      this._panX += (targetPan - this._panX) * ease;

      this.trackEl.style.transform = `translateX(${this._panX.toFixed(2)}px)`;

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
      this._applyCursorStyle();
      this._measure();
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._measure();
    }

    // Resets typing progress back to the start.
    reset() {
      this._typedPx = 0;
      this._maxTypedPx = 0;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this.el.removeEventListener('wheel', this._onWheel);
      global.removeEventListener('resize', this._onResize);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  TypePanHorizontal.initAll = function (selector = '.type-pan', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__typePanHorizontalInstance)
      .map((el) => {
        const instance = new TypePanHorizontal(el, options);
        el.__typePanHorizontalInstance = instance;
        return instance;
      });
  };

  global.TypePanHorizontal = TypePanHorizontal;
})(window);
