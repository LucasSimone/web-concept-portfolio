/**
 * Gears
 * -----
 * A canvas background of line-drawn gears in trains that really mesh:
 * every gear in a train shares one tooth size, sits exactly its pitch
 * distance from the gear it's driven by, and is phased so its teeth land
 * in the other's gaps. A train has a single degree of freedom, the
 * distance its pitch circles have rolled, so turning any one gear turns
 * the rest at the right ratio and in alternating directions: small gears
 * race, big ones crawl.
 *
 * Some trains have a motor, marked by a filled axle, and turn on their
 * own; the rest sit still until something moves them. Grabbing a gear and
 * dragging it round turns its whole train under the cursor, and letting go
 * mid-turn flicks it. Sweeping the cursor across a gear without pressing
 * pushes it the way a hand brushing past would. A flicked train coasts
 * back to its motor's speed, or to a stop if it has none.
 *
 * What's drawn inside each gear is the extension point: `decorate` takes a
 * built-in style ('auto', 'spokes', 'holes', 'plain') or a function that
 * adds its own shapes to the gear's outline path.
 *
 * Usage: give any element `class="bg-gears"` — this file injects its own
 * CSS and auto-initializes every matching element on load, so dropping the
 * `<script>` tag in and adding the class is the whole setup.
 */
(function (global) {
  const STYLE_ID = 'gears-styles';
  const CSS = `
.bg-gears {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #fff;
  color: #000;
}

.bg-gears.bg-gears--dark {
  color: #fff;
}

.gears__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  display: block;
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
    // Module, in px: a gear with N teeth has a pitch radius of N × this / 2,
    // so it sets both how big the teeth are and how big the gears are.
    toothSize: 4,
    maxTeeth: 36,
    // Share of the box the gears' pitch circles cover.
    density: 0.3,
    // How fast a motor rolls its train's pitch circles, in px/sec. Every
    // gear in a train moves its teeth at this speed, so its turning rate
    // is this over its own radius.
    speed: 16,
    // Share of trains that have a motor. Each train keeps its own fixed
    // roll against this, so moving it switches motors on or off one train
    // at a time instead of reshuffling them.
    powered: 0.5,
    // Seconds a flicked train takes to settle about two-thirds of the way
    // back to its motor speed (or to a stop).
    coast: 1.5,
    grab: true,
    brush: true,
    decorate: 'auto',
    color: '#000000',
    background: '#ffffff',
    lineWidth: 1.25,
  };

  const MIN_TEETH = 8;
  // Tooth outline, as fractions of one tooth's angular pitch and of the
  // module. Narrow tips over wide roots with a deep root circle: simple
  // trapezoid teeth like these only mesh without their outlines crossing
  // if they're slimmer than real involute ones. Checked by sampling a full
  // tooth's turn for pairs from 8 to 40 teeth: the outlines never cross,
  // and come within about a tenth of the tooth size at the tightest point,
  // which reads as teeth in contact.
  const TIP_HALF = 0.1;
  const ROOT_HALF = 0.28;
  const ADDENDUM = 0.9;
  const DEDENDUM = 1.25;
  // Space kept between the tips of gears that don't mesh, in modules.
  const GAP = 2;
  // The fastest any gear may spin, in revolutions/sec, however hard it's
  // flicked.
  const MAX_REVS = 2.5;
  // Time constant for the velocity estimate while a gear is being dragged
  // or brushed, so one jittery pointer event doesn't set the flick speed.
  const DRAG_SMOOTHING = 0.05;
  const BRUSH_SMOOTHING = 0.08;
  const TAU = Math.PI * 2;

  function wrapAngle(a) {
    return a - TAU * Math.round(a / TAU);
  }

  function polar(r, a) {
    return [r * Math.cos(a), r * Math.sin(a)];
  }

  // Any CSS color as [r, g, b, a], 0-255, by painting it into one pixel
  // and reading that back, the same way Fireworks does. Reading the
  // canvas's fillStyle string back instead only works for colors it
  // normalizes to #rrggbb or rgba(); newer ones like oklch() keep their
  // own syntax.
  let probe = null;
  function parseRgba(color) {
    if (!probe) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true });
    }
    probe.fillStyle = '#000000';
    probe.fillStyle = color;
    probe.globalCompositeOperation = 'copy';
    probe.fillRect(0, 0, 1, 1);
    probe.globalCompositeOperation = 'source-over';
    return Array.from(probe.getImageData(0, 0, 1, 1).data);
  }

  // A parsed [r, g, b, a] laid over an opaque [r, g, b] backdrop, as the
  // eye would see it.
  function over([r, g, b, a], backdrop) {
    const k = a / 255;
    return [r, g, b].map((c, i) => c * k + backdrop[i] * (1 - k));
  }

  // --- Decorations ----------------------------------------------------
  // Each adds subpaths to `path`, in the gear's own coordinates (center at
  // 0,0, unrotated), inside `gear.rootRadius`. The axle is drawn separately,
  // since it doubles as the motor marker.

  function plain(path, gear) {
    if (gear.hubRadius < gear.rootRadius - gear.toothSize) {
      path.moveTo(gear.hubRadius, 0);
      path.arc(0, 0, gear.hubRadius, 0, TAU);
    }
  }

  function holes(path, gear) {
    plain(path, gear);
    const inner = gear.hubRadius;
    const outer = gear.rootRadius - gear.toothSize * 1.2;
    const count = gear.teeth >= 26 ? 6 : 5;
    const mid = (inner + outer) / 2;
    const r = Math.min((outer - inner) / 2, mid * Math.sin(Math.PI / count)) * 0.7;
    if (r < 2) return;
    for (let i = 0; i < count; i++) {
      const [x, y] = polar(mid, (i / count) * TAU);
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, TAU);
    }
  }

  // Windows between spokes, each bounded by the rim, two spoke edges and
  // the hub, so the spokes and rim read as solid parts of one casting.
  function spokes(path, gear) {
    const hub = gear.hubRadius;
    const rim = gear.rootRadius - gear.toothSize * 1.5;
    const halfWidth = Math.max(1.5, gear.toothSize * 0.6);
    const count = gear.teeth >= 30 ? 6 : 5;
    const step = TAU / count;
    const hubInset = Math.asin(Math.min(1, halfWidth / hub));
    if (rim - hub < gear.toothSize * 2.5 || step - 2 * hubInset < 0.2) {
      holes(path, gear);
      return;
    }
    const rimInset = Math.asin(halfWidth / rim);
    for (let i = 0; i < count; i++) {
      const a = i * step;
      const b = a + step;
      path.moveTo(...polar(hub, a + hubInset));
      path.lineTo(...polar(rim, a + rimInset));
      path.arc(0, 0, rim, a + rimInset, b - rimInset);
      path.lineTo(...polar(hub, b - hubInset));
      path.arc(0, 0, hub, b - hubInset, a + hubInset, true);
      path.closePath();
    }
    const boss = hub * 0.55;
    path.moveTo(boss, 0);
    path.arc(0, 0, boss, 0, TAU);
  }

  function auto(path, gear) {
    if (gear.teeth >= 22) spokes(path, gear);
    else if (gear.teeth >= 14) holes(path, gear);
    else plain(path, gear);
  }

  const DECORATIONS = { auto, spokes, holes, plain };

  // The tooth outline, with flanks bent slightly outward (angle and radius
  // both move linearly between root and tip) the way involute teeth are.
  function toothOutline(path, teeth, rootRadius, tipRadius) {
    const T = TAU / teeth;
    const FLANK_STEPS = 4;
    for (let k = 0; k < teeth; k++) {
      const c = k * T;
      for (let i = 0; i <= FLANK_STEPS; i++) {
        const t = i / FLANK_STEPS;
        const point = polar(rootRadius + (tipRadius - rootRadius) * t, c - (ROOT_HALF - (ROOT_HALF - TIP_HALF) * t) * T);
        if (k === 0 && i === 0) path.moveTo(...point);
        else path.lineTo(...point);
      }
      path.arc(0, 0, tipRadius, c - TIP_HALF * T, c + TIP_HALF * T);
      for (let i = 1; i <= FLANK_STEPS; i++) {
        const t = i / FLANK_STEPS;
        path.lineTo(...polar(tipRadius + (rootRadius - tipRadius) * t, c + (TIP_HALF + (ROOT_HALF - TIP_HALF) * t) * T));
      }
      path.arc(0, 0, rootRadius, c + ROOT_HALF * T, c + T - ROOT_HALF * T);
    }
    path.closePath();
  }

  class Gears {
    constructor(el, options = {}) {
      if (!el) throw new Error('Gears: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this._reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gears__canvas';
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');
      this._applyBackground();

      this._gears = [];
      this._trains = [];
      this._area = 0;
      this._drag = null;
      this._hover = null;
      this._suppressClickUntil = 0;
      this._raf = null;
      this._lastNow = performance.now();

      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this._onTouchStart = this._onTouchStart.bind(this);
      this._onClick = this._onClick.bind(this);

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      // Stop the loop once the element has scrolled out of view, same as
      // the other backgrounds: requestAnimationFrame only pauses itself for
      // a hidden tab, not for an element scrolled far above the reader.
      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (on) this._start();
        else this._stop();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.el);

      this.el.addEventListener('pointerdown', this._onPointerDown);
      this.el.addEventListener('pointermove', this._onPointerMove);
      this.el.addEventListener('pointerup', this._onPointerUp);
      this.el.addEventListener('pointercancel', this._onPointerUp);
      this.el.addEventListener('pointerleave', this._onPointerLeave);
      // Not passive: a touch that lands on a gear has to stop the page
      // scrolling, and only touchstart can still do that. A touch anywhere
      // else scrolls as normal.
      this.el.addEventListener('touchstart', this._onTouchStart, { passive: false });
      // Capture, so a drag that ends over a link inside (or around) the
      // host doesn't also follow it.
      this.el.addEventListener('click', this._onClick, true);

      this._resize();
      this._start();
    }

    _start() {
      if (this._raf || this._reduced || !this._onScreen) return;
      this._lastNow = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    // The background is the canvas element's own CSS background. A dark
    // one also gives the host a class that turns its text white, so the
    // text on top stays readable. A see-through color is judged as it
    // looks over the host's own background (and that over a white page).
    // Anything that isn't a plain color ('transparent', a gradient) leaves
    // the host's text alone.
    _applyBackground() {
      const { background } = this.options;
      const paints = Boolean(background) && background !== 'transparent';
      this.canvas.style.background = paints ? background : '';
      let dark = false;
      if (paints && global.CSS.supports('color', background)) {
        const host = over(parseRgba(getComputedStyle(this.el).backgroundColor), [255, 255, 255]);
        const [r, g, b] = over(parseRgba(background), host);
        dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
      }
      this.el.classList.toggle('bg-gears--dark', dark);
    }

    // clientWidth/clientHeight rather than getBoundingClientRect, for the
    // same reason as the other backgrounds: the host may sit under a CSS
    // transform the canvas already inherits.
    //
    // A host with no size is hidden, not resized, and is skipped. A real
    // resize keeps every gear where it is, since moving one would break
    // its mesh, and only fills whatever new space opened up; gears left
    // outside a shrunken box stay put for when it grows back.
    _resize() {
      const width = this.el.clientWidth;
      const height = this.el.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (width === this._w && height === this._h && dpr === this._dpr) return;
      const first = !this._w;
      this._dpr = dpr;
      this._w = width;
      this._h = height;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      if (first) {
        this._rebuild();
      } else {
        this._recount();
        this._fill();
      }
      this._render();
    }

    // --- Layout -------------------------------------------------------

    _rebuild() {
      this._gears = [];
      this._trains = [];
      this._area = 0;
      this._endDrag();
      this._fill();
    }

    _makeGear(teeth, x, y) {
      const m = this.options.toothSize;
      const r = (m * teeth) / 2;
      return {
        teeth,
        x,
        y,
        toothSize: m,
        radius: r,
        rootRadius: r - DEDENDUM * m,
        tipRadius: r + ADDENDUM * m,
        hubRadius: Math.max(m * 1.6, r * 0.22),
        axleRadius: Math.max(1.5, m * 0.45),
        dir: 1,
        phase: 0,
        train: null,
        path: null,
      };
    }

    _randomTeeth() {
      const max = Math.max(MIN_TEETH, Math.round(this.options.maxTeeth));
      // Leans small, so a train is mostly small and middling gears around
      // the odd big one rather than a row of big ones.
      return MIN_TEETH + Math.round((max - MIN_TEETH) * Math.random() ** 1.4);
    }

    // Whether a gear fits at (x, y) without touching anything except the
    // one it meshes with. Centers may sit a little past the edge, so gears
    // run off it the way the circuit's traces do.
    _fits(gear, parent) {
      const slack = gear.radius * 0.4;
      if (gear.x < -slack || gear.x > this._w + slack || gear.y < -slack || gear.y > this._h + slack) return false;
      const gap = GAP * this.options.toothSize;
      for (const other of this._gears) {
        if (other === parent) continue;
        const min = gear.tipRadius + other.tipRadius + gap;
        const dx = gear.x - other.x;
        const dy = gear.y - other.y;
        if (dx * dx + dy * dy < min * min) return false;
      }
      return true;
    }

    // A gear counts toward `density` by its whole pitch circle if its
    // center is in the box, and not at all otherwise. What it counted is
    // kept on the gear, so taking it away later subtracts exactly that
    // even if the box has changed size since; a resize recounts the lot.
    _countArea(gear) {
      const inside = gear.x >= 0 && gear.x <= this._w && gear.y >= 0 && gear.y <= this._h;
      gear.counted = inside ? Math.PI * gear.radius * gear.radius : 0;
      this._area += gear.counted;
    }

    _recount() {
      this._area = 0;
      this._gears.forEach((gear) => this._countArea(gear));
    }

    _addGear(gear, train) {
      gear.train = train;
      gear.path = this._buildPath(gear);
      train.gears.push(gear);
      train.minR = Math.min(train.minR, gear.radius);
      train.vMax = train.minR * TAU * MAX_REVS;
      this._gears.push(gear);
      this._countArea(gear);
    }

    _newTrain() {
      const gear = this._makeGear(this._randomTeeth(), Math.random() * this._w, Math.random() * this._h);
      if (!this._fits(gear, null)) return null;
      gear.phase = Math.random() * TAU;
      const train = {
        gears: [],
        s: 0,
        v: 0,
        held: false,
        minR: Infinity,
        goal: 3 + Math.floor(Math.random() * 7),
        failures: 0,
        // Fixed per train, so changing `powered` or `speed` later turns
        // motors on and off (or speeds them up) without reshuffling which
        // train has one or which way it turns.
        roll: Math.random(),
        motorPick: Math.random(),
        spin: Math.random() < 0.5 ? -1 : 1,
        speedMul: 0.75 + Math.random() * 0.5,
      };
      this._addGear(gear, train);
      this._trains.push(train);
      this._retarget(train);
      train.v = train.target;
      return train;
    }

    // A new gear meshing with `parent` at a random angle round it. Its
    // phase is set so that, at the contact point, a tooth on one side
    // faces a gap on the other: in tooth pitches past the contact line,
    // the two gears' offsets sum to a half. Rolling the train moves one
    // offset up and the other down by the same amount, so that sum, and
    // the mesh, holds at every point of the turn.
    _growFrom(parent, train) {
      const alpha = Math.random() * TAU;
      const teeth = this._randomTeeth();
      const r = (this.options.toothSize * teeth) / 2;
      const gear = this._makeGear(teeth, parent.x + (parent.radius + r) * Math.cos(alpha), parent.y + (parent.radius + r) * Math.sin(alpha));
      if (!this._fits(gear, parent)) return false;
      const parentPitch = TAU / parent.teeth;
      const pitch = TAU / teeth;
      const f = ((((alpha - parent.phase) / parentPitch) % 1) + 1) % 1;
      gear.dir = -parent.dir;
      gear.phase = alpha + Math.PI - pitch * (0.5 - f);
      this._addGear(gear, train);
      return true;
    }

    // Adds trains until the gears cover `density` of the box or there's
    // no room left to find. A train grows from random gears already in it
    // until it reaches its own goal size or keeps running into things.
    //
    // "No room left" is a run of failed placements in a row rather than
    // just the overall budget, so a box that's already as full as it can
    // get (a high density, or a resize that opened up nothing usable)
    // gives up quickly instead of spending every attempt on it, which
    // matters because a window being dragged wider resizes every frame.
    _fill() {
      const target = this.options.density * this._w * this._h;
      let train = null;
      let misses = 0;
      for (let attempt = 0; attempt < 3000 && misses < 250 && this._area < target; attempt++) {
        if (!train || train.gears.length >= train.goal || train.failures > 15) {
          this._dropIfLonely(train);
          train = this._newTrain();
          misses = train ? 0 : misses + 1;
          continue;
        }
        const parent = train.gears[Math.floor(Math.random() * train.gears.length)];
        if (this._growFrom(parent, train)) {
          misses = 0;
        } else {
          train.failures++;
          misses++;
        }
      }
      this._dropIfLonely(train);
    }

    // A train that couldn't grow past one gear isn't a train; take it back
    // out so every gear on the board meshes with something.
    _dropIfLonely(train) {
      if (!train || train.gears.length > 1) return;
      this._removeTrain(train);
    }

    _removeTrain(train) {
      this._trains.splice(this._trains.indexOf(train), 1);
      train.gears.forEach((gear) => {
        this._gears.splice(this._gears.indexOf(gear), 1);
        this._area -= gear.counted;
      });
      if (this._drag && this._drag.train === train) this._endDrag();
    }

    // Lowering density takes whole trains off, newest first, rather than
    // laying out a new board.
    _trim() {
      const target = this.options.density * this._w * this._h;
      while (this._trains.length && this._area > target) {
        this._removeTrain(this._trains[this._trains.length - 1]);
      }
    }

    _buildPath(gear) {
      const path = new Path2D();
      toothOutline(path, gear.teeth, gear.rootRadius, gear.tipRadius);
      const { decorate } = this.options;
      const fn = typeof decorate === 'function' ? decorate : DECORATIONS[decorate] || auto;
      fn(path, gear);
      return path;
    }

    _motor(train) {
      if (train.roll >= this.options.powered) return null;
      return train.gears[Math.floor(train.motorPick * train.gears.length)];
    }

    _retarget(train) {
      train.target = this._motor(train) ? train.spin * train.speedMul * this.options.speed : 0;
    }

    // --- Motion -------------------------------------------------------

    _angle(gear) {
      return gear.phase + (gear.dir * gear.train.s) / gear.radius;
    }

    _advance(dt) {
      const settle = 1 - Math.exp(-dt / Math.max(0.05, this.options.coast));
      this._trains.forEach((train) => {
        if (train.held) return;
        train.v += (train.target - train.v) * settle;
        train.s += train.v * dt;
      });
    }

    _tick(now) {
      // Floored at 0 as well: the first frame's timestamp can come in a
      // hair before the performance.now() that _start read, and a negative
      // step would turn every motor backwards for a frame.
      const dt = Math.max(0, Math.min(0.05, (now - this._lastNow) / 1000));
      this._lastNow = now;
      this._advance(dt);
      this._render();
      this._raf = requestAnimationFrame(this._tick);
    }

    _render() {
      const { ctx, _w: w, _h: h, _dpr: dpr } = this;
      if (!w) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = this.options.color;
      ctx.fillStyle = this.options.color;
      ctx.lineWidth = this.options.lineWidth;
      ctx.lineJoin = 'round';
      const motors = new Set(this._trains.map((train) => this._motor(train)));
      this._gears.forEach((gear) => {
        const reach = gear.tipRadius + 2;
        if (gear.x + reach < 0 || gear.x - reach > w || gear.y + reach < 0 || gear.y - reach > h) return;
        const a = this._angle(gear);
        const cos = Math.cos(a) * dpr;
        const sin = Math.sin(a) * dpr;
        ctx.setTransform(cos, sin, -sin, cos, gear.x * dpr, gear.y * dpr);
        ctx.stroke(gear.path);
        // A motor's axle is a solid disc, a little wider than a plain
        // axle's ring, so the gears that turn on their own are easy to spot.
        const motor = motors.has(gear);
        ctx.beginPath();
        ctx.arc(0, 0, motor ? gear.axleRadius * 1.8 : gear.axleRadius, 0, TAU);
        if (motor) ctx.fill();
        else ctx.stroke();
      });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // --- Input --------------------------------------------------------

    // Mapped through the rendered size, so a host scaled by a CSS
    // transform still hits the gear under the cursor.
    _local(event) {
      const rect = this.el.getBoundingClientRect();
      const scaleX = rect.width / this.el.offsetWidth || 1;
      const scaleY = rect.height / this.el.offsetHeight || 1;
      return [
        (event.clientX - rect.left) / scaleX - this.el.clientLeft,
        (event.clientY - rect.top) / scaleY - this.el.clientTop,
      ];
    }

    _hit(x, y) {
      let best = null;
      let bestDist = Infinity;
      this._gears.forEach((gear) => {
        const d = Math.hypot(x - gear.x, y - gear.y);
        if (d <= gear.tipRadius && d - gear.radius < bestDist) {
          best = gear;
          bestDist = d - gear.radius;
        }
      });
      return best;
    }

    // Leave presses on the host's own controls alone. Only ones inside the
    // host, though: a host that is itself inside a link can still be
    // grabbed (the click that would follow it is cancelled; see _onClick).
    _onControl(event) {
      const control = event.target.closest('a, button, input, select, textarea, label, [contenteditable]');
      return Boolean(control && this.el.contains(control) && control !== this.el);
    }

    _onTouchStart(event) {
      if (!this.options.grab || this._onControl(event) || event.touches.length !== 1) return;
      const [x, y] = this._local(event.touches[0]);
      if (this._hit(x, y)) event.preventDefault();
    }

    _onPointerDown(event) {
      if (!this.options.grab || event.button !== 0 || this._drag || this._onControl(event)) return;
      const [x, y] = this._local(event);
      const gear = this._hit(x, y);
      if (!gear) return;
      // Stops a mouse drag selecting the text on top.
      event.preventDefault();
      this.el.setPointerCapture(event.pointerId);
      gear.train.held = true;
      this._drag = {
        pointerId: event.pointerId,
        gear,
        train: gear.train,
        angle: Math.atan2(y - gear.y, x - gear.x),
        time: event.timeStamp,
        startX: event.clientX,
        startY: event.clientY,
        target: event.target,
        moved: false,
      };
      this.el.style.cursor = 'grabbing';
    }

    // How far the train rolls when `gear` turns by `turn` radians.
    _rollFor(gear, turn) {
      return turn * gear.radius * gear.dir;
    }

    _onPointerMove(event) {
      const [x, y] = this._local(event);
      const drag = this._drag;
      if (drag && event.pointerId === drag.pointerId) {
        // Moved by how far the pointer has gone from where it pressed, not
        // by any one event's turn, so a slow drag of many tiny steps still
        // counts as a drag (and doesn't end by following a link).
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
        this._dragTo(drag, x, y, event.timeStamp);
        return;
      }
      const gear = this._hit(x, y);
      this.el.style.cursor = gear && this.options.grab ? 'grab' : '';
      if (this.options.brush && !this._reduced && event.pointerType === 'mouse') this._brush(gear, x, y, event.timeStamp);
      else this._hover = null;
    }

    // The gear follows the pointer's angle round its center exactly, and
    // the rest of the train with it. Close to the center that angle swings
    // wildly with tiny movements, so there it holds still instead.
    _dragTo(drag, x, y, time) {
      const { gear, train } = drag;
      if (Math.hypot(x - gear.x, y - gear.y) < gear.radius * 0.2) return;
      const angle = Math.atan2(y - gear.y, x - gear.x);
      const roll = this._rollFor(gear, wrapAngle(angle - drag.angle));
      const dt = Math.max(1 / 240, (time - drag.time) / 1000);
      drag.angle = angle;
      drag.time = time;
      train.s += roll;
      const k = 1 - Math.exp(-dt / DRAG_SMOOTHING);
      train.v = Math.max(-train.vMax, Math.min(train.vMax, train.v + (roll / dt - train.v) * k));
      if (this._reduced) this._render();
    }

    // The pointer pushes a gear it passes over by however fast it's moving
    // round that gear, the way a hand brushing past would catch the teeth.
    // It only ever speeds a gear up or turns it the other way: a slower
    // pass in the same direction leaves it alone, so just moving the mouse
    // over a spinning gear doesn't brake it.
    _brush(gear, x, y, time) {
      const last = this._hover;
      this._hover = gear ? { gear, x, y, time } : null;
      if (!gear || !last || last.gear !== gear) return;
      if (Math.hypot(x - gear.x, y - gear.y) < gear.radius * 0.35) return;
      const dt = Math.max(1 / 240, (time - last.time) / 1000);
      if (dt > 0.1) return;
      const turn = wrapAngle(Math.atan2(y - gear.y, x - gear.x) - Math.atan2(last.y - gear.y, last.x - gear.x));
      const pushed = this._rollFor(gear, turn) / dt;
      const { train } = gear;
      if (Math.sign(pushed) === Math.sign(train.v) && Math.abs(pushed) <= Math.abs(train.v)) return;
      const k = 1 - Math.exp(-dt / BRUSH_SMOOTHING);
      train.v = Math.max(-train.vMax, Math.min(train.vMax, train.v + (pushed - train.v) * k));
    }

    // Letting go keeps whatever speed the drag had, unless the pointer had
    // already stopped before it let go: then the train is set down still.
    //
    // A touch that lands on a gear has its touchstart cancelled (to stop
    // the page scrolling), which also stops the browser sending a click.
    // So a touch that lets go without dragging sends the click itself, to
    // what it pressed on, and a tap on a gear inside a link still follows
    // it.
    _onPointerUp(event) {
      const drag = this._drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      this._endDrag();
      if (event.type === 'pointercancel') return;
      if (event.timeStamp - drag.time > 80 || this._reduced) drag.train.v = 0;
      if (drag.moved) this._suppressClickUntil = event.timeStamp + 400;
      else if (event.pointerType !== 'mouse' && drag.target.isConnected) drag.target.click();
      this.el.style.cursor = this.options.grab && this._hit(...this._local(event)) ? 'grab' : '';
    }

    // Lets go of whatever is being dragged, wherever the drag is ended
    // from: the pointer coming up, or a layout change taking the gear away
    // mid-drag.
    _endDrag() {
      const drag = this._drag;
      if (!drag) return;
      this._drag = null;
      drag.train.held = false;
      if (this.el.hasPointerCapture(drag.pointerId)) this.el.releasePointerCapture(drag.pointerId);
      this.el.style.cursor = '';
    }

    _onPointerLeave() {
      this._hover = null;
      if (!this._drag) this.el.style.cursor = '';
    }

    _onClick(event) {
      if (event.timeStamp > this._suppressClickUntil) return;
      this._suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    // --- API ------------------------------------------------------------

    // Apply new option values (e.g. from a control panel). Tooth size and
    // the largest gear lay the board out again; density adds or takes
    // away whole trains; a new decoration redraws every gear in place;
    // speed and powered retune the motors without moving anything.
    update(newOptions = {}) {
      const changed = (key) => key in newOptions && newOptions[key] !== this.options[key];
      const relayout = changed('toothSize') || changed('maxTeeth');
      const redecorate = changed('decorate');
      const density = changed('density');
      Object.assign(this.options, newOptions);
      if ('background' in newOptions) this._applyBackground();
      if (!this._w) return;
      if (relayout) {
        this._rebuild();
      } else if (density) {
        this._trim();
        this._fill();
      }
      if (redecorate && !relayout) this._gears.forEach((gear) => { gear.path = this._buildPath(gear); });
      this._trains.forEach((train) => this._retarget(train));
      this._render();
    }

    // Lays out a fresh board with the same settings.
    randomize() {
      if (!this._w) return;
      this._rebuild();
      this._render();
    }

    destroy() {
      this._stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      this.el.removeEventListener('pointerdown', this._onPointerDown);
      this.el.removeEventListener('pointermove', this._onPointerMove);
      this.el.removeEventListener('pointerup', this._onPointerUp);
      this.el.removeEventListener('pointercancel', this._onPointerUp);
      this.el.removeEventListener('pointerleave', this._onPointerLeave);
      this.el.removeEventListener('touchstart', this._onTouchStart);
      this.el.removeEventListener('click', this._onClick, true);
      this.el.style.cursor = '';
      this.el.classList.remove('bg-gears--dark');
      this.canvas.remove();
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__gearsInstance;
    }
  }

  // The built-in decorations, for a custom one to build on.
  Gears.decorations = DECORATIONS;

  Gears.initAll = function (selector = '.bg-gears', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__gearsInstance)
      .map((el) => {
        const instance = new Gears(el, options);
        el.__gearsInstance = instance;
        return instance;
      });
  };

  // Look up the instance auto-created for a single element (or the first
  // match of a selector) — use this instead of `initAll()` from page code,
  // since auto-init has usually already claimed the element by the time a
  // page's own script runs.
  Gears.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__gearsInstance || null : null;
  };

  Gears.getAll = function (selector = '.bg-gears') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__gearsInstance)
      .filter(Boolean);
  };

  global.Gears = Gears;

  function autoInit() {
    Gears.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
