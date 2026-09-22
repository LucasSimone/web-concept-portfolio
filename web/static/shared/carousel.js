/**
 * Carousel
 * --------
 * Drives a set of absolutely-positioned cards with wheel/drag input. Unlike
 * a normal slider, the "enlarged" (focused) card's on-screen anchor point
 * itself sweeps across the viewport as you move through the list: its left
 * edge flush with the viewport's left edge at the first card, centered at
 * the midpoint, its right edge flush with the viewport's right edge at the
 * last card.
 *
 * The outer track box is sized to fit the tallest (focused) card exactly,
 * so it never has to clip anything vertically. The top/bottom guide lines
 * are separate elements positioned inside it at the next-door neighbor's
 * height instead — one step down the same scale curve — and sit behind the
 * cards in stacking order, so the focused card visibly overflows past them
 * instead of being boxed in by them.
 *
 * Cards are packed edge-to-edge — each card's width shrinks (exponential
 * falloff, staying fully opaque throughout) with distance from the focused
 * one, and every card's screen position is the cumulative sum of its
 * neighbors' half-widths, so there's never a gap between them even as the
 * strip compresses toward the background.
 *
 * Input has two distinct phases. While wheel/drag input is actively
 * arriving, position tracks it directly, 1:1, with zero resistance. Once
 * input goes idle (wheel: a short pause; drag: pointerup), the carousel
 * switches to a damped-spring coast: the velocity built up during input
 * decays via friction while a gentle constant pull toward the nearest card
 * is folded in, so it always settles exactly on a card instead of just
 * stopping wherever the input happened to end.
 *
 * Wheel input is only captured while there's room left to move — at either
 * boundary the event is left alone so normal page scroll continues past
 * the carousel instead of trapping the cursor.
 *
 * Once a card actually comes to rest in the focus position (not just
 * passed through while moving), it gets a bubbling 'carousel-settle'
 * event - lets a page react to "this card just became the focused one"
 * without reaching into the carousel's own position tracking.
 *
 * The pointer also drives focus directly: while it's over a card (and
 * nothing's being dragged or actively wheeled), that card is the settle
 * spring's target instead of the nearest integer to the current position,
 * so mousing across the strip pulls the focused card along with it the
 * same way scrolling to it would.
 */
(function (global) {
  const DEFAULTS = {
    cardStep: 200,
    minScale: 0.42,
    scaleDecay: 0.75,
    wheelSensitivity: 1,
    wheelIdleDelay: 140,
    maxVelocity: 0.4,
    friction: 0.8,
    snapStrength: 0.045,
    dragThreshold: 6,
  };

  class Carousel {
    constructor(root, options = {}) {
      if (!root) throw new Error('Carousel: root element is required');
      this.root = root;
      this.track = root.querySelector('.carousel-track');
      this.topLine = root.querySelector('[data-carousel-line="top"]');
      this.bottomLine = root.querySelector('[data-carousel-line="bottom"]');
      this.options = { ...DEFAULTS, ...options };

      this._pos = 0;
      this._velocity = 0;
      this._cards = [];
      this._maxIndex = 0;
      this._width = root.clientWidth;
      this._cardWidth = 0;
      this._dragging = false;
      this._dragStartX = 0;
      this._dragStartPos = 0;
      this._dragMoved = 0;
      this._dragPrevPos = 0;
      this._wheelActive = false;
      this._wheelIdleTimer = null;
      // Index of the card currently under the pointer, or null when the
      // pointer isn't over any card - see the _hoverDelegate binding below.
      // While set, it's the settle spring's target instead of the nearest
      // integer to _pos, so mousing across the cards pulls the focused
      // position along with it exactly like scrolling/dragging there
      // would.
      this._hoverIndex = null;
      // -1 so the very first settle (including index 0) always fires.
      this._settledIndex = -1;
      // Remembers the focused card per carousel (by element id) across page
      // loads within the same tab, so navigating to an effect and back to
      // the homepage doesn't dump you back at card 0. sessionStorage (not
      // localStorage) so it fades once the tab/session ends rather than
      // sticking around indefinitely. Restored once, on the first refresh()
      // - later refresh() calls (e.g. from a type filter change) still
      // reset to card 0 as before.
      this._persistKey = root.id ? `carousel-pos:${root.id}` : null;
      this._restored = false;

      this._onWheel = this._onWheel.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onClickCapture = this._onClickCapture.bind(this);
      this._onResize = this._onResize.bind(this);
      this._tick = this._tick.bind(this);

      this.root.addEventListener('wheel', this._onWheel, { passive: false });
      this.root.addEventListener('pointerdown', this._onPointerDown);
      this.track.addEventListener('click', this._onClickCapture, true);
      // See shared/hover-delegate.js for why this needs mousemove-based
      // delegation rather than the track's own mouseenter/mouseleave.
      // Ignored while dragging - a swipe shouldn't also go chasing
      // whatever card the pointer happens to cross on its way past
      // (_onPointerDown clears any pre-drag hover target of its own).
      this._hoverDelegate = bindHoverDelegate(this.track, '.variation-card', (card) => {
        if (this._dragging) return;
        if (!card) {
          this._hoverIndex = null;
          return;
        }
        const index = this._cards.indexOf(card);
        if (index !== -1) this._hoverIndex = index;
      });
      global.addEventListener('resize', this._onResize);

      this.refresh();
      this._raf = requestAnimationFrame(this._tick);
    }

    // Re-reads which cards are visible (e.g. after a filter change) and
    // jumps back to the first one — call after hiding/showing cards. The
    // very first call (from the constructor) instead restores whatever
    // card was last focused, if one was persisted (see _persistKey).
    refresh() {
      this._cards = Array.from(this.track.children).filter((el) => !el.hidden);
      this._maxIndex = Math.max(0, this._cards.length - 1);
      this._measure();

      let startIndex = 0;
      if (!this._restored) {
        this._restored = true;
        const stored = this._readStoredIndex();
        if (stored !== null) startIndex = clamp(stored, 0, this._maxIndex);
      }

      this._pos = startIndex;
      this._velocity = 0;
      this._hoverIndex = null;
      this._settledIndex = -1;
      this._setSettledIndex(startIndex);
      this._render();
    }

    _readStoredIndex() {
      if (!this._persistKey) return null;
      try {
        const raw = sessionStorage.getItem(this._persistKey);
        if (raw === null) return null;
        const index = parseInt(raw, 10);
        return Number.isFinite(index) ? index : null;
      } catch (e) {
        return null;
      }
    }

    _writeStoredIndex(index) {
      if (!this._persistKey) return;
      try {
        sessionStorage.setItem(this._persistKey, String(index));
      } catch (e) {
        // Ignore (e.g. storage disabled/full) - just means it won't persist.
      }
    }

    // Fires a 'carousel-settle' event (bubbling) on the card at `index`
    // once it's the one actually at rest in the focus position - not on
    // every card passed through while moving. Lets a page react to "this
    // specific card just became the focused one" (e.g. resetting a
    // preview's animation) without reaching into the carousel's own
    // position tracking.
    _setSettledIndex(index) {
      if (index === this._settledIndex) return;
      this._settledIndex = index;
      this._writeStoredIndex(index);
      const card = this._cards[index];
      if (card) card.dispatchEvent(new CustomEvent('carousel-settle', { bubbles: true }));
    }

    _onResize() {
      this._measure();
    }

    // Reads the natural (unscaled) card box — offsetWidth/offsetHeight are
    // the layout box and ignore CSS transforms (unlike
    // getBoundingClientRect, which would return whatever scale _render()
    // last applied to this particular card), so any one visible card gives
    // the shared base size regardless of which card is currently focused —
    // and places the guide lines at a distance-1 neighbor's height so they
    // land exactly on its top/bottom edge.
    _measure() {
      this._width = this.root.clientWidth;
      const card = this._cards[0];
      if (!card) return;
      this._cardWidth = card.offsetWidth;
      const neighborScale = this.options.minScale + (1 - this.options.minScale) * Math.exp(-this.options.scaleDecay);
      const halfNeighborHeight = (card.offsetHeight * neighborScale) / 2;
      if (this.topLine) this.topLine.style.top = `calc(50% - ${halfNeighborHeight.toFixed(2)}px)`;
      if (this.bottomLine) this.bottomLine.style.top = `calc(50% + ${halfNeighborHeight.toFixed(2)}px)`;
    }

    _onWheel(event) {
      const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      const deltaIndex = (raw * this.options.wheelSensitivity) / this.options.cardStep;
      const atStart = this._pos <= 0.0005 && deltaIndex < 0;
      const atEnd = this._pos >= this._maxIndex - 0.0005 && deltaIndex > 0;
      if (atStart || atEnd) return;

      event.preventDefault();
      this._pos = clamp(this._pos + deltaIndex, 0, this._maxIndex);
      this._velocity = clamp(deltaIndex, -this.options.maxVelocity, this.options.maxVelocity);

      // The strip is about to slide under a stationary cursor, which would
      // leave a stale _hoverIndex fighting the scroll for the settle
      // target once it goes idle - see the _hoverDelegate binding above.
      this._hoverIndex = null;
      this._wheelActive = true;
      clearTimeout(this._wheelIdleTimer);
      this._wheelIdleTimer = setTimeout(() => {
        this._wheelActive = false;
      }, this.options.wheelIdleDelay);
    }

    _onPointerDown(event) {
      if (this._maxIndex <= 0) return;
      this._dragging = true;
      this._dragMoved = 0;
      this._velocity = 0;
      // Same reasoning as _onWheel: a drag is about to move cards under a
      // pointer that isn't itself generating mousemove hover updates, so
      // any pre-drag hover target must not survive to fight the release.
      this._hoverIndex = null;
      this._dragStartX = event.clientX;
      this._dragStartPos = this._pos;
      this._dragPrevPos = this._pos;
      this.root.classList.add('is-dragging');
      global.addEventListener('pointermove', this._onPointerMove);
      global.addEventListener('pointerup', this._onPointerUp);
    }

    _onPointerMove(event) {
      if (!this._dragging) return;
      const dx = event.clientX - this._dragStartX;
      this._dragMoved = Math.max(this._dragMoved, Math.abs(dx));
      this._pos = clamp(this._dragStartPos - dx / this.options.cardStep, 0, this._maxIndex);
      this._velocity = this._pos - this._dragPrevPos;
      this._dragPrevPos = this._pos;
    }

    _onPointerUp() {
      this._dragging = false;
      this.root.classList.remove('is-dragging');
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
    }

    // Dragging past the click threshold suppresses the card's own click so
    // a swipe doesn't also fire navigation to the concept page.
    _onClickCapture(event) {
      if (this._dragMoved > this.options.dragThreshold) {
        event.preventDefault();
        event.stopPropagation();
      }
      this._dragMoved = 0;
    }

    _tick() {
      const settling = !this._dragging && !this._wheelActive;
      if (settling) {
        const snapTarget = this._hoverIndex !== null
          ? this._hoverIndex
          : clamp(Math.round(this._pos), 0, this._maxIndex);
        this._velocity += (snapTarget - this._pos) * this.options.snapStrength;
        this._velocity *= this.options.friction;
        if (Math.abs(this._velocity) < 0.0004 && Math.abs(snapTarget - this._pos) < 0.0004) {
          this._velocity = 0;
          this._pos = snapTarget;
          this._setSettledIndex(snapTarget);
        } else {
          this._pos = clamp(this._pos + this._velocity, 0, this._maxIndex);
        }
      }
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    _render() {
      const { minScale, scaleDecay } = this.options;
      const n = this._cards.length;
      if (n === 0) return;

      // Anchor sweeps between the two positions where the focused (full
      // width) card sits flush against the left/right edge of the track —
      // not a fixed fraction of it — so there's never a gap at either end.
      const p = this._maxIndex > 0 ? this._pos / this._maxIndex : 0.5;
      const halfCard = this._cardWidth / 2;
      const anchorPx = halfCard + p * (this._width - this._cardWidth);

      // Scale every card off its distance from the focus point, then pack
      // them edge-to-edge (cumulative half-widths) so nothing gaps.
      const scales = new Array(n);
      const widths = new Array(n);
      for (let i = 0; i < n; i++) {
        const ad = Math.abs(i - this._pos);
        scales[i] = minScale + (1 - minScale) * Math.exp(-ad * scaleDecay);
        widths[i] = this._cardWidth * scales[i];
      }

      const centers = new Array(n);
      centers[0] = widths[0] / 2;
      for (let i = 1; i < n; i++) {
        centers[i] = centers[i - 1] + widths[i - 1] / 2 + widths[i] / 2;
      }

      // The continuous focus position sits between two integer cards while
      // moving — interpolate their packed centers to find what point in the
      // strip should land on the anchor, then shift the whole strip by that.
      const i0 = clamp(Math.floor(this._pos), 0, this._maxIndex);
      const i1 = clamp(i0 + 1, 0, this._maxIndex);
      const frac = this._pos - i0;
      const refPoint = centers[i0] + (centers[i1] - centers[i0]) * frac;
      const shift = anchorPx - refPoint;

      this._cards.forEach((card, i) => {
        const ad = Math.abs(i - this._pos);
        const x = centers[i] + shift;

        card.style.transform = `translate(calc(${x.toFixed(2)}px - 50%), -50%) scale(${scales[i].toFixed(3)})`;
        card.style.zIndex = Math.round(1000 - ad * 10);
      });
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._wheelIdleTimer);
      this.root.removeEventListener('wheel', this._onWheel);
      this.root.removeEventListener('pointerdown', this._onPointerDown);
      this.track.removeEventListener('click', this._onClickCapture, true);
      this._hoverDelegate.destroy();
      global.removeEventListener('resize', this._onResize);
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  global.Carousel = Carousel;
})(window);
