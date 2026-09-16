/**
 * Rolodex
 * -------
 * A sentence is split into words. One fixed-size card shows a single word
 * at a time and flips through the sentence word by word as the user
 * scrolls, like a rolodex / split-flap display. Viewport progress is
 * derived from scroll position and mapped across the word list, so
 * reversing scroll reverses the flip exactly.
 *
 * Usage: give any element `class="rolodex"` with the sentence as its
 * content (or a `data-text` attribute). This file injects its own CSS and
 * auto-initializes every matching element on load.
 */
(function (global) {
  const STYLE_ID = 'rolodex-styles';
  const CSS = `
.rolodex {
  display: inline-block;
  font-size: var(--font-size, clamp(48px, 9vw, 110px));
  font-weight: 700;
  line-height: 1;
  user-select: none;
}

.rolodex__stage {
  display: inline-block;
  vertical-align: middle;
}

.rolodex__card {
  position: relative;
  display: block;
  transform-style: preserve-3d;
}

.rolodex__panel,
.rolodex__flap,
.rolodex__face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 0.06em;
  white-space: nowrap;
  background: #fff;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.rolodex__panel--top,
.rolodex__flap--top {
  clip-path: inset(0 0 50% 0);
}

.rolodex__panel--bottom,
.rolodex__flap--bottom {
  clip-path: inset(50% 0 0 0);
}

.rolodex__flap--top,
.rolodex__flap--bottom {
  z-index: 2;
  transform-origin: 50% 50%;
}

.rolodex__panel--top,
.rolodex__panel--bottom {
  z-index: 1;
}

.rolodex__hinge-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: rgba(0, 0, 0, 0.85);
  z-index: 3;
  pointer-events: none;
  /* Pins this to its own explicit depth in the card's 3D context (instead
     of the implicit z=0 it'd share with a flap's rotation axis, which sits
     exactly at this same line). Without it, z-index alone doesn't reliably
     order a flat layer against a truly 3D-rotated one, and toggling a
     flap's transform on/off at rest (see the transform-clearing above)
     changes its layer promotion right at that shared depth — read as the
     hinge line flickering in and out over the course of a fold. */
  transform: translateZ(1px);
}

.rolodex__face--back {
  transform: rotateX(180deg);
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
    mode: 'split-flap', // 'split-flap' | 'single-card'
    flipWidth: 55, // percent of each word's scroll segment spent mid-flip (rest is hold)
    perspective: 900, // px
    shading: 0.55, // 0-1, how much a flap darkens as it turns edge-on
    // 'scroll' drives the flip from scroll position (default, original
    // behavior). 'continuous' ignores scroll and flips through the words on
    // its own clock: hold on a word for `interval`, flip to the next over
    // `flipDuration`, and once the last word is reached, rewind straight
    // back to the first word over `rollbackSpeed` before repeating.
    driveMode: 'scroll',
    interval: 1400, // ms held on each word before flipping to the next
    flipDuration: 450, // ms spent mid-flip between two words
    rollbackSpeed: 900, // ms to rewind from the last word back to the first
    scrollIdleDelay: 120, // ms of no scroll events before treating scroll as idle
    snapStrength: 0.4, // 0-1, how fast the idle settle finishes a fold each frame — kept snappy so it doesn't dwell in the mid-flip "half old, half new" look
  };

  class Rolodex {
    constructor(el, options = {}) {
      if (!el) throw new Error('Rolodex: element is required');
      injectStyles();

      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._words = [];
      this._progress = 0;
      this._lastSegment = -1;
      this._measureCtx = null;
      this._contState = null;
      this._contSegment = 0;
      this._contStateStart = null;
      this._scrollActive = false;
      this._scrollIdleTimer = null;
      this._scrollDirection = 0;
      this._displaySegmentFloat = null;
      this._onScroll = this._onScroll.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);

      this._buildDOM();
      global.addEventListener('scroll', this._onScroll, { passive: true });
      global.addEventListener('resize', this._onResize);
      this._onScroll();
      this._raf = requestAnimationFrame(this._tick);
    }

    _buildDOM() {
      const value = this.el.dataset.text || this.el.textContent.trim();
      this.el.dataset.text = value;
      this._words = value.split(/\s+/).filter(Boolean);
      if (this._words.length === 0) this._words = [''];

      this.el.innerHTML = '';
      this._lastSegment = -1;
      this._contState = null;
      this._contSegment = 0;
      this._contStateStart = null;
      this._displaySegmentFloat = null;

      const size = this._measureCardSize();
      this._cardWidth = size.width;
      this._cardHeight = size.height;

      const stage = document.createElement('div');
      stage.className = 'rolodex__stage';
      stage.style.perspective = `${this.options.perspective}px`;

      const card = document.createElement('div');
      card.className = 'rolodex__card';
      card.style.width = `${size.width}px`;
      card.style.height = `${size.height}px`;

      if (this._words.length < 2) {
        const face = document.createElement('div');
        face.className = 'rolodex__face';
        face.textContent = this._words[0];
        card.appendChild(face);
        this._refs = null;
      } else if (this.options.mode === 'single-card') {
        const front = document.createElement('div');
        front.className = 'rolodex__face rolodex__face--front';
        const back = document.createElement('div');
        back.className = 'rolodex__face rolodex__face--back';
        card.appendChild(front);
        card.appendChild(back);
        this._refs = { front, back };
      } else {
        const panelTop = document.createElement('div');
        panelTop.className = 'rolodex__panel rolodex__panel--top';
        const panelBottom = document.createElement('div');
        panelBottom.className = 'rolodex__panel rolodex__panel--bottom';
        const flapTop = document.createElement('div');
        flapTop.className = 'rolodex__flap rolodex__flap--top';
        const flapBottom = document.createElement('div');
        flapBottom.className = 'rolodex__flap rolodex__flap--bottom';
        const hinge = document.createElement('div');
        hinge.className = 'rolodex__hinge-line';
        card.appendChild(panelTop);
        card.appendChild(panelBottom);
        card.appendChild(flapTop);
        card.appendChild(flapBottom);
        card.appendChild(hinge);
        this._refs = { panelTop, panelBottom, flapTop, flapBottom };
      }

      stage.appendChild(card);
      this.el.appendChild(stage);
      this._stage = stage;
      this._card = card;

      this._applySegment(this._segmentForProgress(this._progress).segmentIndex, true);
    }

    _measureCardSize() {
      if (!this._measureCtx) {
        this._measureCtx = document.createElement('canvas').getContext('2d');
      }
      const style = global.getComputedStyle(this.el);
      this._measureCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const fontSizePx = parseFloat(style.fontSize) || 48;

      let maxWidth = 0;
      this._words.forEach((word) => {
        const width = this._measureCtx.measureText(word).width;
        if (width > maxWidth) maxWidth = width;
      });

      return {
        width: Math.ceil(maxWidth + fontSizePx * 0.16),
        height: Math.ceil(fontSizePx * 1.15),
      };
    }

    remeasure() {
      const size = this._measureCardSize();
      this._cardWidth = size.width;
      this._cardHeight = size.height;
      if (this._card) {
        this._card.style.width = `${size.width}px`;
        this._card.style.height = `${size.height}px`;
      }
    }

    _onResize() {
      this.remeasure();
      this._onScroll();
    }

    _onScroll() {
      if (this.options.driveMode !== 'scroll') return;

      const rect = this.el.getBoundingClientRect();
      const range = global.innerHeight + rect.height;
      const nextProgress = range > 0
        ? clamp((global.innerHeight - rect.top) / range, 0, 1)
        : 0.5;

      // Remember which way scroll last actually moved (increasing progress
      // folds forward, decreasing unfolds) — the idle settle below finishes
      // a fold in this direction rather than toward whichever end happens
      // to be numerically nearer, so it never reverses on its own.
      if (nextProgress !== this._progress) {
        this._scrollDirection = nextProgress > this._progress ? 1 : -1;
      }
      this._progress = nextProgress;

      // Scroll is "active" from this event until scrollIdleDelay passes
      // with no further ones — same idle-detection shape as the carousel's
      // wheel handling. While active, _tick lets scroll push the display
      // forward/backward (see there); once idle, it finishes any fold
      // that's still underway instead of leaving it parked mid-flip.
      this._scrollActive = true;
      clearTimeout(this._scrollIdleTimer);
      this._scrollIdleTimer = setTimeout(() => {
        this._scrollActive = false;
      }, this.options.scrollIdleDelay);
    }

    // The [flipStart, flipEnd] slice of a segment's 0-1 local range where
    // the actual flip motion happens — outside it, flipT is saturated at 0
    // or 1 (a fully formed word, holding so consecutive flips don't run
    // into each other).
    _flipWindow() {
      const flipWidth = clamp(this.options.flipWidth, 1, 100) / 100;
      const holdEachSide = (1 - flipWidth) / 2;
      return { flipStart: holdEachSide, flipEnd: 1 - holdEachSide };
    }

    // Reshapes a continuous position along (words.length - 1) flip
    // transitions into {segmentIndex, flipT} using the flip window above.
    _segmentFromFloat(segmentFloat) {
      const segments = Math.max(1, this._words.length - 1);
      const clamped = clamp(segmentFloat, 0, segments);
      const segmentIndex = clamp(Math.floor(clamped), 0, segments - 1);
      const localT = segments > 0 ? clamped - segmentIndex : 0;

      const { flipStart, flipEnd } = this._flipWindow();
      const rawFlipT = flipEnd > flipStart
        ? (localT - flipStart) / (flipEnd - flipStart)
        : localT;
      const flipT = smoothstep(clamp(rawFlipT, 0, 1));

      return { segmentIndex, flipT };
    }

    // Maps 0-1 scroll progress onto (words.length - 1) flip transitions.
    _segmentForProgress(progress) {
      const segments = Math.max(1, this._words.length - 1);
      return this._segmentFromFloat(clamp(progress, 0, 1) * segments);
    }

    // Drives {segmentIndex, flipT} from a clock instead of scroll position:
    // hold on the current word for `interval`, flip to the next word over
    // `flipDuration`, and once the last word is reached, rewind straight
    // back to the first word over `rollbackSpeed` (eased, so it reads like a
    // physical rolodex spinning back to start) before holding again.
    _computeContinuous(now) {
      const segments = Math.max(1, this._words.length - 1);
      const { interval, flipDuration, rollbackSpeed } = this.options;

      if (this._contState == null) {
        this._contState = 'hold';
        this._contSegment = 0;
        this._contStateStart = now;
      }

      if (this._contState === 'hold') {
        if (now - this._contStateStart >= interval) {
          this._contState = this._contSegment >= segments ? 'rollback' : 'flip';
          this._contStateStart = now;
        }
        const atEnd = this._contSegment >= segments;
        return { segmentIndex: clamp(this._contSegment, 0, segments - 1), flipT: atEnd ? 1 : 0 };
      }

      if (this._contState === 'flip') {
        const t = flipDuration > 0 ? clamp((now - this._contStateStart) / flipDuration, 0, 1) : 1;
        if (t >= 1) {
          this._contSegment += 1;
          this._contState = 'hold';
          this._contStateStart = now;
          const atEnd = this._contSegment >= segments;
          return { segmentIndex: clamp(this._contSegment, 0, segments - 1), flipT: atEnd ? 1 : 0 };
        }
        return { segmentIndex: this._contSegment, flipT: smoothstep(t) };
      }

      // rollback: sweep progress from 1 back to 0 across every segment in
      // one continuous eased motion, then resume holding at the first word.
      const t = rollbackSpeed > 0 ? clamp((now - this._contStateStart) / rollbackSpeed, 0, 1) : 1;
      if (t >= 1) {
        this._contState = 'hold';
        this._contSegment = 0;
        this._contStateStart = now;
        return { segmentIndex: 0, flipT: 0 };
      }
      const progress = 1 - smoothstep(t);
      const segmentFloat = progress * segments;
      const segmentIndex = clamp(Math.floor(segmentFloat), 0, segments - 1);
      return { segmentIndex, flipT: segmentFloat - segmentIndex };
    }

    _applySegment(segmentIndex, force) {
      if (!this._refs || (!force && segmentIndex === this._lastSegment)) return;
      this._lastSegment = segmentIndex;
      const sourceWord = this._words[segmentIndex];
      const targetWord = this._words[segmentIndex + 1];

      if (this.options.mode === 'single-card') {
        this._refs.front.textContent = sourceWord;
        this._refs.back.textContent = targetWord;
      } else {
        this._refs.panelTop.textContent = targetWord;
        this._refs.panelBottom.textContent = sourceWord;
        this._refs.flapTop.textContent = sourceWord;
        this._refs.flapBottom.textContent = targetWord;
      }
    }

    _tick() {
      this._stage.style.perspective = `${this.options.perspective}px`;

      if (this._words.length >= 2) {
        let segmentIndex, flipT;
        if (this.options.driveMode === 'continuous') {
          ({ segmentIndex, flipT } = this._computeContinuous(performance.now()));
        } else {
          const segments = Math.max(1, this._words.length - 1);
          const rawSegmentFloat = clamp(this._progress, 0, 1) * segments;

          if (this._displaySegmentFloat == null) {
            this._displaySegmentFloat = rawSegmentFloat;
          } else if (this._scrollActive) {
            // Real scroll input: let it push the display in whichever
            // direction it's moving, but never let it yank the display
            // backward relative to that direction. Without this clamp,
            // resuming a forward scroll right after an idle settle had
            // already finished animating a fold forward would snap the
            // display back down to match the (still catching-up) raw
            // scroll position — visibly un-folding a flap that had
            // already landed, while the user is still scrolling forward.
            // Eased rather than assigned outright: a plain instant
            // assignment feels fine for the ordinary case (raw already
            // past the display in the direction of travel — this closes
            // to ~raw within a frame or two), but is what causes the
            // "just appears already flipped" pop when the display instead
            // has a stale lead left over from an idle settle. Easing both
            // cases the same way keeps ordinary tracking responsive while
            // making that catch-up visibly animate.
            const target = this._scrollDirection < 0
              ? Math.min(this._displaySegmentFloat, rawSegmentFloat)
              : Math.max(this._displaySegmentFloat, rawSegmentFloat);
            this._displaySegmentFloat += (target - this._displaySegmentFloat) * this.options.snapStrength;
            if (Math.abs(target - this._displaySegmentFloat) < 0.001) this._displaySegmentFloat = target;
          } else {
            // Idle: if genuinely mid-fold (the reshaped flipT — not just
            // the raw scroll position — is strictly between the two hold
            // zones), finish the fold in whichever direction it was already
            // moving instead of leaving it parked mid-flip. Never toward
            // whichever word is numerically nearer, so it only reverses
            // when scroll actually reverses. A resting position (flipT
            // already 0 or 1, fold not yet started or already landed) is
            // deliberately excluded — dragging it further would still
            // complete a flip just because the last nudge happened to be
            // forward, even though nothing had visually started.
            const resting = this._segmentFromFloat(this._displaySegmentFloat);
            if (resting.flipT > 0 && resting.flipT < 1) {
              // The target is the EDGE of the flip window, not the full
              // segment integer: flipT is already saturated at 0/1 there,
              // so landing any deeper serves no visual purpose — it only
              // buries the display in dead "hold" territory that a later
              // reversal has to travel all the way back out of before
              // anything visibly moves again (read as "the fold up doesn't
              // animate" for a small reverse nudge right after landing).
              const { flipStart, flipEnd } = this._flipWindow();
              const target = this._scrollDirection < 0
                ? resting.segmentIndex + flipStart
                : this._scrollDirection > 0
                  ? resting.segmentIndex + flipEnd
                  : resting.segmentIndex + (resting.flipT >= 0.5 ? flipEnd : flipStart);
              this._displaySegmentFloat += (target - this._displaySegmentFloat) * this.options.snapStrength;
              if (Math.abs(target - this._displaySegmentFloat) < 0.001) this._displaySegmentFloat = target;
            }
          }

          ({ segmentIndex, flipT } = this._segmentFromFloat(this._displaySegmentFloat));
        }
        this._applySegment(segmentIndex);

        const shading = clamp(this.options.shading, 0, 1);

        if (this.options.mode === 'single-card') {
          const angle = flipT * 180;
          const brightness = 1 - shading * Math.sin((angle * Math.PI) / 180);
          this._card.style.transform = `rotateX(${angle.toFixed(2)}deg)`;
          // The brightness filter must NOT land on `.rolodex__card` itself:
          // `filter` forces a preserve-3d element to flatten its children's
          // 3D composition, which would break the front/back face flip.
          // The stage wrapper sits outside that 3D chain, so shading it
          // instead darkens the same pixels without touching the card's
          // own 3D context.
          this._stage.style.filter = `brightness(${brightness.toFixed(3)})`;
        } else {
          this._stage.style.filter = '';
          // Top and bottom are strictly back-to-back, never moving at the
          // same time: the top flap (an opaque card) folds away first,
          // then the bottom flap folds in. If their active windows overlap
          // even briefly, both are opaque cards tilted at once, which reads
          // as two separate pieces of paper rather than one card flipping —
          // so the handoff has to be a hard cut at the midpoint, not eased.
          const topPhase = clamp(flipT / 0.5, 0, 1);
          const bottomPhase = clamp((flipT - 0.5) / 0.5, 0, 1);
          // A flap's visible face shrinks as cos(angle), NOT linearly with
          // the angle itself — so mapping phase straight to angle (the
          // original `-90 * topPhase`) spends most of the angle range on
          // the barely-visible sliver near 90deg, and races through the
          // most visually significant part of the fold in a handful of
          // degrees near 0deg. That's what read as a "pop": most of the
          // apparent size change happened almost instantly. Going through
          // acos instead makes the VISIBLE portion shrink/grow linearly
          // with phase, so the fold looks like a constant-speed unfold.
          const topAngle = -toDegrees(Math.acos(clamp(1 - topPhase, -1, 1)));
          const bottomAngle = toDegrees(Math.acos(clamp(bottomPhase, -1, 1)));

          const topBrightness = 1 - shading * Math.sin((Math.abs(topAngle) * Math.PI) / 180);
          const bottomBrightness = 1 - shading * Math.sin((Math.abs(bottomAngle) * Math.PI) / 180);

          // A flap lying perfectly flat (topPhase 0 or bottomPhase 1 — not
          // rotated at all) is showing a real, held word, not mid-motion.
          // Leaving `transform: rotateX(0deg)` and `filter: brightness(1)`
          // on it in that state is a visual no-op but still promotes it to
          // its own composited layer, which can rasterize/anti-alias its
          // text at a subtly different subpixel offset than the plain,
          // untransformed panel showing the other half of the same word —
          // a persistent seam right at the hinge line. Clearing both to
          // empty when flat removes that discrepancy.
          this._refs.flapTop.style.transform = topPhase === 0 ? '' : `rotateX(${topAngle.toFixed(2)}deg)`;
          this._refs.flapTop.style.filter = topPhase === 0 ? '' : `brightness(${topBrightness.toFixed(3)})`;
          this._refs.flapBottom.style.transform = bottomPhase === 1 ? '' : `rotateX(${bottomAngle.toFixed(2)}deg)`;
          this._refs.flapBottom.style.filter = bottomPhase === 1 ? '' : `brightness(${bottomBrightness.toFixed(3)})`;
          // backface-visibility:hidden should already hide a flap once it's
          // rotated past 90deg, but pinning it exactly AT 90deg for the
          // entire hold (rather than animating through it) leaves it right
          // on that threshold, where some browsers — especially combined
          // with the filter above forcing a composited layer — render a
          // faint sliver of the wrong word instead of nothing. Forcing
          // visibility explicitly whenever a flap is parked removes that
          // sliver regardless of the backface-visibility edge case.
          this._refs.flapTop.style.visibility = topPhase >= 1 ? 'hidden' : 'visible';
          this._refs.flapBottom.style.visibility = bottomPhase <= 0 ? 'hidden' : 'visible';
        }
      }

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      const modeChanged = 'mode' in options && options.mode !== this.options.mode;
      const driveModeChanged = 'driveMode' in options && options.driveMode !== this.options.driveMode;
      Object.assign(this.options, options);
      if (modeChanged) this._buildDOM();
      if (driveModeChanged) {
        this._contState = null;
        this._contSegment = 0;
        this._contStateStart = null;
        this._lastSegment = -1;
        this._displaySegmentFloat = null;
        if (this.options.driveMode === 'scroll') this._onScroll();
      }
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._onScroll();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._scrollIdleTimer);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onResize);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  Rolodex.initAll = function (selector = '.rolodex', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__rolodexInstance)
      .map((el) => {
        const instance = new Rolodex(el, options);
        el.__rolodexInstance = instance;
        return instance;
      });
  };

  Rolodex.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__rolodexInstance || null : null;
  };

  Rolodex.getAll = function (selector = '.rolodex') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__rolodexInstance)
      .filter(Boolean);
  };

  global.Rolodex = Rolodex;

  function autoInit() {
    Rolodex.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
