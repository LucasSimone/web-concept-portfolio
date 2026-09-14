/**
 * Carousel
 * --------
 * Drives a set of absolutely-positioned cards with wheel/drag input. Unlike
 * a normal slider, the "enlarged" (focused) card's on-screen anchor point
 * itself sweeps across the viewport as you move through the list: left edge
 * at the first card, center at the midpoint, right edge at the last card.
 *
 * Cards are packed edge-to-edge — each card's width shrinks with distance
 * from the focused one (same exponential falloff as its opacity), and
 * every card's screen position is the cumulative sum of its neighbors'
 * half-widths, so there's never a gap between them even as the strip
 * compresses toward the background.
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
 */
(function (global) {
  const DEFAULTS = {
    leftAnchor: 0.2,
    rightAnchor: 0.8,
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
      this.track = root.firstElementChild;
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
      global.addEventListener('resize', this._onResize);

      this.refresh();
      this._raf = requestAnimationFrame(this._tick);
    }

    // Re-reads which cards are visible (e.g. after a filter change) and
    // jumps back to the first one — call after hiding/showing cards.
    refresh() {
      this._cards = Array.from(this.track.children).filter((el) => !el.hidden);
      this._maxIndex = Math.max(0, this._cards.length - 1);
      this._width = this.root.clientWidth;
      this._cardWidth = this._cards[0] ? this._cards[0].getBoundingClientRect().width : 0;
      this._pos = 0;
      this._velocity = 0;
      this._render();
    }

    _onResize() {
      this._width = this.root.clientWidth;
      if (this._cards[0]) this._cardWidth = this._cards[0].getBoundingClientRect().width;
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
        const snapTarget = clamp(Math.round(this._pos), 0, this._maxIndex);
        this._velocity += (snapTarget - this._pos) * this.options.snapStrength;
        this._velocity *= this.options.friction;
        if (Math.abs(this._velocity) < 0.0004 && Math.abs(snapTarget - this._pos) < 0.0004) {
          this._velocity = 0;
          this._pos = snapTarget;
        } else {
          this._pos = clamp(this._pos + this._velocity, 0, this._maxIndex);
        }
      }
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    _render() {
      const { leftAnchor, rightAnchor, minScale, scaleDecay } = this.options;
      const n = this._cards.length;
      if (n === 0) return;

      const p = this._maxIndex > 0 ? this._pos / this._maxIndex : 0.5;
      const anchorPx = (leftAnchor + p * (rightAnchor - leftAnchor)) * this._width;

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
        const opacity = clamp(1 - ad * 0.32, 0.05, 1);

        card.style.transform = `translate(calc(${x.toFixed(2)}px - 50%), -50%) scale(${scales[i].toFixed(3)})`;
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = Math.round(1000 - ad * 10);
      });
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._wheelIdleTimer);
      this.root.removeEventListener('wheel', this._onWheel);
      this.root.removeEventListener('pointerdown', this._onPointerDown);
      this.track.removeEventListener('click', this._onClickCapture, true);
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
