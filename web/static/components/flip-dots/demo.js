/**
 * Flip Dots — demo page
 * ----------------------
 * Drives the five boards on the page. Every control in the panel maps onto
 * one real option, so the panel doubles as the options reference: there is
 * nothing here a host could not pass to initAll.
 *
 * The content patterns are deliberately dumb — a checkerboard and some
 * banded noise are enough to watch a transition cross a board, and they are
 * staging for the component rather than part of it. The clock further down
 * is the one that earns its place: it is the only example driven by
 * something other than a timer picking shapes.
 */
document.addEventListener('DOMContentLoaded', () => {
  // flip-dots.js's own auto-init already claimed the board by the time this
  // runs (its DOMContentLoaded listener is registered first, since this file
  // loads after it) — this is a defensive fallback, same as the carousels'.
  FlipDots.initAll();

  const board = FlipDots.get('#fdBoard');
  if (!board) return;

  // ---- palettes ------------------------------------------------------
  // Each entry is a whole look: the panel behind the dots plus the states a
  // dot can hold. The three- and four-state ones are here to prove the
  // point that a disc's two faces don't cap how many colors it can show.
  const PALETTES = {
    mono: { background: '#0c0d10', palette: ['#1b1e24', '#f0ece2'] },
    amber: { background: '#07070a', palette: ['#141210', '#ffb01f'] },
    // State 0 is the page's own white and there is no rim, so an off dot is
    // invisible and the board materializes out of blank paper.
    materialize: { background: '#ffffff', palette: ['#ffffff', '#111111'] },
    triple: { background: '#0c0d10', palette: ['#1b1e24', '#f0ece2', '#e8503a'] },
    quad: { background: '#0c0d10', palette: ['#1b1e24', '#3f63e8', '#f0ece2', '#ffc247'] },
  };

  // ---- content patterns ----------------------------------------------
  // Each returns the (x, y) => state accessor setGrid wants, given the
  // number of states currently available.
  const PATTERNS = {
    scatter: (n) => () => Math.floor(Math.random() * n),
    checker: (n) => (x, y) => (x + y) % n,
    fill: (n) => () => n - 1,
    clear: () => () => 0,
    gradient: (n) => (x) => Math.min(n - 1, Math.floor((x / board.cols) * n)),
    bars: (n) => (x) => Math.floor(x / 3) % n,
    rings: (n) => {
      const cx = (board.cols - 1) / 2;
      const cy = (board.rows - 1) / 2;
      return (x, y) => Math.floor(Math.hypot(x - cx, y - cy) / 3) % n;
    },
    // Three sine fields at different scales and angles, banded into states.
    // Not real noise, but blotchy enough to look organic and cheap enough
    // to run on every cycle.
    blobs: (n) => {
      const seed = Math.random() * 100;
      return (x, y) => {
        const v = Math.sin((x + seed) * 0.22) + Math.sin((y - seed) * 0.31)
          + Math.sin((x + y) * 0.13 + seed);
        return Math.min(n - 1, Math.floor(((v + 3) / 6) * n));
      };
    },
    // The only pattern that reads the board instead of ignoring it.
    invert: (n) => (x, y) => n - 1 - board.get(x, y),
    // A word, in the same 5x7 font the message board below uses — the main
    // board is a display as much as it is a field of dots, and a transition
    // crossing a word reads differently from one crossing noise. Capacity
    // is measured off the grid rather than assumed, since the grid is
    // measured off the viewport.
    message: (n) => {
      const fits = Math.max(1, Math.floor((board.cols + 1) / (FlipDots.font.width + 1)));
      const word = MESSAGE_WORDS[messageWord % MESSAGE_WORDS.length].slice(0, fits);
      messageWord++;
      return FlipDots.textGrid(word, board.cols, board.rows, { on: n - 1, off: 0 });
    },
  };

  const MESSAGE_WORDS = ['FLIP', 'DOTS', 'HELLO', 'READY', 'CLICK', 'TURN', 'SNAP', '12:45'];
  let messageWord = 0;

  const CYCLE_PATTERNS = ['message', 'scatter', 'checker', 'rings', 'bars', 'blobs', 'gradient', 'invert'];
  const WIPE_DIRECTIONS = ['left', 'right', 'up', 'down'];

  function states() {
    return board.options.palette.length;
  }

  function apply(name, opts = {}) {
    const build = PATTERNS[name];
    if (!build) return;
    board.setGrid(build(states()), opts);
  }

  // ---- profiles ------------------------------------------------------
  const PROFILES = {
    default: {
      flipDuration: 125, bounce: 0.55, overshoot: 0.055, jitter: 0.18,
      shade: 0.45, perspective: 0.14, thickness: 0.09, hinge: 0, duration: 600,
      transition: 'ripple', easing: 'even',
    },
    // A departure board. Everything here is in service of one impression:
    // a sign made of a few thousand separate mechanical parts that are not
    // quite in step with each other. Heavy jitter is doing most of that
    // work — real boards never flip a row in unison. Row-by-row at a long
    // spread is the update those signs actually do, and the decelerating
    // pace is what makes it read as a machine running down rather than a
    // cursor sweeping past at constant speed.
    classic: {
      flipDuration: 115, bounce: 0.5, overshoot: 0.05, jitter: 0.42,
      shade: 0.52, perspective: 0.17, thickness: 0.11, hinge: 0, duration: 1600,
      transition: 'rows', easing: 'decelerate', palette: 'amber',
    },
    // Fast and tight. The bounce is barely lower than the default's, and
    // deliberately so — under the old stiffness-based controls, dropping
    // bounce further made the flip *slower* rather than crisper, because
    // extra damping cost more approach time than extra stiffness bought
    // back. Stating the time directly takes that trap away: the component
    // now works out whatever spring is needed to hit 100ms at this bounce.
    crisp: {
      flipDuration: 100, bounce: 0.45, overshoot: 0.035, jitter: 0.12,
      shade: 0.4, perspective: 0.1, thickness: 0.08, hinge: 0, duration: 350,
      transition: 'wipe', easing: 'even',
    },
    // A slower, weightier disc that takes its time over the half turn and
    // lands hard.
    heavy: {
      flipDuration: 160, bounce: 0.7, overshoot: 0.08, jitter: 0.22,
      shade: 0.55, perspective: 0.2, thickness: 0.12, hinge: 0, duration: 900,
      transition: 'ripple', easing: 'smooth',
    },
    // Loose and ringy, with a lot of spread between dots.
    loose: {
      flipDuration: 165, bounce: 0.95, overshoot: 0.14, jitter: 0.5,
      shade: 0.5, perspective: 0.26, thickness: 0.1, hinge: 0, duration: 2200,
      transition: 'random', easing: 'accelerate',
    },
    // No shading, no lean, no edge — what the flip looks like as a pure
    // squash, which is the thing everything else above is there to avoid.
    flat: {
      flipDuration: 125, bounce: 0.55, overshoot: 0.055, jitter: 0.18,
      shade: 0, perspective: 0, thickness: 0.02, hinge: 0, duration: 600,
      transition: 'ripple', easing: 'even',
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    flipDuration: document.getElementById('flipDurationRange'),
    bounce: document.getElementById('bounceRange'),
    overshoot: document.getElementById('overshootRange'),
    jitter: document.getElementById('jitterRange'),
    shade: document.getElementById('shadeRange'),
    perspective: document.getElementById('perspectiveRange'),
    thickness: document.getElementById('thicknessRange'),
    hinge: document.getElementById('hingeRange'),
    duration: document.getElementById('durationRange'),
    cols: document.getElementById('colsRange'),
    gap: document.getElementById('gapRange'),
    volume: document.getElementById('volumeRange'),
    cycle: document.getElementById('cycleRange'),
    shape: document.getElementById('shapeSelect'),
    transition: document.getElementById('transitionSelect'),
    easing: document.getElementById('easingSelect'),
    palette: document.getElementById('paletteSelect'),
    directional: document.getElementById('directionalCheckbox'),
    border: document.getElementById('borderCheckbox'),
    hover: document.getElementById('hoverCheckbox'),
    sound: document.getElementById('soundCheckbox'),
  };

  const readout = document.getElementById('fdReadout');

  function syncLabels() {
    document.getElementById('flipDurationVal').textContent = `${controls.flipDuration.value}ms`;
    // Read back off the board rather than recomputed here, and kept on
    // their own line because neither is a control. The settle time is the
    // interesting one: it moves when Bounce moves while the flip time holds
    // still, which is the whole point of keeping those two apart.
    document.getElementById('flipDurationDerived').textContent =
      `settles ${Math.round(board.settleMs)}ms · spring k≈${Math.round(board.springConstant)}`;
    document.getElementById('bounceVal').textContent = Number(controls.bounce.value).toFixed(2);
    document.getElementById('overshootVal').textContent = `${Math.round(Number(controls.overshoot.value) * 180)}°`;
    document.getElementById('jitterVal').textContent = Number(controls.jitter.value).toFixed(2);
    document.getElementById('shadeVal').textContent = Number(controls.shade.value).toFixed(2);
    document.getElementById('perspectiveVal').textContent = Number(controls.perspective.value).toFixed(2);
    document.getElementById('thicknessVal').textContent = Number(controls.thickness.value).toFixed(2);
    // Named at the two angles that have names, since those are the ones
    // worth being able to find again by eye on the slider.
    const hinge = Number(controls.hinge.value);
    const hingeName = hinge === 0 || hinge === 180 ? ' tumble' : (hinge === 90 ? ' door' : '');
    document.getElementById('hingeVal').textContent = `${hinge}°${hingeName}`;
    document.getElementById('durationVal').textContent = `${controls.duration.value}ms`;
    document.getElementById('colsVal').textContent = controls.cols.value;
    document.getElementById('gapVal').textContent = Number(controls.gap.value).toFixed(2);
    document.getElementById('volumeVal').textContent = Number(controls.volume.value).toFixed(2);
    const cycle = Number(controls.cycle.value);
    document.getElementById('cycleVal').textContent = cycle > 0 ? `${cycle}ms` : 'Off';
  }

  // Reads the grid back off the instance rather than echoing the slider: the
  // columns asked for are a request measured against the box and clamped by
  // the minimum legible dot size, so what you get is often not what you set.
  function syncReadout() {
    readout.textContent = `${board.cols} × ${board.rows} · ${board.length} dots · `
      + `${board.dotPx.toFixed(1)}px dots on a ${board.pitchPx.toFixed(1)}px pitch`;
  }

  // Every slider maps one range input onto one option.
  const numeric = [
    ['flipDuration', 'flipDuration'],
    ['bounce', 'bounce'],
    ['overshoot', 'overshoot'],
    ['jitter', 'jitter'],
    ['shade', 'shade'],
    ['perspective', 'perspective'],
    ['thickness', 'thickness'],
    ['hinge', 'hinge'],
    ['duration', 'duration'],
  ];

  numeric.forEach(([key, option]) => {
    controls[key].addEventListener('input', () => {
      board.update({ [option]: Number(controls[key].value) });
      syncLabels();
    });
  });

  // Grid changes go through update() too, but they re-measure and resample,
  // so the readout has to follow.
  ['cols', 'gap'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      board.update({ [key]: Number(controls[key].value) });
      syncLabels();
      syncReadout();
    });
  });

  controls.volume.addEventListener('input', () => {
    board.update({ volume: Number(controls.volume.value) });
    syncLabels();
  });

  controls.shape.addEventListener('change', () => {
    board.update({ shape: controls.shape.value });
  });

  controls.directional.addEventListener('change', () => {
    board.update({ directional: controls.directional.checked });
  });

  // A rim has to contrast with the panel behind the dots, not with the dots
  // themselves — a black stroke on the dark palettes is simply invisible.
  function rimColor() {
    return controls.palette.value === 'materialize'
      ? 'rgba(0, 0, 0, 0.5)'
      : 'rgba(255, 255, 255, 0.22)';
  }

  controls.border.addEventListener('change', () => {
    board.update({ borderColor: controls.border.checked ? rimColor() : null });
  });

  controls.sound.addEventListener('change', () => {
    // enableSound() rather than update({ sound: true }): the change event is
    // itself the user gesture the AudioContext needs, and waiting for the
    // next one would swallow the first wave.
    if (controls.sound.checked) board.enableSound();
    else board.update({ sound: false });
  });

  // Show the change immediately rather than waiting for the next cycle —
  // picking a transition or a pace is a request to see it.
  ['transition', 'easing'].forEach((key) => {
    controls[key].addEventListener('change', () => {
      board.update({ [key]: controls[key].value });
      apply('scatter');
    });
  });

  // A palette change can shrink the number of states, so anything currently
  // showing a state that no longer exists has to come down. update() clamps
  // on the next request rather than retroactively, so the board is rewritten
  // instead: it also means switching palettes plays a transition, which is
  // the nicer way to see a new one arrive.
  controls.palette.addEventListener('change', () => {
    const preset = PALETTES[controls.palette.value];
    if (!preset) return;
    board.update({ ...preset, borderColor: controls.border.checked ? rimColor() : null });
    apply('blobs', { transition: 'ripple' });
  });

  // See shared/demo-shared.js: one pass over the same tables the individual
  // listeners use, so a profile can only ever set what a control could have
  // set by hand. The palette is the one thing it sets indirectly — profiles
  // name a preset, and the preset is what carries the actual colors.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({
      profile, controls, numeric, directs: ['transition', 'easing'],
    });
    if (profile.palette) {
      controls.palette.value = profile.palette;
      Object.assign(options, PALETTES[profile.palette], {
        borderColor: controls.border.checked ? rimColor() : null,
      });
    }
    board.update(options);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  // ---- pattern buttons -----------------------------------------------
  document.querySelectorAll('[data-pattern]').forEach((btn) => {
    btn.addEventListener('click', () => {
      apply(btn.dataset.pattern, {
        direction: WIPE_DIRECTIONS[Math.floor(Math.random() * WIPE_DIRECTIONS.length)],
      });
    });
  });

  // ---- auto cycle ----------------------------------------------------
  // Something has to be moving for the mechanics sliders to mean anything,
  // so the board drives itself by default. Held while the pointer is over
  // the board, so hover-flipping single dots isn't fighting a board-wide
  // update every couple of seconds.
  let cycleTimer = null;
  let pointerOver = false;
  let cyclePaused = false;

  function cycleBeat() {
    if (pointerOver) return;
    // Whatever transition is selected is the one used — 'shuffle' is how
    // you ask for variety now, rather than the cycle quietly rewriting the
    // control behind your back the way it used to.
    apply(CYCLE_PATTERNS[Math.floor(Math.random() * CYCLE_PATTERNS.length)]);
  }

  function syncCycle() {
    clearInterval(cycleTimer);
    cycleTimer = null;
    const every = Number(controls.cycle.value);
    if (every > 0 && !cyclePaused) cycleTimer = setInterval(cycleBeat, every);
  }

  controls.cycle.addEventListener('input', () => {
    syncCycle();
    syncLabels();
  });

  const cycleToggle = document.getElementById('fdCycleToggle');
  cycleToggle.addEventListener('click', () => {
    cyclePaused = !cyclePaused;
    cycleToggle.textContent = cyclePaused ? 'Resume' : 'Pause';
    cycleToggle.setAttribute('aria-pressed', String(!cyclePaused));
    syncCycle();
  });

  // ---- pointer -------------------------------------------------------
  // Hover flips the dot under the pointer, which is the only way to judge a
  // single flip in isolation; clicking sends a ripple out from that dot,
  // which is the one transition that always needs an origin other than the
  // center. Both go through dotAt(), so neither has to know the pitch or
  // the centering offset.
  let lastHovered = -1;

  board.el.addEventListener('pointermove', (e) => {
    if (!controls.hover.checked) return;
    const at = board.dotAt(e.clientX, e.clientY);
    if (!at) return;
    const i = at[1] * board.cols + at[0];
    if (i === lastHovered) return;
    lastHovered = i;
    // Step to the next state round rather than to a fixed one, so dragging
    // across a multi-state palette walks through all of it.
    board.set(at[0], at[1], (board.get(at[0], at[1]) + 1) % states());
  });

  board.el.addEventListener('pointerleave', () => {
    lastHovered = -1;
    pointerOver = false;
  });

  board.el.addEventListener('pointerenter', () => {
    pointerOver = true;
  });

  board.el.addEventListener('click', (e) => {
    const at = board.dotAt(e.clientX, e.clientY);
    if (!at) return;
    apply('blobs', { transition: 'ripple', origin: at });
  });

  // A viewport change re-measures the grid, so the readout follows it.
  window.addEventListener('resize', syncReadout);

  // ---- the message board ---------------------------------------------
  // A second instance, driven entirely through text() rather than through
  // patterns. It deliberately runs its own options: a departure board wants
  // amber on near-black and a row-by-row update, and nothing about it should
  // follow the rig's sliders around.
  const textBoard = FlipDots.get('#fdTextBoard');
  if (textBoard) {
    const MESSAGES = [
      'FLIP DOTS', 'ARRIVING', 'GATE 7', '14:05', 'ON TIME',
      'PLATFORM 9', 'DELAYED', 'HELLO', 'NOW BOARDING',
    ];
    textBoard.update({
      ...PALETTES.amber,
      // Wide enough for the longest message below: at 5 dots a glyph plus a
      // dot between, 12 characters needs 71 columns.
      cols: 72,
      gap: 0.2,
      flipDuration: 110,
      bounce: 0.5,
      jitter: 0.42,
      transition: 'rows',
      easing: 'decelerate',
      duration: 1400,
    });

    let messageIndex = 0;
    let textTimer = null;
    let textPaused = false;
    let custom = '';

    // How many characters this board can hold. Derived rather than written
    // down, because the grid is measured against the element's box and so
    // depends on the viewport — a hardcoded limit would be wrong on every
    // window but the one it was written on.
    function capacity() {
      const glyph = FlipDots.font.width + 1; // one dot of spacing
      return Math.max(1, Math.floor((textBoard.cols + 1) / glyph));
    }

    function showMessage(str) {
      // Anything past what fits would be clipped at both ends and read as
      // nonsense, so it is trimmed instead — a truncated message is at
      // least honest about being a message.
      textBoard.text(String(str).slice(0, capacity()), { spacing: 1 });
    }

    function nextMessage() {
      if (custom) return;
      showMessage(MESSAGES[messageIndex % MESSAGES.length]);
      messageIndex++;
    }

    function syncText() {
      clearInterval(textTimer);
      textTimer = null;
      if (!textPaused && !custom) textTimer = setInterval(nextMessage, 3200);
    }

    const textToggle = document.getElementById('fdTextToggle');
    textToggle.addEventListener('click', () => {
      textPaused = !textPaused;
      textToggle.textContent = textPaused ? 'Resume' : 'Pause';
      textToggle.setAttribute('aria-pressed', String(!textPaused));
      syncText();
    });

    document.getElementById('fdTextNext').addEventListener('click', () => {
      // Advancing by hand restarts the interval too, so the message just
      // asked for gets a full dwell rather than whatever was left of the
      // beat it landed in.
      if (custom) { custom = ''; document.getElementById('fdTextInput').value = ''; }
      nextMessage();
      syncText();
    });

    const textInput = document.getElementById('fdTextInput');
    function syncCapacity() {
      textInput.maxLength = capacity();
    }
    window.addEventListener('resize', syncCapacity);
    syncCapacity();

    textInput.addEventListener('input', () => {
      custom = textInput.value.trim();
      syncText();
      showMessage(custom || MESSAGES[messageIndex % MESSAGES.length]);
    });

    nextMessage();
    syncText();
  }

  // ---- three scales ---------------------------------------------------
  // The same component and the same content at three dot sizes, to show
  // that the grid is derived from the box rather than configured into it.
  // The finest one is deliberately asked for below the legible floor, so
  // the readout underneath it reports a coarser grid than requested — that
  // clamp is the thing this example exists to show.
  [['fdSizeA', 18], ['fdSizeB', 10], ['fdSizeC', 3]].forEach(([id, dotSize]) => {
    const mini = FlipDots.get(`#${id}`);
    if (!mini) return;
    mini.update({
      ...PALETTES.mono, dotSize, gap: 0.2, duration: 900, transition: 'ripple',
    });

    const readout = document.querySelector(`[data-size-readout="${id}"]`);
    const report = () => {
      readout.textContent = `${mini.cols}×${mini.rows}, ${mini.dotPx.toFixed(1)}px dots`
        + (dotSize > mini.dotPx + 0.5 || dotSize < mini.dotPx - 0.5 ? ` (asked ${dotSize}px)` : '');
    };

    const beat = () => {
      const seed = Math.random() * 100;
      mini.setGrid((x, y) => (
        Math.sin((x + seed) * 0.25) + Math.sin((y - seed) * 0.33) > 0.3 ? 1 : 0
      ), { transition: 'ripple' });
    };
    beat();
    setInterval(beat, 2800);
    report();
    window.addEventListener('resize', report);
  });

  // ---- the clock ------------------------------------------------------
  // The one example driven by something other than a timer picking shapes.
  // It writes the time every second with no transition at all: only the
  // dots that disagree with what is already up will flip, so a tick is the
  // handful of discs making up the digit that changed, and the rest of the
  // board does not move. A rippling clock would be a toy.
  const clock = FlipDots.get('#fdClock');
  if (clock) {
    clock.update({
      ...PALETTES.amber,
      cols: 54,
      gap: 0.18,
      flipDuration: 110,
      jitter: 0.35,
      transition: 'instant',
    });

    let clockTimer = null;
    let clockPaused = false;

    function tick() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      clock.text(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, {
        spacing: 1,
      });
    }

    function syncClock() {
      clearInterval(clockTimer);
      clockTimer = null;
      if (!clockPaused) clockTimer = setInterval(tick, 1000);
    }

    const clockToggle = document.getElementById('fdClockToggle');
    clockToggle.addEventListener('click', () => {
      clockPaused = !clockPaused;
      clockToggle.textContent = clockPaused ? 'Resume' : 'Pause';
      clockToggle.setAttribute('aria-pressed', String(!clockPaused));
      syncClock();
    });

    tick();
    syncClock();
  }

  // ---- the board as a surface -----------------------------------------
  // This instance has children, and the component's canvas sits behind
  // them. Everything about its options is in service of the text staying
  // readable: a lit state well down from white, coarse dots so there is
  // more panel than disc, and a slow sparse field rather than content.
  const backdrop = FlipDots.get('#fdBackdrop');
  if (backdrop) {
    backdrop.update({
      dotSize: 15,
      gap: 0.3,
      background: '#0b0c0f',
      palette: ['#15181d', '#2f3947'],
      flipDuration: 140,
      jitter: 0.4,
      duration: 2600,
      easing: 'smooth',
      transition: 'ripple',
    });
    const drift = () => {
      const seed = Math.random() * 100;
      backdrop.setGrid((x, y) => (
        Math.sin((x + seed) * 0.18) + Math.sin((y - seed) * 0.24)
          + Math.sin((x + y) * 0.1 + seed) > 0.9 ? 1 : 0
      ), { transition: 'ripple' });
    };
    drift();
    setInterval(drift, 4200);
  }

  applyProfile('default');
  // The grid and palette controls start at values of their own rather than
  // at the component's defaults, so they have to be pushed once up front or
  // the panel would be describing a board it isn't driving.
  board.update({
    ...PALETTES.mono,
    cols: Number(controls.cols.value),
    gap: Number(controls.gap.value),
    transition: controls.transition.value,
    easing: controls.easing.value,
    sound: controls.sound.checked,
    volume: Number(controls.volume.value),
  });
  syncLabels();
  syncReadout();
  syncCycle();
  apply('blobs', { transition: 'ripple' });
});
