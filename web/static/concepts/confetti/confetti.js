/**
 * Confetti
 * --------
 * Paper confetti, fired by a click. Three ways to fire it:
 *
 *   element  out of the clicked element's own edges: one side, or all
 *            the way round
 *   mouse    out of the exact point that was clicked
 *   screen   across the whole window: shot up from the bottom edge,
 *            dropped from the top, or fired in from the two bottom corners
 *
 * Element and mouse confetti go wherever `direction` points: a name ('up',
 * 'down', 'left', 'right', 'up-left' and so on), 'all' for every way at
 * once, or any angle in degrees, compass style: 0 is straight up, 90 is
 * right, and so round clockwise, like a CSS gradient's angle. `spread`
 * fans the pieces out across a cone that many degrees wide.
 *
 * Every piece is a flat scrap of paper. It flies out fast, air drag kills
 * that speed quickly, and then it flutters down at a slow terminal speed,
 * swaying side to side, spinning, and tumbling end over end so it flashes
 * its darker back face as it turns.
 *
 * All confetti on a page, from every element, draws into one canvas fixed
 * over the window, and that canvas's loop stops whenever nothing is in the
 * air, so a page full of confetti buttons costs nothing until one is
 * clicked. The canvas ignores the pointer, so it never blocks the page.
 *
 * What a piece looks like is open: `shapes` takes built-in names
 * ('square', 'strip', 'circle', 'triangle', 'star') or your own drawing
 * function.
 *
 * Usage: give any element `class="confetti-el"`. This file auto-initializes
 * every matching element on load, so a click on it fires confetti out of
 * its edges. `data-confetti-mode`, `data-confetti-direction` and friends
 * change that per element. To fire confetti from your own code instead,
 * call Confetti.fromElement(el), Confetti.burst(x, y) or Confetti.screen().
 */
(function (global) {
  const STYLE_ID = 'confetti-styles';
  const CSS = `
.confetti-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2147483000;
  pointer-events: none;
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

  // Options shared by every mode. `count`, `spread`, `reach` and `duration`
  // are left null here: each mode fills in its own (MODE_DEFAULTS), since a
  // whole-screen shower wants several times the pieces of a button pop.
  const DEFAULTS = {
    mode: 'element',
    direction: 'up',
    from: 'bottom',
    count: null,
    spread: null,
    reach: null,
    duration: null,
    gravity: 500,
    size: 9,
    colors: ['#e63946', '#f3722c', '#e9a800', '#2a9d8f', '#3a6ff7', '#9b3fd4'],
    shapes: ['square', 'strip', 'circle'],
  };

  // `reach: null` on screen means "worked out from the window's height"
  // (see screen()), and `duration: null` means pieces last until they fall
  // out of the window rather than fading partway down.
  const MODE_DEFAULTS = {
    element: { count: 60, spread: 50, reach: 200, duration: 3.5 },
    mouse: { count: 40, spread: 60, reach: 160, duration: 3 },
    screen: { count: 220, spread: 30, reach: null, duration: null },
  };

  const MODES = Object.keys(MODE_DEFAULTS);

  // Air drag on a piece, per second: its speed is multiplied by e^-DRAG
  // each second. Paper is light for its size, so this is high, which is
  // what makes a burst read as confetti: a fast pop, then a slow drift.
  // Terminal falling speed is gravity / DRAG, about 170 px/s at defaults.
  const DRAG = 3;

  // Hard ceiling on pieces in the air, across every element on the page.
  // Anything fired past it is dropped, so mashing a button can't pile up
  // more than the page can draw.
  const MAX_PIECES = 1500;

  // A piece fades over its last FADE seconds rather than vanishing.
  const FADE = 0.6;
  // Pieces with no `duration` still go eventually, even if they somehow
  // never leave the window (a gravity of 0, say).
  const MAX_LIFE = 15;

  // How long each screen mode takes to let all its pieces go. A cannon is
  // over quickly; a drop from the top is spread out, so it rains rather
  // than falling as one sheet.
  const SCREEN_EMIT = { bottom: 0.35, sides: 0.3, top: 1.6 };
  // Angle each corner cannon fires at in 'sides' mode, in from vertical.
  const SIDE_ANGLE = 32;

  // How much darker a piece's back face is than its front.
  const BACK_SHADE = 0.3;

  const NAMED_DIRECTIONS = {
    up: 0,
    'up-right': 45,
    right: 90,
    'down-right': 135,
    down: 180,
    'down-left': 225,
    left: 270,
    'up-left': 315,
  };

  // Element edges by the compass angle of their outward face.
  const EDGE_ANGLES = { top: 0, right: 90, bottom: 180, left: 270 };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function prefersReducedMotion() {
    return Boolean(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // A direction option as a compass angle in degrees, or null for 'all'.
  // Takes a name, a number, or a numeric string (so a data attribute like
  // data-confetti-direction="120" works as-is). Anything unrecognised
  // fires up rather than throwing.
  function parseDirection(direction) {
    if (typeof direction === 'number' && Number.isFinite(direction)) return direction;
    if (typeof direction !== 'string') return 0;
    const key = direction.trim().toLowerCase();
    if (key === 'all') return null;
    if (key in NAMED_DIRECTIONS) return NAMED_DIRECTIONS[key];
    const degrees = parseFloat(key);
    return Number.isFinite(degrees) ? degrees : 0;
  }

  // Compass degrees (0 up, clockwise) to a unit [x, y], with y down as on
  // screen.
  function unitFromAngle(degrees) {
    const a = (degrees * Math.PI) / 180;
    return [Math.sin(a), -Math.cos(a)];
  }

  // The launch speed that carries a piece fired straight up exactly
  // `reach` px before it stops rising, under this drag and gravity. The
  // apex height for a launch speed v is
  //   v/k - (g/k^2) ln(1 + k v / g)
  // which has no neat inverse, but it only ever grows with v, so a short
  // bisection finds it. Run once per burst, not per piece. Stepping the
  // motion frame by frame lands the real apex a few percent short.
  function launchSpeed(reach, gravity) {
    const k = DRAG;
    const g = Math.max(0, gravity);
    if (!(reach > 0)) return 0;
    if (g === 0) return reach * k;
    const apex = (v) => v / k - (g / (k * k)) * Math.log(1 + (k * v) / g);
    let lo = 0;
    let hi = reach * k + g;
    while (apex(hi) < reach) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (apex(mid) < reach) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // --- Shapes ----------------------------------------------------------
  // Built-ins are unit-sized paths, about 1 across, centered on the
  // origin, and drawn scaled up to each piece's size. A piece is drawn
  // already rotated and squashed by its tumble, so a shape only ever has
  // to draw itself flat.
  function star(points, inner) {
    const path = new Path2D();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : 0.55;
      const a = (i * Math.PI) / points - Math.PI / 2;
      if (i === 0) path.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    path.closePath();
    return path;
  }

  const SHAPE_PATHS = {
    square: () => {
      const path = new Path2D();
      path.rect(-0.4, -0.4, 0.8, 0.8);
      return path;
    },
    strip: () => {
      const path = new Path2D();
      path.rect(-0.17, -0.6, 0.34, 1.2);
      return path;
    },
    circle: () => {
      const path = new Path2D();
      path.arc(0, 0, 0.42, 0, Math.PI * 2);
      return path;
    },
    triangle: () => {
      const path = new Path2D();
      path.moveTo(0, -0.5);
      path.lineTo(0.48, 0.33);
      path.lineTo(-0.48, 0.33);
      path.closePath();
      return path;
    },
    star: () => star(5, 0.24),
  };

  // Built once, the first time a shape is used, rather than at load: a
  // page that never fires confetti never builds them.
  const builtPaths = {};
  function pathFor(name) {
    if (!builtPaths[name]) builtPaths[name] = SHAPE_PATHS[name]();
    return builtPaths[name];
  }

  // Accepts built-in names or drawing functions. An unknown name falls
  // back to a square rather than throwing mid-frame.
  function resolveShapes(list) {
    const shapes = Array.isArray(list) && list.length ? list : DEFAULTS.shapes;
    return shapes.map((shape) => {
      if (typeof shape === 'function') return { draw: shape };
      return { path: pathFor(SHAPE_PATHS[shape] ? shape : 'square') };
    });
  }

  // --- Colors ----------------------------------------------------------
  // Any CSS color the canvas understands, as [r, g, b], read back off a
  // 1x1 scratch canvas, the same way Fireworks does it. Needed because
  // each piece's back face is a darker shade of its front, worked out once
  // per color here rather than per frame.
  let scratch = null;
  function parseColor(color) {
    if (!scratch) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      scratch = canvas.getContext('2d', { willReadFrequently: true });
    }
    scratch.fillStyle = '#000000';
    scratch.fillStyle = color;
    scratch.globalCompositeOperation = 'copy';
    scratch.fillRect(0, 0, 1, 1);
    scratch.globalCompositeOperation = 'source-over';
    return Array.from(scratch.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }

  function rgbCss([r, g, b]) {
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Each color as a [front, back] pair of fill strings.
  function resolveColors(list) {
    const colors = Array.isArray(list) && list.length ? list : DEFAULTS.colors;
    return colors.map((color) => {
      const rgb = parseColor(color);
      return [rgbCss(rgb), rgbCss(rgb.map((c) => Math.round(c * (1 - BACK_SHADE))))];
    });
  }

  // --- Options ---------------------------------------------------------
  // Fills in whatever the caller left out (or set to null) from the
  // mode's own defaults, then the shared ones.
  function resolveOptions(options) {
    const merged = { ...DEFAULTS, ...options };
    if (!MODE_DEFAULTS[merged.mode]) merged.mode = DEFAULTS.mode;
    const modeDefaults = MODE_DEFAULTS[merged.mode];
    Object.keys(modeDefaults).forEach((key) => {
      if (merged[key] == null) merged[key] = modeDefaults[key];
    });
    return merged;
  }

  // --- The shared stage ------------------------------------------------
  // One canvas over the window for every piece of confetti on the page.
  // It's created the first time anything fires and then left in place:
  // an empty canvas costs nothing to keep, since the loop only runs while
  // something is in the air.
  const stage = {
    canvas: null,
    ctx: null,
    w: 0,
    h: 0,
    dpr: 1,
    pieces: [],
    emitters: [],
    raf: null,
    lastNow: 0,
  };

  function ensureStage() {
    if (stage.canvas && stage.canvas.isConnected) return true;
    if (!document.body) return false;
    injectStyles();
    stage.canvas = document.createElement('canvas');
    stage.canvas.className = 'confetti-canvas';
    stage.canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stage.canvas);
    stage.ctx = stage.canvas.getContext('2d');
    // A fresh canvas starts at the browser's 300x150 whatever size the
    // last one was, so resizeStage must not skip it as unchanged (which it
    // would after something removed the old canvas from the page).
    stage.w = 0;
    stage.h = 0;
    resizeStage();
    if (!stage.listening) {
      global.addEventListener('resize', resizeStage);
      stage.listening = true;
    }
    return true;
  }

  // Sized from the canvas's own box rather than innerWidth/innerHeight, so
  // a visible scrollbar isn't counted as somewhere confetti can land.
  // Pieces already in the air keep their window coordinates.
  function resizeStage() {
    if (!stage.canvas) return;
    const width = stage.canvas.clientWidth || global.innerWidth;
    const height = stage.canvas.clientHeight || global.innerHeight;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (width === stage.w && height === stage.h && dpr === stage.dpr) return;
    stage.w = width;
    stage.h = height;
    stage.dpr = dpr;
    stage.canvas.width = Math.round(width * dpr);
    stage.canvas.height = Math.round(height * dpr);
  }

  function startLoop() {
    if (stage.raf) return;
    stage.lastNow = performance.now();
    stage.raf = requestAnimationFrame(tick);
  }

  function addPiece(piece) {
    if (stage.pieces.length >= MAX_PIECES) return;
    stage.pieces.push(piece);
  }

  // One piece of confetti, fired from (x, y) toward compass angle `angle`
  // at `speed` px/s, in window coordinates.
  function makePiece(x, y, angle, speed, opts, look) {
    const [ux, uy] = unitFromAngle(angle);
    const color = look.colors[Math.floor(Math.random() * look.colors.length)];
    const shape = look.shapes[Math.floor(Math.random() * look.shapes.length)];
    return {
      x,
      y,
      vx: ux * speed,
      vy: uy * speed,
      age: 0,
      life: opts.duration > 0 ? opts.duration * randomBetween(0.8, 1.2) : MAX_LIFE,
      gravity: opts.gravity,
      drag: DRAG * randomBetween(0.85, 1.15),
      size: opts.size * randomBetween(0.75, 1.25),
      // Rotation in the plane of the screen.
      rot: Math.random() * Math.PI * 2,
      spin: randomBetween(-6, 6),
      // Tumble end over end, drawn as a squash along the piece's own axis
      // whose sign picks which face shows.
      tilt: Math.random() * Math.PI * 2,
      tiltSpeed: randomBetween(4, 11) * (Math.random() < 0.5 ? -1 : 1),
      // Side-to-side flutter: a sideways push that swings back and forth.
      // Drag turns it into a sway of roughly ±15-40 px once the piece has
      // slowed down, and it's lost in the noise while it's still flying.
      sway: Math.random() * Math.PI * 2,
      swaySpeed: randomBetween(2.5, 5),
      swayForce: randomBetween(250, 600),
      front: color[0],
      back: color[1],
      shape,
    };
  }

  // Each frame's share of a gradual release, for the screen modes:
  // `count` pieces let go evenly over `seconds`.
  function addEmitter(count, seconds, spawn) {
    stage.emitters.push({ left: count, rate: count / Math.max(0.01, seconds), owed: 0, spawn });
  }

  function step(dt) {
    const emitters = stage.emitters;
    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i];
      e.owed += e.rate * dt;
      const n = Math.min(e.left, Math.floor(e.owed));
      for (let j = 0; j < n; j++) addPiece(e.spawn());
      e.owed -= n;
      e.left -= n;
      if (e.left <= 0) emitters.splice(i, 1);
    }

    // Spent pieces are swap-removed (the last moves into the gap) rather
    // than spliced, since a whole burst expiring at once would otherwise
    // shift the array once per piece. Draw order between scraps of paper
    // doesn't visibly matter.
    const pieces = stage.pieces;
    const { w, h } = stage;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.age += dt;
      p.sway += p.swaySpeed * dt;
      p.rot += p.spin * dt;
      p.tilt += p.tiltSpeed * dt;
      const damp = Math.exp(-p.drag * dt);
      p.vx = p.vx * damp + Math.sin(p.sway) * p.swayForce * dt;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const margin = p.size * 2 + 40;
      const gone = p.age >= p.life
        || (p.y > h + margin && p.vy > 0)
        || p.x < -w - margin
        || p.x > w * 2 + margin;
      if (gone) {
        const last = pieces.pop();
        if (i < pieces.length) pieces[i] = last;
      }
    }
  }

  function render() {
    const { ctx, w, h, dpr } = stage;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
    stage.pieces.forEach((p) => {
      const alpha = Math.min(1, (p.life - p.age) / FADE);
      if (alpha <= 0.01 || p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) return;
      const flip = Math.cos(p.tilt);
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      // translate(x, y) . rotate(rot) . scale(1, flip), with the device
      // pixel ratio folded in. A flip near 0 is the piece seen edge-on;
      // drawn as nothing at all it would blink, so it keeps a sliver.
      const f = Math.sign(flip || 1) * Math.max(0.08, Math.abs(flip));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = flip >= 0 ? p.front : p.back;
      if (p.shape.path) {
        const k = p.size * dpr;
        ctx.setTransform(k * c, k * s, -k * s * f, k * c * f, p.x * dpr, p.y * dpr);
        ctx.fill(p.shape.path);
      } else {
        ctx.setTransform(dpr * c, dpr * s, -dpr * s * f, dpr * c * f, p.x * dpr, p.y * dpr);
        // A custom shape runs inside the animation loop, where a throw
        // would stop the loop for good, so one that throws is dropped
        // from that piece instead.
        try {
          p.shape.draw(ctx, p.size);
        } catch (err) {
          console.error('Confetti: custom shape threw', err);
          p.shape = { path: pathFor('square') };
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function tick(now) {
    // Clamped, so a frame after a stall (a background tab, a debugger)
    // doesn't throw everything across the window in one step.
    const dt = Math.min(0.05, Math.max(0, (now - stage.lastNow) / 1000));
    stage.lastNow = now;
    step(dt);
    render();
    if (stage.pieces.length || stage.emitters.length) {
      stage.raf = requestAnimationFrame(tick);
    } else {
      stage.raf = null;
    }
  }

  function prepare(options) {
    if (prefersReducedMotion() || !ensureStage()) return null;
    const opts = resolveOptions(options);
    const look = { colors: resolveColors(opts.colors), shapes: resolveShapes(opts.shapes) };
    return { opts, look };
  }

  // Angle for one piece: `aim` plus a random share of the spread either
  // side of it.
  function fan(aim, spread) {
    return aim + randomBetween(-spread / 2, spread / 2);
  }

  // --- The three ways to fire -----------------------------------------

  // Out of the point (x, y), in window (clientX/clientY) coordinates.
  function burst(x, y, options = {}) {
    // Screen confetti has no origin point, so a screen mode passed here
    // goes to screen() instead of firing from (x, y) with screen's
    // window-sized defaults, which would leave every piece with no speed.
    if (options.mode === 'screen') {
      screen(options);
      return;
    }
    const ready = prepare({ mode: 'mouse', ...options });
    if (!ready) return;
    const { opts, look } = ready;
    const aim = parseDirection(opts.direction);
    const speed = launchSpeed(opts.reach, opts.gravity);
    for (let i = 0; i < opts.count; i++) {
      const angle = aim === null ? Math.random() * 360 : fan(aim, opts.spread);
      addPiece(makePiece(x, y, angle, speed * randomBetween(0.45, 1), opts, look));
    }
    startLoop();
  }

  // Out of an element's edges. For a direction, pieces leave from every
  // edge that faces it at all, each in proportion to how squarely it
  // faces it, so 'up' is the top edge only and 'up-right' is the top and
  // right edges together, and all of them fly that one way. For 'all',
  // pieces leave from anywhere around the outline, each straight out from
  // its own edge.
  function fromElement(el, options = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return;
    // Same as burst(): screen confetti doesn't come out of an element.
    if (options.mode === 'screen') {
      screen(options);
      return;
    }
    const ready = prepare({ mode: 'element', ...options });
    if (!ready) return;
    const { opts, look } = ready;
    const r = el.getBoundingClientRect();
    const edges = [
      { name: 'top', length: r.width, at: (t) => [r.left + t * r.width, r.top] },
      { name: 'right', length: r.height, at: (t) => [r.right, r.top + t * r.height] },
      { name: 'bottom', length: r.width, at: (t) => [r.left + t * r.width, r.bottom] },
      { name: 'left', length: r.height, at: (t) => [r.left, r.top + t * r.height] },
    ];
    const aim = parseDirection(opts.direction);
    const aimUnit = aim === null ? null : unitFromAngle(aim);
    edges.forEach((edge) => {
      const [nx, ny] = unitFromAngle(EDGE_ANGLES[edge.name]);
      const facing = aimUnit ? Math.max(0, nx * aimUnit[0] + ny * aimUnit[1]) : 1;
      edge.weight = edge.length * facing;
    });
    const live = edges.filter((edge) => edge.weight > 0);
    const total = live.reduce((sum, edge) => sum + edge.weight, 0);
    // A zero-size element has no edges to speak of, so it fires from its
    // center like a mouse burst would.
    if (!(total > 0)) {
      burst(r.left + r.width / 2, r.top + r.height / 2, { ...opts, mode: 'element' });
      return;
    }
    const speed = launchSpeed(opts.reach, opts.gravity);
    for (let i = 0; i < opts.count; i++) {
      // Rounding can leave a sliver of `pick` past the last edge, which
      // then simply takes the last one.
      let pick = Math.random() * total;
      let edge = live[live.length - 1];
      for (let j = 0; j < live.length; j++) {
        pick -= live[j].weight;
        if (pick <= 0) {
          edge = live[j];
          break;
        }
      }
      const [x, y] = edge.at(Math.random());
      const angle = fan(aim === null ? EDGE_ANGLES[edge.name] : aim, opts.spread);
      addPiece(makePiece(x, y, angle, speed * randomBetween(0.45, 1), opts, look));
    }
    startLoop();
  }

  // Across the whole window, `from` one of:
  //   'bottom'  the entire bottom edge shoots up
  //   'top'     confetti drops in from above and rains down
  //   'sides'   two cannons in the bottom corners fire up and inward
  function screen(options = {}) {
    const ready = prepare({ mode: 'screen', ...options });
    if (!ready) return;
    const { opts, look } = ready;
    const { w, h } = stage;
    const from = ['bottom', 'top', 'sides'].includes(opts.from) ? opts.from : 'bottom';
    const count = Math.round(opts.count);

    if (from === 'top') {
      // Already falling, at anything up to terminal speed, and spread a
      // little past each side so the edges of the window aren't bare.
      const terminal = opts.gravity / DRAG;
      addEmitter(count, SCREEN_EMIT.top, () => {
        const piece = makePiece(randomBetween(-0.05, 1.05) * w, -opts.size * 2, 180, 0, opts, look);
        piece.vx = randomBetween(-60, 60);
        piece.vy = randomBetween(0.2, 1) * terminal;
        return piece;
      });
    } else if (from === 'bottom') {
      const speed = launchSpeed(opts.reach != null ? opts.reach : h * 0.85, opts.gravity);
      addEmitter(count, SCREEN_EMIT.bottom, () => makePiece(
        Math.random() * w, h + opts.size, fan(0, opts.spread), speed * randomBetween(0.55, 1), opts, look,
      ));
    } else {
      // Reach is how high the cannons throw; aimed off vertical, a piece
      // needs more speed to get that high.
      const reach = opts.reach != null ? opts.reach : h * 0.75;
      const speed = launchSpeed(reach, opts.gravity) / Math.cos((SIDE_ANGLE * Math.PI) / 180);
      const half = Math.ceil(count / 2);
      [[0, SIDE_ANGLE], [w, -SIDE_ANGLE]].forEach(([x, aim]) => {
        addEmitter(half, SCREEN_EMIT.sides, () => makePiece(
          x, h + opts.size, fan(aim, opts.spread), speed * randomBetween(0.5, 1), opts, look,
        ));
      });
    }
    startLoop();
  }

  // --- Click-bound elements -------------------------------------------

  // Per-element overrides, read off the element's own data attributes, so
  // one blanket auto-init can still give each element its own behaviour.
  const DATA_OPTIONS = {
    confettiMode: 'mode',
    confettiDirection: 'direction',
    confettiFrom: 'from',
    confettiCount: 'count',
    confettiSpread: 'spread',
    confettiReach: 'reach',
  };
  const NUMERIC = ['count', 'spread', 'reach'];

  function dataOptions(el) {
    const out = {};
    Object.keys(DATA_OPTIONS).forEach((attr) => {
      const value = el.dataset[attr];
      if (value == null || value === '') return;
      const key = DATA_OPTIONS[attr];
      if (NUMERIC.includes(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) out[key] = n;
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  class Confetti {
    constructor(el, options = {}) {
      if (!el) throw new Error('Confetti: element is required');
      this.el = el;
      this.options = { ...options, ...dataOptions(el) };
      this._onClick = this._onClick.bind(this);
      // A click rather than a pointerdown, so a drag or a scroll that starts
      // on the element doesn't fire, and a keyboard press on a button
      // (which browsers turn into a click) does.
      this.el.addEventListener('click', this._onClick);
    }

    // The options this element actually fires with, mode defaults included.
    get resolved() {
      return resolveOptions(this.options);
    }

    _onClick(event) {
      if (event.button !== 0) return;
      // detail is 0 for a click that came from the keyboard, whose
      // coordinates mean nothing; fire() then uses the element's center.
      this.fire(event.detail === 0 ? undefined : event);
    }

    // Fires this element's confetti as if it had been clicked. Mouse mode
    // fires from the event's pointer position if one is passed, otherwise
    // from the middle of the element.
    fire(event) {
      const { mode } = this.resolved;
      if (mode === 'screen') {
        screen(this.options);
      } else if (mode === 'mouse') {
        let x;
        let y;
        if (event && Number.isFinite(event.clientX)) {
          x = event.clientX;
          y = event.clientY;
        } else {
          const r = this.el.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.top + r.height / 2;
        }
        burst(x, y, this.options);
      } else {
        fromElement(this.el, this.options);
      }
    }

    // Merges new options in. They apply from the next click; confetti
    // already in the air is left as it was.
    update(newOptions = {}) {
      Object.assign(this.options, newOptions);
    }

    destroy() {
      this.el.removeEventListener('click', this._onClick);
      // Lets initAll set the element up again, and get() stop returning
      // this one.
      delete this.el.__confettiInstance;
    }
  }

  Confetti.burst = burst;
  Confetti.fromElement = fromElement;
  Confetti.screen = screen;

  // Clears every piece out of the air at once.
  Confetti.clear = function () {
    stage.pieces = [];
    stage.emitters = [];
    if (stage.raf) {
      cancelAnimationFrame(stage.raf);
      stage.raf = null;
    }
    if (stage.ctx) {
      stage.ctx.setTransform(1, 0, 0, 1, 0, 0);
      stage.ctx.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
    }
  };

  Confetti.DEFAULTS = DEFAULTS;
  Confetti.MODE_DEFAULTS = MODE_DEFAULTS;
  Confetti.MODES = MODES;
  Confetti.SHAPES = Object.keys(SHAPE_PATHS);
  Confetti.DIRECTIONS = Object.keys(NAMED_DIRECTIONS).concat('all');

  Confetti.initAll = function (selector = '.confetti-el', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__confettiInstance)
      .map((el) => {
        const instance = new Confetti(el, options);
        el.__confettiInstance = instance;
        return instance;
      });
  };

  Confetti.get = function (elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__confettiInstance || null : null;
  };

  Confetti.getAll = function (selector = '.confetti-el') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__confettiInstance)
      .filter(Boolean);
  };

  global.Confetti = Confetti;

  function autoInit() {
    Confetti.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
