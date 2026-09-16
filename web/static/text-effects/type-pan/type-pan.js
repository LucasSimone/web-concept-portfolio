/**
 * TypePan
 * -------
 * A single line of text types itself out character by character, the caret
 * always sitting immediately after the last revealed character (never at an
 * independent fixed reveal line) — so new characters reveal to its right
 * exactly like a real typewriter. Once the typed line grows wider than the
 * element, it pans left underneath a pinned caret.
 *
 * Three drive modes:
 *  - 'scroll' (default): real page scroll position drives typing, exactly
 *    like the other scroll-linked effects — reversible/scrubbable by
 *    scrolling the page.
 *  - 'continuous': ignores scroll/wheel and types/erases the line on its
 *    own clock.
 *  - 'hover' ("static scroll"): the element stays put on the page; wheel/
 *    trackpad input over it (or over an element elsewhere on the page
 *    tagged `data-type-pan-hover="<id>"`) drives typing directly instead of
 *    scrolling the page.
 *
 * Reversing (scrolling back, or scrolling back while hovering) rewinds the
 * caret. By default that also erases characters past the caret; toggling
 * `eraseOnReverse` off keeps every typed character permanently and turns
 * reverse input into a pure camera rewind across the already-typed text.
 *
 * This only concerns itself with revealing a single line of text — what
 * happens once the whole line is visible (keep panning, hand off to a
 * normal vertical scroll, etc.) is left entirely up to the page/developer
 * using it.
 *
 * Usage: give any element `class="type-pan"` with the text as its content
 * (or a `data-text` attribute). This file injects its own CSS and
 * auto-initializes every matching element on load.
 */
(function (global) {
  const STYLE_ID = 'type-pan-styles';
  const CSS = `
.type-pan {
  position: relative;
  height: 35vh;
  min-height: 160px;
  font-size: var(--type-pan-size, 64px);
  line-height: 1;
  user-select: none;
  cursor: ns-resize;
}

.type-pan__viewport {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.type-pan__track {
  position: relative;
  display: inline-flex;
  align-items: center;
  white-space: pre;
  will-change: transform;
}

.type-pan__char {
  display: inline-block;
  opacity: 0;
}

.type-pan__char--visible {
  opacity: 1;
}

.type-pan__cursor {
  position: absolute;
  top: 8%;
  bottom: 8%;
  width: 3px;
  background: currentColor;
  pointer-events: none;
}

.type-pan__cursor--blink {
  animation: type-pan-blink 1s steps(1, start) infinite;
}

@keyframes type-pan-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
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
    panPosition: 0.65, // fraction of the element width the caret pins to once text overflows
    lag: 0.18, // smoothing applied to the pan (0-1, higher = snappier)
    eraseOnReverse: true, // erase typed characters on reverse input (scroll/hover modes)
    cursorBlink: true,
    sensitivity: 1, // multiplier applied to wheel delta before it becomes typing progress, in 'hover' driveMode
    // 'scroll' drives typing from real page scroll position (default,
    // reversible/scrubbable like the other scroll-linked effects).
    // 'continuous' ignores scroll/wheel and types/erases the line on its
    // own clock: type the whole line over `typeDuration`, hold fully typed
    // for `holdDuration`, erase back to empty over `rollbackSpeed`, and
    // repeat. 'hover' keeps the element static on the page — wheel/
    // trackpad input over it (or over an element elsewhere on the page
    // carrying `data-type-pan-hover="<id>"`, where `<id>` is this
    // element's own `id`) drives typing directly, and is prevented from
    // scrolling the page itself.
    driveMode: 'scroll',
    typeDuration: 2200, // ms to type the full line
    holdDuration: 1000, // ms held fully typed before erasing
    rollbackSpeed: 700, // ms to erase back to empty
  };

  class TypePan {
    constructor(el, options = {}) {
      if (!el) throw new Error('TypePan: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._typedPx = 0; // virtual "scroll" accumulator, driven by wheel input in 'hover' mode
      this._maxTypedPx = 0;
      this._progress = 0; // 0-1, driven by real page scroll in 'scroll' mode
      this._maxProgress = 0;
      this._panX = 0;
      this._totalWidth = 0;
      this._contState = null;
      this._contStateStart = null;
      this._hoverTargets = [];

      this._onScroll = this._onScroll.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);
      // In 'hover' driveMode the element stays put on the page — wheel
      // input over it drives typing directly (same accumulator as before)
      // instead of scrolling the page. Other drive modes ignore wheel
      // entirely, letting the page scroll as normal.
      this._onWheel = (event) => {
        if (this.options.driveMode !== 'hover') return;

        // Ordinary vertical wheel motion (plus any native horizontal
        // delta, e.g. trackpad swipes) is redirected into typing progress.
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        event.preventDefault();

        const next = this._typedPx + delta * this.options.sensitivity;
        this._typedPx = clamp(next, 0, this._totalWidth);
      };

      this._buildDOM();
      this._bindHoverTargets();
      global.addEventListener('scroll', this._onScroll, { passive: true });
      global.addEventListener('resize', this._onResize);
      this._measure();
      this._onScroll();
      this._raf = requestAnimationFrame(this._tick);
    }

    // Hover targets are this element plus, if it has an `id`, any element
    // anywhere on the page tagged `data-type-pan-hover="<that id>"` — lets
    // a caller drive typing by wheeling over a different element than the
    // text itself without this instance needing to know about it up front.
    _bindHoverTargets() {
      const targets = [this.el];
      const id = this.el.id;
      if (id && global.CSS && typeof global.CSS.escape === 'function') {
        document.querySelectorAll(`[data-type-pan-hover="${global.CSS.escape(id)}"]`).forEach((node) => {
          if (!targets.includes(node)) targets.push(node);
        });
      }
      this._hoverTargets = targets;
      targets.forEach((target) => {
        target.addEventListener('wheel', this._onWheel, { passive: false });
      });
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
        span.textContent = char === ' ' ? ' ' : char;
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
      this._progress = 0;
      this._maxProgress = 0;
      this._panX = 0;
      this._contState = null;
      this._contStateStart = null;
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
      this._onScroll();
    }

    _onScroll() {
      if (this.options.driveMode !== 'scroll') return;

      const rect = this.el.getBoundingClientRect();
      const range = global.innerHeight + rect.height;
      this._progress = range > 0
        ? clamp((global.innerHeight - rect.top) / range, 0, 1)
        : 0;
    }

    // Drives a 0-1 reveal fraction from a clock instead of scroll/wheel
    // input: type the full line over `typeDuration`, hold fully typed for
    // `holdDuration`, erase back to empty over `rollbackSpeed`, then loop
    // back into typing.
    _advanceContinuous(now) {
      const { typeDuration, holdDuration, rollbackSpeed } = this.options;

      if (this._contState == null) {
        this._contState = 'type';
        this._contStateStart = now;
      }

      if (this._contState === 'type') {
        const t = typeDuration > 0 ? clamp((now - this._contStateStart) / typeDuration, 0, 1) : 1;
        if (t >= 1) {
          this._contState = 'hold';
          this._contStateStart = now;
        }
        return t;
      }

      if (this._contState === 'hold') {
        if (now - this._contStateStart >= holdDuration) {
          this._contState = 'erase';
          this._contStateStart = now;
        }
        return 1;
      }

      // erase
      const t = rollbackSpeed > 0 ? clamp((now - this._contStateStart) / rollbackSpeed, 0, 1) : 1;
      if (t >= 1) {
        this._contState = 'type';
        this._contStateStart = now;
      }
      return 1 - t;
    }

    _tick() {
      const total = this._chars.length;

      let fraction;
      if (this.options.driveMode === 'continuous') {
        fraction = this._advanceContinuous(performance.now());
      } else if (this.options.driveMode === 'hover') {
        this._maxTypedPx = Math.max(this._maxTypedPx, this._typedPx);
        const revealPx = this.options.eraseOnReverse ? this._typedPx : this._maxTypedPx;
        fraction = this._totalWidth > 0 ? clamp(revealPx / this._totalWidth, 0, 1) : 0;
      } else {
        this._maxProgress = Math.max(this._maxProgress, this._progress);
        fraction = this.options.eraseOnReverse ? this._progress : this._maxProgress;
      }

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
      const driveModeChanged = 'driveMode' in options && options.driveMode !== this.options.driveMode;
      Object.assign(this.options, options);
      this._applyCursorStyle();
      this._measure();

      if (driveModeChanged) {
        this._contState = null;
        this._contStateStart = null;
        this._typedPx = 0;
        this._maxTypedPx = 0;
        this._progress = 0;
        this._maxProgress = 0;
        if (this.options.driveMode === 'scroll') this._onScroll();
      }
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._measure();
      this._onScroll();
    }

    // Resets typing progress back to the start (meaningful in 'hover' mode
    // — 'scroll' mode's progress is re-derived live from page scroll
    // position, and 'continuous' mode runs its own clock).
    reset() {
      this._typedPx = 0;
      this._maxTypedPx = 0;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onResize);
      this._hoverTargets.forEach((target) => {
        target.removeEventListener('wheel', this._onWheel);
      });
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  TypePan.initAll = function (selector = '.type-pan', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__typePanInstance)
      .map((el) => {
        const instance = new TypePan(el, options);
        el.__typePanInstance = instance;
        return instance;
      });
  };

  TypePan.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__typePanInstance || null : null;
  };

  TypePan.getAll = function (selector = '.type-pan') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__typePanInstance)
      .filter(Boolean);
  };

  global.TypePan = TypePan;

  function autoInit() {
    TypePan.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
