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
  // Requires shared/sequence-stepper.js to already be loaded.
  const clamp = global.SequenceStepper.clamp;

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
    // ms per character for .nextChar()/.prevChar()/.nextWord()/.prevWord() -
    // a constant pace (not a fixed step duration) so a step always reads as
    // actual typing/backspacing, one letter at a time, rather than a
    // smooth-but-instant reveal/erase - a word step just takes
    // proportionally longer than a single-letter step, the same way a
    // longer word takes a real typist longer.
    stepSpeed: 60,
    // What happens when .nextChar()/.prevChar()/.nextWord()/.prevWord()/
    // .goTo() is called again before the previous call has finished typing
    // - a real concern for a button a user might mash. 'redirect'
    // immediately retargets from wherever the reveal visually is
    // (responsive, but a fast burst blurs past every character in between
    // instead of visiting each one). 'rateLimit' drops a call arriving
    // less than `minStepInterval` after the last one that was accepted, so
    // every accepted step finishes before the next is even considered.
    // 'queue' lets the current step finish, then plays queued calls
    // back-to-back in order, so every call is eventually honored (a big
    // burst queues up a correspondingly long visible run). See
    // shared/sequence-stepper.js.
    stepPolicy: 'redirect',
    // ms - only meaningful with stepPolicy: 'rateLimit'.
    minStepInterval: 150,
  };

  class TypePan {
    constructor(el, options = {}) {
      if (!el) throw new Error('TypePan: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      // 0-1 reveal fraction, fed by real page scroll (_onScroll), wheel
      // input in 'hover' driveMode (_onWheel), or any external source via
      // .pushProgress() - all three funnel through the same field.
      this._progress = 0;
      this._maxProgress = 0;
      this._panX = 0;
      this._totalWidth = 0;
      this._contState = null;
      this._contStateStart = null;
      this._wordBoundaries = []; // revealed-counts marking "just finished a word", for .nextWord()/.prevWord()
      this._lastRevealedCount = 0;
      // Shared animated-position engine: drives both the manual
      // .nextChar()/.prevChar()/.nextWord()/.prevWord() steps and, below,
      // 'continuous' driveMode's type/hold/erase clock - see
      // shared/sequence-stepper.js.
      this._stepper = new global.SequenceStepper({
        paceMs: this.options.stepSpeed,
        stepPolicy: this.options.stepPolicy,
        minStepIntervalMs: this.options.minStepInterval,
      });

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
        // Converted from a pixel delta into a 0-1 fraction of the line's
        // rendered width, the same unit pushProgress() itself takes.
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        event.preventDefault();

        const deltaFraction = this._totalWidth > 0 ? (delta * this.options.sensitivity) / this._totalWidth : 0;
        this.pushProgress(this._progress + deltaFraction);
      };

      this._buildDOM();
      // Requires shared/hover-scroll-source.js to also be loaded - lets
      // wheel/trackpad input over this element, or over any other element
      // tagged `data-type-pan-hover="<this element's id>"`, drive typing in
      // 'hover' driveMode (see _onWheel above).
      this._hoverSource = bindHoverScrollSource(this.el, 'data-type-pan-hover', this._onWheel);
      global.addEventListener('scroll', this._onScroll, { passive: true });
      global.addEventListener('resize', this._onResize);
      this._measure();
      this._onScroll();
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

      const chars = Array.from(value);
      this._chars = chars.map((char) => {
        const span = document.createElement('span');
        span.className = 'type-pan__char';
        span.textContent = char === ' ' ? ' ' : char;
        track.appendChild(span);
        return span;
      });
      // Revealed-counts marking "just finished a word" - the character
      // right before a run of whitespace, or the very last character -
      // used by .nextWord()/.prevWord() to find the next/previous boundary
      // relative to wherever the reveal currently sits.
      this._wordBoundaries = chars
        .map((char, i) => (!/\s/.test(char) && (i === chars.length - 1 || /\s/.test(chars[i + 1])) ? i + 1 : null))
        .filter((boundary) => boundary != null);

      const cursor = document.createElement('span');
      cursor.className = 'type-pan__cursor';
      track.appendChild(cursor);

      viewport.appendChild(track);
      this.el.appendChild(viewport);

      this.viewportEl = viewport;
      this.trackEl = track;
      this.cursorEl = cursor;
      this._progress = 0;
      this._maxProgress = 0;
      this._panX = 0;
      this._contState = null;
      this._contStateStart = null;
      this._lastRevealedCount = 0;
      this._stepper.jumpTo(0);
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
      this.pushProgress(viewportProgress(this.el));
    }

    // Feeds a new 0-1 reveal fraction in from whatever is driving typing -
    // real page scroll (_onScroll) and wheel input in 'hover' driveMode
    // (_onWheel) both go through this; it's also the general escape hatch
    // for tying typing to anything else, e.g. the homepage carousel, which
    // calls this directly instead of the page scrolling.
    pushProgress(value) {
      // Real input always wins over an in-flight step.
      if (this._stepper.isStepping) this._stepper.jumpTo(this._stepper.value);
      this._progress = clamp(value, 0, 1);
      this._maxProgress = Math.max(this._maxProgress, this._progress);
    }

    // Drives a 0-1 reveal fraction from a clock instead of scroll/wheel
    // input: type the full line over `typeDuration`, hold fully typed for
    // `holdDuration`, erase back to empty over `rollbackSpeed`, then loop
    // back into typing. Built on the same SequenceStepper as the manual
    // step methods below - "type the whole line" is just a stepTo() over
    // the whole character count, at a fixed total duration instead of a
    // per-character pace.
    _advanceContinuous(now, total) {
      const { typeDuration, holdDuration, rollbackSpeed } = this.options;

      // stepToDirect, not stepTo, throughout this method: this is the
      // automatic clock's own step, which must never be rate-limited or
      // queued behind stepPolicy (that governs manual .nextChar()/.goTo()
      // calls a person might mash, not the effect's own internal animation)
      // - see the comment on stepToDirect in sequence-stepper.js.
      if (this._contState == null) {
        this._contState = 'type';
        this._stepper.jumpTo(0);
        this._stepper.stepToDirect(total, { duration: typeDuration });
      }

      if (this._contState === 'hold') {
        if (now - this._contStateStart >= holdDuration) {
          this._contState = 'erase';
          this._stepper.stepToDirect(0, { duration: rollbackSpeed });
        }
      } else if (!this._stepper.isStepping) {
        // A 'type' or 'erase' step just landed.
        this._contState = this._contState === 'type' ? 'hold' : 'type';
        if (this._contState === 'hold') {
          this._contStateStart = now;
        } else {
          this._stepper.stepToDirect(total, { duration: typeDuration });
        }
      }

      const count = this._stepper.tick(now);
      return total > 0 ? count / total : 0;
    }

    // Starts (or redirects an already-running) step toward `targetCount`
    // revealed characters, at a constant pace (`stepSpeed` ms/char) so it
    // always reads as actually typing/backspacing rather than a
    // smooth-but-instant reveal - a multi-character step (.nextWord()) is
    // just several single-character steps (.nextChar()) run back to back,
    // covered by the same interpolation. A fresh step (the stepper isn't
    // already mid-step) seeds from the last rendered count rather than
    // wherever the stepper was last left, since scroll/hover driving in
    // between doesn't touch it.
    _beginStep(targetCount, options) {
      const total = this._chars.length;
      if (!this._stepper.isStepping) this._stepper.jumpTo(this._lastRevealedCount);
      this._stepper.stepTo(clamp(targetCount, 0, total), options);
    }

    // Reveal one more/fewer character, animated at `stepSpeed`.
    nextChar() {
      const current = this._stepper.isStepping ? this._stepper.target : this._lastRevealedCount;
      this._beginStep(current + 1);
    }

    prevChar() {
      const current = this._stepper.isStepping ? this._stepper.target : this._lastRevealedCount;
      this._beginStep(current - 1);
    }

    // Reveal/erase through to the next or previous word boundary (see
    // _wordBoundaries in _buildDOM), animated one character at a time the
    // same as nextChar()/prevChar() - just covering more distance.
    nextWord() {
      const current = this._stepper.isStepping ? this._stepper.target : this._lastRevealedCount;
      const boundary = this._wordBoundaries.find((b) => b > current);
      this._beginStep(boundary != null ? boundary : this._chars.length);
    }

    prevWord() {
      const current = this._stepper.isStepping ? this._stepper.target : this._lastRevealedCount;
      let boundary = 0;
      for (const b of this._wordBoundaries) {
        if (b >= current) break;
        boundary = b;
      }
      this._beginStep(boundary);
    }

    // Reveal (or erase back) directly to `targetCount` characters, at the
    // same constant `stepSpeed` pace as a single nextChar()/prevChar() step
    // rather than a fixed total duration - so a big jump visibly
    // types/erases through every character in between at a normal pace
    // instead of racing through them. Pass `duration` in `options` to
    // override that with a fixed total time regardless of distance
    // instead.
    goTo(targetCount, options) {
      this._beginStep(targetCount, options);
    }

    _tick() {
      const total = this._chars.length;

      let fraction;
      if (this.options.driveMode === 'continuous') {
        fraction = this._advanceContinuous(performance.now(), total);
      } else if (this._stepper.isStepping) {
        const count = this._stepper.tick(performance.now());
        fraction = total > 0 ? count / total : 0;
        if (!this._stepper.isStepping) {
          // Just landed - write the settled fraction back into _progress,
          // so scroll/wheel resuming next picks up from here instead of
          // snapping to a stale value.
          this._progress = fraction;
          this._maxProgress = Math.max(this._maxProgress, this._progress);
        }
      } else {
        // 'scroll' and 'hover' driveMode both just feed _progress (see
        // pushProgress()) and read it back the same way here.
        this._maxProgress = Math.max(this._maxProgress, this._progress);
        fraction = this.options.eraseOnReverse ? this._progress : this._maxProgress;
      }

      const revealedCount = clamp(Math.round(fraction * total), 0, total);
      this._lastRevealedCount = revealedCount;

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
      if ('stepSpeed' in options) this._stepper.defaultPaceMs = options.stepSpeed;
      if ('stepPolicy' in options || 'minStepInterval' in options) {
        this._stepper.setPolicy({ stepPolicy: this.options.stepPolicy, minStepIntervalMs: this.options.minStepInterval });
      }

      if (driveModeChanged) {
        this._contState = null;
        this._contStateStart = null;
        this._stepper.jumpTo(0);
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
      this._progress = 0;
      this._maxProgress = 0;
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onResize);
      this._hoverSource.destroy();
    }
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
