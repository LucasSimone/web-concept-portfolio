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
  // Requires shared/sequence-stepper.js to already be loaded.
  const clamp = global.SequenceStepper.clamp;
  const smoothstep = global.SequenceStepper.smoothstep;

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
    // back to the first word over `rollbackSpeed` before repeating - unless
    // `loopScroll` is also on, in which case the word list is already
    // circular and that last flip just wraps forward into the first word
    // like any other, with no rewind. 'hover'
    // keeps the element static on the page (no page scroll involved at
    // all) and instead drives the exact same scroll-position math as
    // 'scroll' mode from wheel/trackpad input, but only while the pointer
    // is over the rolodex element itself (or any element elsewhere on the
    // page carrying `data-rolodex-hover="<id>"`, where `<id>` is this
    // rolodex element's own `id`) — that input is also prevented from
    // scrolling the page itself.
    driveMode: 'scroll',
    interval: 1400, // ms held on each word before flipping to the next
    flipDuration: 450, // ms spent mid-flip between two words
    rollbackSpeed: 900, // ms to rewind from the last word back to the first
    hoverScrollDistance: 1000, // px-equivalent of wheel delta to sweep through the whole word list in 'hover' driveMode
    scrollIdleDelay: 120, // ms of no scroll/wheel events before treating scroll as idle
    snapStrength: 0.4, // 0-1, how fast the idle settle finishes a fold each frame — kept snappy so it doesn't dwell in the mid-flip "half old, half new" look
    // Only meaningful in 'scroll'/'hover' driveMode ('continuous' already
    // cycles on its own). Once real scroll/wheel input goes idle, keeps
    // flipping through the sentence on its own using the same
    // interval/flipDuration/rollbackSpeed clock as 'continuous' mode,
    // picking up from whichever word scroll/hover last left it on, instead
    // of just holding there until input resumes.
    loop: false,
    // Only meaningful in 'scroll'/'hover' driveMode. Normally the last word
    // is the end of the line - scrolling/wheeling further just holds there.
    // With this on, the word list is circular: scrolling/wheeling past the
    // last word flips straight on into the first word again (and past the
    // first, back into the last), so it keeps flipping for as long as input
    // keeps coming instead of stopping. Independent of `loop` above - this
    // is about active input continuing past the end, not about what
    // happens once input goes idle. Requires whatever feeds pushProgress()
    // to pass values that aren't pre-clamped to 0-1 (real page scroll can't
    // - it's bounded by the page - but wheel/drag input, e.g. the homepage
    // carousel, can).
    loopScroll: false,
    // What happens when .next()/.prev()/.goTo() is called again before the
    // previous call has finished flipping - a real concern for a button a
    // user might mash. 'redirect' immediately retargets the flip from
    // wherever it visually is (responsive, but a fast burst blurs past
    // every word in between instead of visiting each one). 'rateLimit'
    // drops a call arriving less than `minStepInterval` after the last one
    // that was accepted, so every accepted flip finishes before the next
    // is even considered. 'queue' lets the current flip finish, then plays
    // queued calls back-to-back in order, so every call is eventually
    // honored (a big burst queues up a correspondingly long visible run).
    // See shared/sequence-stepper.js.
    stepPolicy: 'redirect',
    // ms - only meaningful with stepPolicy: 'rateLimit'.
    minStepInterval: 450,
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
      this._contStateStart = null;
      // Shared animated-position engine: drives both the manual
      // .next()/.prev()/.goTo() flips and, below, 'continuous' driveMode's
      // hold/flip/rollback clock - see shared/sequence-stepper.js. Rolodex
      // always steps eased (a physical card flip), unlike Type Pan's
      // constant-pace typing, so it sets its own default easing.
      this._stepper = new global.SequenceStepper({
        ease: global.SequenceStepper.smoothstep,
        stepPolicy: this.options.stepPolicy,
        minStepIntervalMs: this.options.minStepInterval,
      });
      this._scrollActive = false;
      this._scrollIdleTimer = null;
      this._scrollDirection = 0;
      this._displaySegmentFloat = null;
      this._onScroll = this._onScroll.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);
      // In 'hover' driveMode the element stays put on the page — wheel
      // input over it drives the flip directly (same progress math as
      // 'scroll' mode) instead of scrolling the page. Other drive modes
      // ignore wheel entirely, letting the page scroll as normal.
      this._onWheel = (event) => {
        if (this.options.driveMode !== 'hover') return;
        event.preventDefault();
        this.pushProgress(this._progress + event.deltaY / this.options.hoverScrollDistance);
      };

      this._buildDOM();
      // Requires shared/hover-scroll-source.js to also be loaded - lets
      // wheel/trackpad input over this element, or over any other element
      // tagged `data-rolodex-hover="<this element's id>"`, drive the flip
      // in 'hover' driveMode (see _onWheel above).
      this._hoverSource = bindHoverScrollSource(this.el, 'data-rolodex-hover', this._onWheel);
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
      this._contStateStart = null;
      this._stepper.jumpTo(0);
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
      this.pushProgress(viewportProgress(this.el));
    }

    // Feeds a new 0-1 progress value in from whatever is driving the flip —
    // real page scroll (_onScroll), wheel input in 'hover' driveMode
    // (_onWheel), or an external driver standing in for scroll (e.g. the
    // homepage carousel, which calls this directly). Shared so every
    // source gets the same direction-tracking and active/idle bookkeeping
    // _tick relies on to push the display forward/backward while driving
    // is active, then finish any fold still underway once it goes idle
    // instead of leaving it parked mid-flip.
    pushProgress(value) {
      // Real input always wins over an in-flight .next()/.prev()/.goTo()
      // step - cancel it and seed the display from wherever it visually
      // was, so the catch-up logic below resumes from there instead of
      // this call being silently ignored until the step lands on its own.
      if (this._stepper.isStepping) {
        this._displaySegmentFloat = this._stepper.value;
        this._stepper.jumpTo(this._stepper.value);
      }
      const next = this.options.loopScroll ? value : clamp(value, 0, 1);
      // Remember which way progress last actually moved (increasing folds
      // forward, decreasing unfolds) — the idle settle below finishes a
      // fold in this direction rather than toward whichever end happens to
      // be numerically nearer, so it never reverses on its own.
      if (next !== this._progress) {
        this._scrollDirection = next > this._progress ? 1 : -1;
      }
      this._progress = next;

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

    // Number of flip transitions the word list is spread across. Normally
    // (words.length - 1): a straight line from the first word to the last.
    // With `loopScroll`, the list is circular instead - one extra
    // transition bridges the last word back to the first - so it's the
    // full words.length, and segment index `segments - 1` is that
    // wrap-around transition.
    _segmentCount() {
      return this.options.loopScroll ? this._words.length : Math.max(1, this._words.length - 1);
    }

    // Reshapes a continuous position along this._segmentCount() flip
    // transitions into {segmentIndex, flipT} using the flip window above.
    // Without `loopScroll`, segmentFloat is clamped to the line's two ends.
    // With it, segmentFloat can be any real number (scrolling/wheeling
    // indefinitely in either direction) and wraps via modulo instead - so
    // running well past the last word's transition just keeps landing back
    // on earlier ones, in order, forever.
    _segmentFromFloat(segmentFloat) {
      const segments = this._segmentCount();
      const clamped = this.options.loopScroll ? mod(segmentFloat, segments) : clamp(segmentFloat, 0, segments);
      const segmentIndex = clamp(Math.floor(clamped), 0, segments - 1);
      const localT = segments > 0 ? clamped - segmentIndex : 0;

      const { flipStart, flipEnd } = this._flipWindow();
      const rawFlipT = flipEnd > flipStart
        ? (localT - flipStart) / (flipEnd - flipStart)
        : localT;
      const flipT = smoothstep(clamp(rawFlipT, 0, 1));

      return { segmentIndex, flipT };
    }

    // Maps scroll progress onto this._segmentCount() flip transitions.
    _segmentForProgress(progress) {
      const segments = this._segmentCount();
      const p = this.options.loopScroll ? progress : clamp(progress, 0, 1);
      return this._segmentFromFloat(p * segments);
    }

    // Converts the stepper's raw running position into {segmentIndex,
    // flipT} for 'continuous' driveMode and manual .next()/.prev() steps -
    // the fractional part of the position directly IS flipT, since the
    // stepper's own easing already shapes the motion in time (unlike
    // _segmentFromFloat above, which shapes a scroll-paced position
    // spatially through the flip-window). The one edge case: sitting
    // exactly at (or, without `loopScroll`, past) the last segment reads as
    // "fully landed on the last word" (flipT 1), not "0% into a segment
    // that doesn't exist".
    _continuousSegmentFromValue(value) {
      const segments = this._segmentCount();
      if (!this.options.loopScroll && value >= segments) {
        return { segmentIndex: Math.max(0, segments - 1), flipT: 1 };
      }
      const wrapped = this.options.loopScroll ? mod(value, segments) : clamp(value, 0, segments);
      const segmentIndex = clamp(Math.floor(wrapped), 0, segments - 1);
      return { segmentIndex, flipT: wrapped - segmentIndex };
    }

    // Drives {segmentIndex, flipT} from a clock instead of scroll position:
    // hold on the current word for `interval`, flip to the next word over
    // `flipDuration` (a single stepTo() on the shared stepper - see
    // shared/sequence-stepper.js). Without `loopScroll` the word list is a
    // straight line, so once the last word is reached there's nowhere to
    // flip on TO - it rewinds straight back to the first word over
    // `rollbackSpeed` (eased, so it reads like a physical rolodex spinning
    // back to start) before holding again. With `loopScroll` the list is
    // already circular, so the "last" word's flip just wraps forward into
    // the first word like any other transition - no rewind needed or
    // wanted, and the stepper's position just keeps climbing forever
    // (_continuousSegmentFromValue above wraps it for rendering).
    _computeContinuous(now) {
      const { loopScroll, interval, flipDuration, rollbackSpeed } = this.options;
      const segments = this._segmentCount();

      if (this._contState == null) {
        this._contState = 'hold';
        this._stepper.jumpTo(0);
        this._contStateStart = now;
      }

      if (this._contState === 'hold') {
        if (now - this._contStateStart >= interval) {
          const atEnd = !loopScroll && this._stepper.value >= segments;
          this._contState = atEnd ? 'rollback' : 'flip';
          // stepToDirect, not stepTo: this is the automatic clock's own
          // step, which must never be rate-limited or queued behind
          // stepPolicy (that governs manual .next()/.prev()/.goTo() calls a
          // person might mash, not the effect's own internal animation) -
          // see the comment on stepToDirect in sequence-stepper.js.
          this._stepper.stepToDirect(
            atEnd ? 0 : this._stepper.value + 1,
            { duration: atEnd ? rollbackSpeed : flipDuration },
          );
        }
      } else if (!this._stepper.isStepping) {
        // The flip or rollback step just landed.
        this._contState = 'hold';
        this._contStateStart = now;
      }

      return this._continuousSegmentFromValue(this._stepper.tick(now));
    }

    // Seeds the stepper from the currently displayed position if it isn't
    // already mid-step (or mid-queue - see stepPolicy), so a fresh
    // .next()/.prev()/.goTo() call always starts from where the flip
    // visually is, not wherever the stepper was last left, since
    // scroll/hover driving in between doesn't touch it.
    _seedStepIfIdle() {
      if (!this._stepper.isStepping) {
        this._stepper.jumpTo(this._displaySegmentFloat != null ? this._displaySegmentFloat : 0);
      }
    }

    // Starts (or, per stepPolicy, redirects/rate-limits/queues) a step to
    // the next/previous word, animated like a single 'continuous'-mode
    // flip. Intended for 'scroll'/'hover' driveMode, the same scope as
    // .pushProgress() - in 'continuous' driveMode the automatic
    // hold/flip/rollback clock is already stepping the same shared stepper
    // and may override a manual call once its own hold timer next elapses.
    _beginStep(delta, options) {
      this._seedStepIfIdle();
      const segments = this._segmentCount();
      const rawTarget = Math.round(this._stepper.target) + delta;
      const target = this.options.loopScroll ? rawTarget : clamp(rawTarget, 0, segments);
      this._stepper.stepTo(target, { duration: this.options.flipDuration, ...options });
    }

    // Flip forward/back one word, animated over `flipDuration`.
    next(options) {
      this._beginStep(1, options);
    }

    prev(options) {
      this._beginStep(-1, options);
    }

    // Flip directly to word `wordIndex`, at the same per-word pace as a
    // single next()/prev() flip (`flipDuration` ms/word) rather than a
    // fixed total duration - so a multi-word jump visibly flips through
    // every word in between at a normal pace instead of racing through
    // them. Pass `duration` in `options` to override that with a fixed
    // total time regardless of distance instead.
    goTo(wordIndex, options) {
      this._seedStepIfIdle();
      const segments = this._segmentCount();
      let target;
      if (this.options.loopScroll) {
        // The raw position can have wrapped many times over by now (e.g.
        // after a while idle-cycling via `loop`), so `wordIndex` itself
        // could be a long way behind it. Every multiple of `segments`
        // added to `wordIndex` is an equally valid stand-in for the same
        // word once wrapping - jump to whichever one is actually nearest
        // the current position instead of always sweeping literally back
        // to `wordIndex`.
        const from = this._stepper.target;
        const k = Math.round((from - wordIndex) / segments);
        target = wordIndex + k * segments;
      } else {
        target = clamp(wordIndex, 0, segments);
      }
      this._stepper.stepTo(target, { paceMs: this.options.flipDuration, ...options });
    }

    _applySegment(segmentIndex, force) {
      if (!this._refs || (!force && segmentIndex === this._lastSegment)) return;
      this._lastSegment = segmentIndex;
      const wordCount = this._words.length;
      const sourceWord = this.options.loopScroll ? this._words[segmentIndex % wordCount] : this._words[segmentIndex];
      const targetWord = this.options.loopScroll
        ? this._words[(segmentIndex + 1) % wordCount]
        : this._words[segmentIndex + 1];

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
        } else if (this._stepper.isStepping) {
          // A manual .next()/.prev() step is in flight (only reachable in
          // 'scroll'/'hover' driveMode - 'continuous' is handled above).
          ({ segmentIndex, flipT } = this._continuousSegmentFromValue(this._stepper.tick(performance.now())));
          if (!this._stepper.isStepping) {
            // Just landed - write the settled position back into the
            // display/progress scroll/hover input reads from, so it
            // resumes from here instead of snapping to a stale value.
            const segments = this._segmentCount();
            this._displaySegmentFloat = this._stepper.value;
            this._contState = null;
            this._progress = this.options.loopScroll
              ? this._displaySegmentFloat / segments
              : clamp(this._displaySegmentFloat / segments, 0, 1);
          }
        } else {
          // Shared by 'scroll' and 'hover': both just feed `this._progress`
          // (0-1) into the same easing/idle-settle logic below — 'scroll'
          // sets it from page scroll position (_onScroll), 'hover' sets it
          // from wheel input over the element (_onWheel).
          const segments = this._segmentCount();
          const rawSegmentFloat = (this.options.loopScroll ? this._progress : clamp(this._progress, 0, 1)) * segments;
          let loopCont = null;

          if (this._displaySegmentFloat == null) {
            this._displaySegmentFloat = rawSegmentFloat;
          } else if (this._scrollActive) {
            // Real input resumed - drop any idle auto-loop run so the next
            // idle period reseeds fresh from wherever this leaves us,
            // rather than resuming mid-cycle from an unrelated word.
            this._contState = null;
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
          } else if (this.options.loop && this._contState != null) {
            // Idle and already mid auto-loop cycle from an earlier idle
            // tick: keep driving it from its own clock every frame, exactly
            // like 'continuous' driveMode does below. Deliberately skips
            // re-deriving "resting" from _displaySegmentFloat the way the
            // branch below does: that reshapes through the scroll
            // flip-window, which would reinterpret an in-flight continuous
            // flipT as "mid-fold" and hijack it into the snapping logic
            // below instead of letting _computeContinuous keep driving it -
            // stuttering the animation every frame instead of the smooth
            // motion 'continuous' driveMode gets.
            loopCont = this._computeContinuous(performance.now());
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
            } else if (this.options.loop) {
              // Fully landed (not mid-fold) and idle: instead of just
              // sitting on this word until scroll/hover input resumes, hand
              // off to the same hold/flip[/rollback] clock 'continuous'
              // driveMode uses (see _computeContinuous), seeded from the
              // word we're already resting on so the handoff is invisible.
              // `resting` is expressed in the outer segment space (already
              // `_segmentCount()`, same as here), so it's the WORD index
              // being rested on (wrapped back into range with mod, not just
              // clamped) that carries over, not the segment index/flipT
              // pairing itself - clamping the raw segment index straight in
              // instead would misread "just wrapped onto word 0" (possible
              // under `loopScroll`) as "at the line's end" and jump to the
              // last word instead.
              const wordCount = this._words.length;
              const restingWordIndex = mod(
                resting.flipT >= 1 ? resting.segmentIndex + 1 : resting.segmentIndex,
                wordCount,
              );
              const contSegments = this._segmentCount();
              const seedValue = clamp(restingWordIndex, 0, contSegments);
              const atEnd = seedValue >= contSegments;
              this._stepper.jumpTo(seedValue);
              if (atEnd) {
                // Already resting right at the line's end: start the
                // rewind immediately rather than holding there for a full
                // `interval` first (unlike the ordinary hold-then-rollback
                // the automatic clock does elsewhere) - it was already
                // sitting idle on the last word for however long input had
                // stopped, so an extra hold here would just be a second,
                // redundant pause.
                this._contState = 'rollback';
                // stepToDirect: see the comment in _computeContinuous above.
                this._stepper.stepToDirect(0, { duration: this.options.rollbackSpeed });
              } else {
                this._contState = 'hold';
              }
              this._contStateStart = performance.now();
              // Used as-is below, bypassing _segmentFromFloat: see the
              // comment on the branch above for why.
              loopCont = this._computeContinuous(performance.now());
            }
          }

          if (loopCont) {
            ({ segmentIndex, flipT } = loopCont);
            this._displaySegmentFloat = loopCont.segmentIndex + loopCont.flipT;
            // Keep `_progress` numerically aligned with the display while
            // the idle auto-loop is driving it. Real scroll/hover input
            // resuming (the `_scrollActive` branch above) computes its
            // target from `this._progress`, not from `_displaySegmentFloat`
            // directly - if `_progress` were left stale at wherever real
            // input last set it, the loop could carry the display well
            // away from that stale value (loop only ever advances forward),
            // and the first bit of real input afterward - especially
            // backward input, since `target = min(display, raw)` snaps
            // straight to `raw` rather than easing away from `display` -
            // would jump-cut to catch up to that stale spot instead of
            // animating the fold.
            this._progress = this.options.loopScroll
              ? this._displaySegmentFloat / segments
              : clamp(this._displaySegmentFloat / segments, 0, 1);
          } else {
            ({ segmentIndex, flipT } = this._segmentFromFloat(this._displaySegmentFloat));
          }
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
          // Through most of the fold, the panel peeking out from behind its
          // flap as the flap's foreshortened face shrinks IS the reveal -
          // panelTop (holding the target word) must stay visible under the
          // top flap the whole time it's rotating away, same for
          // panelBottom (source word) as the bottom flap rotates in.
          // The one pixel-exact exception is each flap's OWN un-rotated
          // resting state - topPhase === 0 (hasn't started lifting yet) and
          // bottomPhase === 1 (has fully landed) - where the flap is flat
          // and *supposed* to be the only thing visible, fully covering a
          // panel that's holding a different, stale word underneath. That
          // covering is implicit (matching clip-path, opaque background)
          // rather than enforced, and the same composited-layer
          // rasterization mismatch as above could leave a faint stray
          // fragment of the stale word peeking out around the edges.
          // Hiding the panel outright at exactly that flat/resting instant
          // removes the risk without touching the reveal itself.
          this._refs.panelTop.style.visibility = topPhase === 0 ? 'hidden' : 'visible';
          this._refs.panelBottom.style.visibility = bottomPhase === 1 ? 'hidden' : 'visible';
        }
      }

      this._raf = requestAnimationFrame(this._tick);
    }

    update(options = {}) {
      const modeChanged = 'mode' in options && options.mode !== this.options.mode;
      const driveModeChanged = 'driveMode' in options && options.driveMode !== this.options.driveMode;
      const loopChanged = 'loop' in options && options.loop !== this.options.loop;
      const loopScrollChanged = 'loopScroll' in options && options.loopScroll !== this.options.loopScroll;
      const stepPolicyChanged = 'stepPolicy' in options || 'minStepInterval' in options;
      Object.assign(this.options, options);
      if (modeChanged) this._buildDOM();
      if (stepPolicyChanged) {
        this._stepper.setPolicy({ stepPolicy: this.options.stepPolicy, minStepIntervalMs: this.options.minStepInterval });
      }
      if (driveModeChanged || loopScrollChanged) {
        // loopScroll changes the segment count itself (circular vs. a
        // straight line), so a mid-flight _displaySegmentFloat/_progress
        // from the old semantics can't just carry over - same full reset
        // driveMode changes already do.
        this._contState = null;
        this._stepper.jumpTo(0);
        this._contStateStart = null;
        this._lastSegment = -1;
        this._displaySegmentFloat = null;
        this._progress = 0;
        this._scrollActive = false;
        this._scrollDirection = 0;
        clearTimeout(this._scrollIdleTimer);
        if (this.options.driveMode === 'scroll') this._onScroll();
      } else if (loopChanged) {
        // Toggled mid-idle-loop or mid-hold: drop the auto-loop clock so
        // turning it back on reseeds from wherever the display actually is
        // instead of resuming an old, possibly now-unrelated cycle.
        this._contState = null;
      }
    }

    setText(value) {
      this.el.dataset.text = value || '';
      // _buildDOM() already resets the display/segment state below for the
      // new word count, but not _progress - _onScroll() only overwrites it
      // in 'scroll' driveMode, so 'hover'/'continuous' would otherwise
      // carry over a stale value from the old sentence (particularly
      // visible with `loopScroll`, where it can be arbitrarily large).
      this._progress = 0;
      this._buildDOM();
      this._onScroll();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._scrollIdleTimer);
      global.removeEventListener('scroll', this._onScroll);
      global.removeEventListener('resize', this._onResize);
      this._hoverSource.destroy();
    }
  }

  // Always returns a value in [0, m), unlike JS's `%` which can return
  // negative results for a negative `value`.
  function mod(value, m) {
    return ((value % m) + m) % m;
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
