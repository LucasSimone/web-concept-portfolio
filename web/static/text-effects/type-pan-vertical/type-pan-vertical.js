/**
 * TypePanVertical
 * -------
 * A fixed-size "screen" window clips a line of text that types itself out,
 * character by character, as you scroll down — driven entirely by scroll
 * position, so it can be scrubbed back and forth exactly like the other
 * scroll effects. Once the typed line grows wider than the window, the
 * window pans right over the text (the track slides left underneath a
 * pinned caret) instead of wrapping or shrinking the font.
 *
 * Scrolling back up rewinds the caret. By default that also erases
 * characters past the caret (classic "undo the typing" feel); toggling
 * `eraseOnReverse` off keeps every typed character permanently and turns
 * reverse-scroll into a pure camera rewind across the already-typed text.
 *
 * Usage: give any element `class="type-pan-vertical"` with the text as its
 * content (or a `data-text` attribute). This file injects its own CSS and
 * auto-initializes every matching element on load.
 */
(function (global) {
  const STYLE_ID = 'type-pan-vertical-styles';
  const CSS = `
.type-pan-vertical {
  position: relative;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--type-pan-vertical-size, 18px);
  line-height: 1.5;
  text-align: left;
  user-select: none;
}

.type-pan-vertical__track {
  display: inline-block;
  white-space: pre;
  will-change: transform;
}

.type-pan-vertical__char {
  display: inline;
}

.type-pan-vertical__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  background: currentColor;
  vertical-align: text-bottom;
  opacity: 1;
}

.type-pan-vertical__cursor--blink {
  animation: type-pan-vertical-blink 1s steps(1, start) infinite;
}

@keyframes type-pan-vertical-blink {
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
    panPosition: 0.62, // fraction of the window width the caret pins to once text overflows
    lag: 0.18, // smoothing applied to the pan (0-1, higher = snappier)
    eraseOnReverse: true, // erase typed characters when scrolling back up
    cursorBlink: true,
  };

  class TypePanVertical {
    constructor(el, options = {}) {
      if (!el) throw new Error('TypePanVertical: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._progress = 0;
      this._maxRevealed = 0;
      this._attachedCount = 0;
      this._panX = 0;

      this._onScroll = this._onScroll.bind(this);
      this._tick = this._tick.bind(this);

      this._buildDOM();
      global.addEventListener('scroll', this._onScroll, { passive: true });
      global.addEventListener('resize', this._onScroll);
      this._onScroll();
      this._applyCursorStyle();
      this._raf = requestAnimationFrame(this._tick);
    }

    _buildDOM() {
      const value = this.el.dataset.text || this.el.textContent.trim();
      this.el.dataset.text = value;
      this.el.innerHTML = '';
      this.el.classList.add('type-pan-vertical');

      const track = document.createElement('span');
      track.className = 'type-pan-vertical__track';

      const cursor = document.createElement('span');
      cursor.className = 'type-pan-vertical__cursor';
      track.appendChild(cursor);

      this.el.appendChild(track);
      this.trackEl = track;
      this.cursorEl = cursor;

      this._allSpans = Array.from(value).map((char) => {
        const span = document.createElement('span');
        span.className = 'type-pan-vertical__char';
        span.textContent = char;
        return span;
      });

      this._attachedCount = 0;
      this._maxRevealed = 0;
      this._panX = 0;
    }

    _applyCursorStyle() {
      this.cursorEl.classList.toggle('type-pan-vertical__cursor--blink', !!this.options.cursorBlink);
    }

    _onScroll() {
      const rect = this.el.getBoundingClientRect();
      const range = global.innerHeight + rect.height;
      this._progress = range > 0
        ? clamp((global.innerHeight - rect.top) / range, 0, 1)
        : 0;
    }

    // Attaches/detaches character spans (in order, right before the cursor)
    // so the DOM always holds exactly `count` typed characters.
    _renderDom(count) {
      while (this._attachedCount < count) {
        // Appended at the very end — the caret span is repositioned
        // independently by _placeCursor(), so it must not be used as the
        // insertion anchor here (it may currently sit mid-track).
        this.trackEl.appendChild(this._allSpans[this._attachedCount]);
        this._attachedCount += 1;
      }
      while (this._attachedCount > count) {
        this._attachedCount -= 1;
        this.trackEl.removeChild(this._allSpans[this._attachedCount]);
      }
    }

    // Moves the caret span to sit right after the character at `index` —
    // in "keep typed text" mode the DOM can hold more characters than the
    // current scroll position accounts for, so the caret has to be placed
    // explicitly rather than simply trailing the last attached span.
    _placeCursor(index) {
      const nextSpan = index < this._attachedCount ? this._allSpans[index] : null;
      if (this.cursorEl.nextSibling !== nextSpan) {
        this.trackEl.insertBefore(this.cursorEl, nextSpan);
      }
    }

    _tick() {
      const total = this._allSpans.length;
      const targetCount = clamp(Math.round(this._progress * total), 0, total);

      let displayCount;
      if (this.options.eraseOnReverse) {
        displayCount = targetCount;
      } else {
        this._maxRevealed = Math.max(this._maxRevealed, targetCount);
        displayCount = this._maxRevealed;
      }

      this._renderDom(displayCount);
      this._placeCursor(targetCount);

      const viewportWidth = this.el.clientWidth || 1;
      const caretX = targetCount > 0
        ? this._allSpans[targetCount - 1].offsetLeft + this._allSpans[targetCount - 1].offsetWidth
        : 0;
      const targetPan = Math.min(0, this.options.panPosition * viewportWidth - caretX);
      const ease = clamp(this.options.lag, 0.01, 1);
      this._panX += (targetPan - this._panX) * ease;

      this.trackEl.style.transform = `translateX(${this._panX.toFixed(2)}px)`;

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      Object.assign(this.options, options);
      this._applyCursorStyle();
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._applyCursorStyle();
      this._onScroll();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onScroll);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  TypePanVertical.initAll = function (selector = '.type-pan-vertical', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__typePanVerticalInstance)
      .map((el) => {
        const instance = new TypePanVertical(el, options);
        el.__typePanVerticalInstance = instance;
        return instance;
      });
  };

  TypePanVertical.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__typePanVerticalInstance || null : null;
  };

  TypePanVertical.getAll = function (selector = '.type-pan-vertical') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__typePanVerticalInstance)
      .filter(Boolean);
  };

  global.TypePanVertical = TypePanVertical;

  function autoInit() {
    TypePanVertical.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
