/**
 * SequenceStepper
 * ---------------
 * Low-level building block behind every effect that advances through a
 * discrete ordered sequence one unit at a time - Rolodex's words, Type
 * Pan's characters. Tracks a single animated scalar position with two ways
 * to move it:
 *
 *   .jumpTo(value)   - snap straight there, no animation. For mounting,
 *                      hard resets, or a continuously-driven input (real
 *                      scroll/wheel position) that's already a smooth
 *                      stream of values and doesn't need re-animating.
 *   .stepTo(target, { paceMs, duration, ease }) - animate there at a
 *                      constant speed: either `paceMs` per unit of
 *                      distance (the default), or a fixed total `duration`
 *                      regardless of distance, so a single-unit step and a
 *                      whole-sequence sweep can share the same engine at
 *                      different grain.
 *
 * .next()/.prev() are sugar for stepping one unit from the current target
 * - the same move-by-one primitive an effect's own hold/flip/type/erase
 * clock is built out of, one call at a time, instead of a separate
 * hand-rolled timer/state machine per drive mode.
 *
 * What happens when a new stepTo() (or next()/prev()) arrives before the
 * previous one has finished - a real concern for anything wired to a
 * button a user might mash - depends on `stepPolicy` (set at construction
 * or via .setPolicy()):
 *
 *   'redirect'  (default) - the new call immediately retargets the
 *               animation from wherever it visually is right now. Feels
 *               the most responsive, but a fast burst blurs past every
 *               intermediate value instead of visiting each one.
 *   'rateLimit' - a call arriving less than `minStepIntervalMs` after the
 *               last one that was accepted is dropped outright. Guarantees
 *               every accepted step gets to visibly finish before the next
 *               is even considered.
 *   'queue'     - a call that arrives while already stepping is queued
 *               instead of redirecting; each queued step plays out in
 *               order once the one ahead of it lands. Guarantees every
 *               call is eventually honored, but a big burst queues up a
 *               correspondingly long visible run.
 *
 * Deliberately has no notion of bounds or wraparound - "can't go past the
 * last word" (Rolodex, unless looping) and "can't go past the last
 * character" (Type Pan, always) are different rules per effect, so callers
 * clamp/wrap the value they pass to jumpTo()/stepTo() themselves.
 *
 * Call .tick(now) once per animation frame to advance and read the current
 * value - a no-op that just returns the current value while idle, so it's
 * safe to call unconditionally regardless of what's driving the position.
 */
(function (global) {
  const LINEAR = (t) => t;

  class SequenceStepper {
    constructor({ paceMs = 60, ease = LINEAR, stepPolicy = 'redirect', minStepIntervalMs = 0 } = {}) {
      this.defaultPaceMs = paceMs;
      this.defaultEase = ease;
      this.stepPolicy = stepPolicy;
      this.minStepIntervalMs = minStepIntervalMs;
      this._value = 0;
      this._from = 0;
      this._to = 0;
      this._start = 0;
      this._durationMs = 0;
      this._ease = ease;
      this._active = false;
      this._lastStepAt = -Infinity;
      this._queue = [];
    }

    // Current animated position.
    get value() {
      return this._value;
    }

    // Where a call to .next()/.prev() steps from: the far end of the queue
    // if `stepPolicy: 'queue'` has one built up, the in-flight destination
    // while actively stepping (so consecutive calls chain from each other
    // rather than from the animation's current mid-flight point), or the
    // resting value otherwise.
    get target() {
      if (this._queue.length > 0) return this._queue[this._queue.length - 1].target;
      return this._active ? this._to : this._value;
    }

    get isStepping() {
      return this._active;
    }

    // Changes stepPolicy/minStepIntervalMs and clears any queued or
    // rate-limit state - switching policy mid-flight shouldn't leave a
    // queue built up under the old policy, or a rate-limit window from it,
    // carrying over into the new one. Fields left undefined keep their
    // current value.
    setPolicy({ stepPolicy, minStepIntervalMs } = {}) {
      if (stepPolicy != null) this.stepPolicy = stepPolicy;
      if (minStepIntervalMs != null) this.minStepIntervalMs = minStepIntervalMs;
      this._queue = [];
      this._lastStepAt = -Infinity;
    }

    // Instant, unanimated - cancels any in-flight step and drops any queue.
    jumpTo(value) {
      this._active = false;
      this._queue = [];
      this._value = value;
      this._from = this._to = value;
      return this._value;
    }

    // Begin (or, under 'redirect', retarget) an animated move to `target`.
    // Pass `paceMs` (ms per unit of distance) or a fixed total `duration` -
    // not both; either falls back to this instance's default pace. `ease`
    // overrides this instance's default easing curve for just this step.
    // See stepPolicy above for what happens when this is called again
    // before the previous step has finished.
    stepTo(target, options = {}) {
      const now = performance.now();

      if (this.stepPolicy === 'rateLimit' && now - this._lastStepAt < this.minStepIntervalMs) {
        return;
      }
      if (this.stepPolicy === 'queue' && this._active) {
        this._queue.push({ target, ...options });
        return;
      }
      this._startStep(target, options, now);
    }

    // Like stepTo(), but always starts immediately - ignores stepPolicy
    // entirely instead of possibly dropping or queuing the call. For a
    // driveMode's own automatic clock (continuous mode's hold/flip/rollback,
    // type/hold/erase), which drives this same stepper instance but must
    // never be rate-limited or queued behind stepPolicy: that setting is
    // documented as governing only user-facing .next()/.prev()/.goTo() calls
    // a person might mash, not the effect's own internal animation. Without
    // this, a 'rateLimit' policy - reachable from the demo's own "Step
    // policy" control regardless of driveMode - could silently drop the
    // clock's own stepTo() calls; the calling state machine would then
    // misread the no-op as "the step already landed" and stretch its hold
    // out to whatever's left of minStepIntervalMs instead of the configured
    // interval/typeDuration.
    stepToDirect(target, options = {}) {
      this._startStep(target, options, performance.now());
    }

    _startStep(target, { paceMs, duration, ease } = {}, now) {
      const from = this._value;
      if (target === from) {
        this._active = false;
        return;
      }
      const distance = Math.abs(target - from);
      const ms = duration != null ? duration : distance * (paceMs != null ? paceMs : this.defaultPaceMs);
      this._from = from;
      this._to = target;
      this._durationMs = Math.max(0, ms);
      this._ease = ease || this.defaultEase;
      this._start = now;
      this._active = true;
      this._lastStepAt = now;
    }

    next(options) {
      this.stepTo(this.target + 1, options);
    }

    prev(options) {
      this.stepTo(this.target - 1, options);
    }

    // Advances an in-flight step and returns the current value. Once a
    // step lands, starts the next queued one (if `stepPolicy: 'queue'` has
    // any waiting) immediately, so a queued run plays out back-to-back
    // rather than pausing between steps.
    tick(now = performance.now()) {
      if (!this._active) return this._value;
      const t = this._durationMs > 0 ? clamp((now - this._start) / this._durationMs, 0, 1) : 1;
      this._value = this._from + (this._to - this._from) * this._ease(t);
      if (t >= 1) {
        this._value = this._to;
        this._active = false;
        // A queued target equal to the value just landed on is a zero-
        // distance step - _startStep leaves it inactive rather than
        // starting it, so keep draining the queue instead of stopping
        // there and stranding whatever's still behind it.
        while (!this._active && this._queue.length > 0) {
          const next = this._queue.shift();
          this._startStep(next.target, next, now);
        }
      }
      return this._value;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Exposed as a small shared utility - Rolodex, Type Pan, and
  // scroll-progress.js all otherwise carried their own identical copy.
  SequenceStepper.clamp = clamp;

  SequenceStepper.smoothstep = function smoothstep(t) {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  };

  global.SequenceStepper = SequenceStepper;
})(window);
