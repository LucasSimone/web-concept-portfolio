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
      const rect = this.el.getBoundingClientRect();
      const range = global.innerHeight + rect.height;
      this._progress = range > 0
        ? clamp((global.innerHeight - rect.top) / range, 0, 1)
        : 0.5;
    }

    // Maps 0-1 scroll progress onto (words.length - 1) flip transitions,
    // then reshapes the local position inside that transition into a
    // flip-t using `flipWidth` — the middle slice of the segment is the
    // actual flip motion, the rest on either side holds on a fully formed
    // word so consecutive flips don't run into each other.
    _segmentForProgress(progress) {
      const segments = Math.max(1, this._words.length - 1);
      const segmentFloat = clamp(progress, 0, 1) * segments;
      const segmentIndex = clamp(Math.floor(segmentFloat), 0, segments - 1);
      const localT = segments > 0 ? segmentFloat - segmentIndex : 0;

      const flipWidth = clamp(this.options.flipWidth, 1, 100) / 100;
      const holdEachSide = (1 - flipWidth) / 2;
      const flipStart = holdEachSide;
      const flipEnd = 1 - holdEachSide;
      const rawFlipT = flipEnd > flipStart
        ? (localT - flipStart) / (flipEnd - flipStart)
        : localT;
      const flipT = smoothstep(clamp(rawFlipT, 0, 1));

      return { segmentIndex, flipT };
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
        const { segmentIndex, flipT } = this._segmentForProgress(this._progress);
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

          this._refs.flapTop.style.transform = `rotateX(${topAngle.toFixed(2)}deg)`;
          this._refs.flapTop.style.filter = `brightness(${topBrightness.toFixed(3)})`;
          this._refs.flapBottom.style.transform = `rotateX(${bottomAngle.toFixed(2)}deg)`;
          this._refs.flapBottom.style.filter = `brightness(${bottomBrightness.toFixed(3)})`;
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
      Object.assign(this.options, options);
      if (modeChanged) this._buildDOM();
    }

    setText(value) {
      this.el.dataset.text = value || '';
      this._buildDOM();
      this._onScroll();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
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
