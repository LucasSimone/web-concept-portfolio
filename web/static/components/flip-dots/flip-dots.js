/**
 * FlipDots
 * --------
 * A programmable grid of physical flip-dot discs on a canvas. Each dot is a
 * disc on a center axle: asked for a new state it rotates a half turn, and
 * the color you see swaps at the exact moment it passes edge-on. That one
 * detail is what lets a dot hold any number of colors without lying about
 * the metaphor - a real disc has two faces, but nobody ever sees the back of
 * one, so repainting the far face mid-turn is invisible and any state can
 * reach any other in a single flip.
 *
 * Two things are kept deliberately separate, and keeping them separate is
 * most of the design:
 *
 *   mechanics    how ONE dot moves - the spring, the magnet stop it slams
 *                into, the shading as it turns away from the light. Tuned
 *                once, globally, because a dot that feels good feels good
 *                everywhere.
 *   choreography WHO starts when - a wipe, a ripple, a scatter. This is a
 *                single function of position, which is why the whole
 *                vocabulary of grid-update animations fits in one plug-in
 *                point (see `FlipDots.transitions`) instead of a dozen
 *                options.
 *
 * Which of the two applies is decided by how you wrote to the grid:
 * `set()` on individual dots flips them as they come, with no choreography
 * - that is a dot being poked, and poking it should be immediate. Writing a
 * whole grid with `setGrid()` is a new frame of content arriving, and that
 * gets a transition.
 *
 * Canvas rather than one element per dot: a 100x60 board is 6000 dots, which
 * is well past what DOM transforms carry, and the overshoot/shading/edge
 * detail below needs per-frame control that CSS transitions don't give.
 *
 * Usage: give any element `class="flip-dots"` - this file injects its own CSS
 * and auto-initializes every matching element on load.
 *
 *   FlipDots.get('#board').setGrid(rows, { transition: 'ripple' });
 *
 * Content arrives as one of four things, and they are all the same thing
 * underneath - an `(x, y) => state` accessor handed to `setGrid`:
 *
 *   a grid     arrays, strings, or an accessor of your own
 *   text       `text()`, over the 5x7 bitmap font below
 *   an image   `FlipDots.imageGrid()`, over any <video>/<img>/canvas
 *   a sequence `play()`, which is a frame source plus a clock
 *
 * The last two compose: a camera mirror is `play()` driving a function that
 * returns `imageGrid(video, ...)`, and the component needs to know nothing
 * about cameras for that to work.
 */
(function (global) {
  const STYLE_ID = 'flip-dots-styles';
  const CSS = `
.flip-dots {
  position: relative;
  isolation: isolate;
  display: block;
  overflow: hidden;
}

.flip-dots__canvas {
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

  // Below about five pixels a disc has no room to read as a disc: the
  // squash that carries the whole effect happens inside one or two device
  // pixels and the flip stops being legible as rotation. Rather than
  // honoring a grid that fine and rendering mush, the grid is reduced until
  // its dots clear this - see _measure, and `cols`/`rows` afterward for what
  // you actually got.
  const MIN_DOT_PX = 5;

  // Fixed spring sub-step. The integrator below is explicit, so a stiff
  // spring sampled at a long frame time can gain energy instead of losing
  // it; stepping at a fixed 1/300s regardless of frame rate keeps the feel
  // identical on a 60Hz and a 144Hz display, and keeps a dropped frame from
  // flinging a dot.
  const SUB_STEP = 1 / 300;

  const DEFAULTS = {
    // --- grid -------------------------------------------------------
    // Columns across. null measures the box against `dotSize` instead.
    cols: null,
    // Rows down. null derives it from `cols` so cells come out square.
    rows: null,
    // Target dot diameter in px, used only when `cols` is null.
    dotSize: 16,
    // Space between dots as a fraction of the cell pitch (0 = touching).
    gap: 0.22,
    shape: 'circle', // 'circle' | 'square' | 'rounded'

    // --- color ------------------------------------------------------
    // A dot's state is an index into this. Entries are a color string, or
    // `{ fill, border, edge }` to give one state its own rim - which is how
    // an "off" dot gets a faint socket ring while a lit one stays clean.
    palette: ['#1b1e24', '#f0ece2'],
    // Behind the dots. null leaves the canvas transparent, so the board can
    // sit over whatever is underneath it.
    background: '#0c0d10',
    // Rim on every disc, unless its palette entry overrides it. Off by
    // default: with no rim and state 0 matching the page behind it, dots
    // materialize out of nothing instead of sitting in a visible socket.
    borderColor: null,
    borderWidth: 0.08, // fraction of dot diameter

    // --- mechanics --------------------------------------------------
    // How long one dot takes to reach its stop, in milliseconds. This and
    // `bounce` are the only two numbers in the spring, and they divide
    // cleanly: bounce decides what the motion looks like, this decides how
    // fast that same motion plays. Changing it is the same flip sped up or
    // slowed down; changing bounce is a different flip.
    //
    // Note this is time to the *stop*, not to fully stopped ringing - the
    // visible travel. A bouncy dot reaches its stop on time and rattles
    // against it for a while afterward; see `settleMs` for that figure.
    flipDuration: 130,
    // 0 = critically damped (no overshoot at all), 1 = loose and ringy.
    bounce: 0.55,
    // The same control as `flipDuration`, in spring units, for anyone who
    // would rather state the force than the time. Set one or the other:
    // this wins when it isn't null, and `flipDuration` is then ignored.
    // Kept because the integrator wants a spring constant anyway and there
    // is no reason to hide it, not because both are meant to be used.
    stiffness: null,
    // How far past the stop the disc is allowed to travel, in half turns.
    // This is the magnet it slams into: travel is clamped here and the
    // remaining velocity rebounds, which is what gives arrival its thunk.
    overshoot: 0.055,
    // Per-dot random variation in spring rate, so a wave never looks like
    // it was clocked.
    jitter: 0.18,
    // Depth of the shading as a face turns away from the light. 0 is flat
    // color; this is most of what reads as three-dimensional.
    shade: 0.45,
    // The color of the disc's edge - what you are actually looking at near
    // edge-on, when the face has foreshortened to nothing. null derives one
    // from the palette, which is what keeps this from needing to be set.
    //
    // This matters more than it sounds. Without it, a face just darkens as
    // it turns, and a dark face on a dark panel darkens straight into
    // invisibility - so half of every flip is a dot quietly vanishing and
    // the other half is a different dot appearing, which is exactly what
    // the flip is supposed to not look like. A rim that is neither of the
    // two faces keeps the disc continuously visible all the way round, and
    // reads as the one piece of plastic it is meant to be.
    edgeColor: null,
    // How tightly the rim is confined to the edge-on sliver. Low values
    // bleed it across the whole turn, which cross-fades the two faces into
    // each other and loses the moment of the swap; high values keep each
    // face its own color until the last instant, so the rim reads as a
    // glint at the midpoint and the swap lands as a snap.
    edgeFalloff: 3,
    // How much the disc appears to swing toward and away from you, as a
    // fraction of its diameter. The other half of reading as hinged.
    perspective: 0.14,
    // Visible thickness of the disc edge-on, as a fraction of its diameter.
    // A real disc never vanishes at 90 degrees - it shows its edge - and
    // without this the flip has a dead frame in the middle of it.
    thickness: 0.09,
    // The angle of the axle the disc turns on, in degrees. 0 lays the hinge
    // horizontally so the disc tumbles top over bottom; 90 stands it upright
    // so the disc swings like a door; anything between is a diagonal. Only
    // 0..180 is meaningful - a hinge line has no near end and far end, so
    // 190 degrees is the same axle as 10.
    hinge: 0,
    // Flip toward higher states one way and toward lower states the other,
    // so a board visibly opens and closes rather than always turning the
    // same way.
    directional: true,

    // --- choreography -----------------------------------------------
    // Default for setGrid: a name from FlipDots.transitions, or a function.
    // 'shuffle' picks a different one for every update.
    transition: 'ripple',
    // Milliseconds from the first dot starting to the last one starting.
    duration: 600,
    // Reshapes the order a transition hands back, so the wave can keep an
    // even pace or run down / wind up as it crosses. A name from
    // FlipDots.easings, or a function. See that registry for why this is
    // separate from the transition rather than baked into each one.
    easing: 'even',

    // --- playback ---------------------------------------------------
    // Frames per second for play(). Read live, so update({ fps }) retimes
    // a sequence already running.
    //
    // There is a real ceiling above this and it is `flipDuration`: a disc
    // cannot turn twice in the time it takes to turn once, so past about
    // 1000/flipDuration the frames arrive while the dots are still mid-
    // turn, and what you get is each dot chasing the latest value instead
    // of the sequence being shown. That is not a failure - a camera at 30
    // on a 130ms flip still reads as a camera - but it is the board
    // smearing rather than playing, and it is why the default sits a long
    // way under film rate. The honest frame rate of a flip-dot board is
    // the frame rate of its discs.
    fps: 12,

    // --- sound ------------------------------------------------------
    // Off by default - a component that starts making noise in someone
    // else's page has to be asked for. Switching it on arms the audio on
    // the next pointer or key event, since browsers will not start audio
    // before a real user gesture; see enableSound for the case where the
    // gesture has already happened.
    sound: false,
    volume: 0.5,

    // --- hooks ------------------------------------------------------
    // Called as each dot passes edge-on and shows its new face, with
    // (x, y, state, board). Off by default because a board-wide wave is
    // thousands of calls in a frame - take it only if you want them. For
    // "the whole update has landed", listen for flip-dots:settle instead.
    onFlip: null,
  };

  // ---------------------------------------------------------------------
  // Transitions
  //
  // A transition answers one question per dot: how far into the update does
  // this one start, as a fraction of `duration`. That is the whole contract
  // - `(x, y, ctx) => 0..1`, where ctx carries { cols, rows, from, to,
  // origin }. Everything from a wipe to a scatter to a spiral is a
  // different answer to it, which is why this is a registry rather than an
  // enum: `FlipDots.transitions.register('mine', fn)` buys the same
  // standing as the built-ins.
  //
  // The answer is a place in the order, not a time: `duration` decides how
  // long the whole order takes and the easing decides how the clock runs
  // while it does, so a transition never has to know either. Values are
  // clamped to 0..1 - see setGrid.
  // ---------------------------------------------------------------------
  const transitions = {
    // Everything at once. The board changes in a single clack.
    instant: () => 0,

    // Every changing dot gets its own slot in a shuffled order, so they go
    // one at a time, evenly paced, until the board has turned over. This
    // needs to know the whole set of changing dots before it can answer for
    // any one of them, which is what `ctx.rank` is for - see setGrid.
    //
    // The distinction from `dissolve` below is the one worth knowing. Giving
    // every dot an independent random number is the obvious way to write
    // this and it is not the same thing: independent draws clump, so some
    // dots land on nearly the same instant while other stretches of the
    // spread are empty, and the result flickers unevenly rather than
    // counting steadily down. A shuffle has no clumps because every dot
    // gets a different slot by construction.
    random: (x, y, g) => (g.rank ? g.rank(x, y) : Math.random()),

    // Independent draws per dot - the clumpy version, kept because the
    // unevenness reads as a surface corroding rather than as a list being
    // worked through, and that is sometimes the wanted effect.
    dissolve: () => Math.random(),

    // A straight edge crossing the board. The classic departure-board wipe.
    wipe: (x, y, g) => {
      const fx = g.cols > 1 ? x / (g.cols - 1) : 0;
      const fy = g.rows > 1 ? y / (g.rows - 1) : 0;
      switch (g.direction) {
        case 'right': return 1 - fx;
        case 'up': return 1 - fy;
        case 'down': return fy;
        default: return fx; // 'left' - starts at the left edge
      }
    },

    // Corner to corner.
    diagonal: (x, y, g) => (x + y) / Math.max(1, (g.cols - 1) + (g.rows - 1)),

    // Outward from a point - the center by default, or wherever `origin`
    // says, which is what makes a ripple from the dot someone just clicked
    // a one-liner.
    ripple: (x, y, g) => {
      const ox = g.origin ? g.origin[0] : (g.cols - 1) / 2;
      const oy = g.origin ? g.origin[1] : (g.rows - 1) / 2;
      const d = Math.hypot(x - ox, y - oy);
      // Normalized against the furthest corner from the origin, so the last
      // dot to start always starts at 1 regardless of where the origin sits.
      const max = Math.max(
        Math.hypot(0 - ox, 0 - oy),
        Math.hypot(g.cols - 1 - ox, 0 - oy),
        Math.hypot(0 - ox, g.rows - 1 - oy),
        Math.hypot(g.cols - 1 - ox, g.rows - 1 - oy),
      );
      return max === 0 ? 0 : d / max;
    },

    // Line by line, every dot in a row together.
    rows: (x, y, g) => (g.rows > 1 ? y / (g.rows - 1) : 0),

    // One dot at a time, boustrophedon - down each row and back along the
    // next, so the travel is continuous instead of jumping back to the left
    // margin.
    snake: (x, y, g) => {
      const col = y % 2 === 0 ? x : g.cols - 1 - x;
      const total = g.cols * g.rows;
      return total <= 1 ? 0 : (y * g.cols + col) / (total - 1);
    },
  };

  transitions.register = function register(name, fn) {
    transitions[name] = fn;
  };

  // Every name that `shuffle` draws from. Held separately from the registry
  // itself so that `register`, `instant` and `shuffle` are not candidates -
  // the first because a host's own transition should be opt-in rather than
  // turning up unannounced, and the other two because one is the absence of
  // choreography and the other would recurse.
  const SHUFFLE_POOL = ['random', 'dissolve', 'wipe', 'diagonal', 'ripple', 'rows', 'snake'];
  const WIPE_DIRECTIONS = ['left', 'right', 'up', 'down'];

  function resolveTransition(spec) {
    if (typeof spec === 'function') return spec;
    // Resolved once per update rather than once per dot, which is what lets
    // 'shuffle' mean "a different transition each time" instead of a
    // different one for every dot (which is just `random` with extra steps).
    if (spec === 'shuffle') {
      return transitions[SHUFFLE_POOL[Math.floor(Math.random() * SHUFFLE_POOL.length)]];
    }
    const fn = transitions[spec];
    // An unrecognized name changes the board without choreography rather
    // than throwing: a typo should cost the animation, not the content.
    return typeof fn === 'function' ? fn : transitions.instant;
  }

  // ---------------------------------------------------------------------
  // Easings
  //
  // A transition says what ORDER the dots go in; an easing says how the
  // clock runs while they do. Keeping them apart means four easings times
  // seven transitions is twenty-eight looks out of eleven small functions,
  // instead of needing a `ripple-decelerating` entry in the registry next
  // to `ripple`.
  //
  // Each maps a dot's place in the order (0..1) to when it starts (0..1).
  // The curve is easier to read backwards: where the output changes slowly,
  // many dots start close together and the wave is moving FAST; where it
  // changes quickly, they are spread out and the wave is moving slowly.
  // ---------------------------------------------------------------------
  const easings = {
    // Constant pace from one side to the other.
    even: (t) => t,
    // Off hard and winding down - most of the board has gone in the first
    // half of the spread, and the stragglers take the rest.
    decelerate: (t) => t * t,
    // The reverse: a slow start that gathers and finishes in a rush.
    accelerate: (t) => 1 - (1 - t) * (1 - t),
    // Smoothstep. Quick at both ends and lingering through the middle,
    // which reads as the wave arriving, taking its time over the body of
    // the board, then clearing out.
    smooth: (t) => t * t * (3 - 2 * t),
  };

  easings.register = function register(name, fn) {
    easings[name] = fn;
  };

  function resolveEasing(spec) {
    if (typeof spec === 'function') return spec;
    const fn = easings[spec];
    return typeof fn === 'function' ? fn : easings.even;
  }

  // ---------------------------------------------------------------------
  // Font
  //
  // A 5x7 bitmap, written out as pixels rather than packed into bit tables,
  // because the only way anyone ever fixes a glyph is by looking at it. Row
  // strings are joined with "|" to keep one glyph to one line; "#" is a lit
  // dot. Five by seven is the smallest cell that holds a legible uppercase
  // alphabet plus digits, and it is what real flip-dot destination signs
  // use for the same reason.
  //
  // Lowercase maps onto the same glyphs rather than existing separately -
  // at seven rows there is no room for descenders, so a lowercase set would
  // have to be a worse-looking copy of this one.
  // ---------------------------------------------------------------------
  const FONT_W = 5;
  const FONT_H = 7;
  const GLYPH_SRC = {
    A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
    B: '####.|#...#|#...#|####.|#...#|#...#|####.',
    C: '.###.|#...#|#....|#....|#....|#...#|.###.',
    D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
    E: '#####|#....|#....|####.|#....|#....|#####',
    F: '#####|#....|#....|####.|#....|#....|#....',
    G: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
    H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
    I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
    J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
    K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
    L: '#....|#....|#....|#....|#....|#....|#####',
    M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
    N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
    O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
    P: '####.|#...#|#...#|####.|#....|#....|#....',
    Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
    R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
    S: '.####|#....|#....|.###.|....#|....#|####.',
    T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
    V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
    W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
    X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
    Z: '#####|....#|...#.|..#..|.#...|#....|#####',
    0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
    1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
    2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
    3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
    4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
    5: '#####|#....|####.|....#|....#|#...#|.###.',
    6: '..##.|.#...|#....|####.|#...#|#...#|.###.',
    7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
    8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
    9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
    ' ': '.....|.....|.....|.....|.....|.....|.....',
    '.': '.....|.....|.....|.....|.....|.##..|.##..',
    ',': '.....|.....|.....|.....|.##..|.##..|.#...',
    '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
    '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
    "'": '..#..|..#..|.....|.....|.....|.....|.....',
    '-': '.....|.....|.....|#####|.....|.....|.....',
    ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
    '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
    '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
    '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  };

  const GLYPHS = {};
  Object.keys(GLYPH_SRC).forEach((ch) => {
    GLYPHS[ch] = GLYPH_SRC[ch].split('|');
  });

  const font = { width: FONT_W, height: FONT_H, glyphs: GLYPHS };

  // Builds the (x, y) => state accessor setGrid wants for a line of text.
  // Separate from the instance so a caller can compose it - lay text over a
  // pattern, measure it before committing - rather than only ever being able
  // to hand the whole board over to it.
  //
  // Unmapped characters fall back to a space rather than throwing or drawing
  // a tofu box: a sign that cannot render an accented character should lose
  // the character, not the message.
  function textGrid(str, cols, rows, opts = {}) {
    const spacing = opts.spacing == null ? 1 : opts.spacing;
    const on = opts.on == null ? 1 : opts.on;
    const off = opts.off == null ? 0 : opts.off;
    const chars = String(str).toUpperCase().split('');
    const glyphs = chars.map((c) => GLYPHS[c] || GLYPHS[' ']);

    const width = glyphs.length
      ? glyphs.length * FONT_W + (glyphs.length - 1) * spacing
      : 0;
    const ox = opts.x == null ? Math.round((cols - width) / 2) : opts.x;
    const oy = opts.y == null ? Math.round((rows - FONT_H) / 2) : opts.y;

    // A lookup rather than a per-dot search over the glyphs: setGrid asks
    // once per cell, and a long message on a big board would otherwise be
    // a scan of every glyph for every dot.
    const lit = new Set();
    glyphs.forEach((glyph, gi) => {
      const gx = ox + gi * (FONT_W + spacing);
      for (let r = 0; r < FONT_H; r++) {
        for (let c = 0; c < FONT_W; c++) {
          if (glyph[r][c] !== '#') continue;
          const px = gx + c;
          const py = oy + r;
          if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
          lit.add(py * cols + px);
        }
      }
    });

    return (x, y) => (lit.has(y * cols + x) ? on : off);
  }

  // ---------------------------------------------------------------------
  // Images
  //
  // Anything drawable - a <video>, an <img>, a canvas, an ImageBitmap - as
  // the same `(x, y) => state` accessor setGrid takes. The conversion is
  // three steps, and only the third is interesting:
  //
  //   1. draw the source into a canvas the size of the GRID, so the
  //      browser's own resampler does the averaging. One dot is one pixel
  //      here; there is no separate sampling pass to get wrong.
  //   2. read the luminance back.
  //   3. decide which state each cell's gray lands on.
  //
  // Step three is the whole problem, because a board has no grays. A
  // two-color board has two values and a photograph has two hundred, so
  // the shades in between have to be traded for a pattern of dots whose
  // density reads as the gray it replaced - dithering. Which dither is a
  // different question here than it is in print: ink does not move, and
  // every dot that changes on this board is a disc that physically turns.
  // See DITHERS for what that costs.
  //
  // Returns null when the source has no pixels yet - a <video> that has not
  // started, an <img> that has not loaded. Both setGrid and play() read
  // null as "nothing to write", so a caller never has to check readyState.
  // ---------------------------------------------------------------------

  // The classic 4x4 ordered-dither threshold matrix, as the order its
  // cells are turned on in. Recursive by construction, which is why it
  // tiles without the seams a hand-drawn matrix would have.
  const BAYER4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];

  const DITHERS = {
    // No dither: every cell to its nearest state. Crisp and posterized -
    // right for a logo or a silhouette, and wrong for a face, which comes
    // out as two blobs.
    none: 'none',
    // Ordered (Bayer). A fixed threshold per grid position, so the same
    // gray always resolves to the same dots. On a board that matters more
    // than it looks: a scene holding still produces an identical frame,
    // and an identical frame flips nothing. This is the default for that
    // reason rather than for how it looks.
    ordered: 'ordered',
    // Floyd-Steinberg error diffusion. Better gradients and much better
    // edges, at the cost of being a function of the whole frame: a pixel
    // changing in one corner shifts the error that reaches everywhere
    // after it, so a still scene still shimmers and a board that could
    // have held perfectly still flips a few hundred discs a second
    // instead. Worth it for a single image; think twice for a sequence.
    diffusion: 'diffusion',
  };

  // Scratch canvases for the conversions, resized as needed. At grid
  // resolution these are a few thousand pixels, so `willReadFrequently` is
  // the right trade - the readback happens every frame of a sequence, and
  // keeping the surface on the CPU costs far less than stalling on a GPU
  // fetch twenty times a second.
  //
  // Keyed rather than shared, because imageGrid and imagePalette want
  // different sizes and alternating between them on one canvas would
  // reallocate the backing store twice a frame.
  const scratches = new Map();

  function scratchCtx(w, h, key = 'grid') {
    let canvas = scratches.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      scratches.set(key, canvas);
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return canvas.getContext('2d', { willReadFrequently: true });
  }

  function sourceSize(src) {
    const w = src.videoWidth || src.naturalWidth || src.width || 0;
    const h = src.videoHeight || src.naturalHeight || src.height || 0;
    return [w, h];
  }

  // Draws `src` into a w*h context under `fit`, optionally mirrored.
  // Returns false when the source has nothing to draw yet.
  function drawFitted(ctx, src, w, h, fit, mirror) {
    const [sw, sh] = sourceSize(src);
    if (!sw || !sh) return false;

    let dw = w;
    let dh = h;
    if (fit !== 'stretch') {
      // cover fills the grid and loses the overhang; contain keeps the
      // whole frame and leaves bands of state 0, which on a board reads as
      // unlit panel rather than as letterboxing - honest either way, but
      // cover is what a mirror wants.
      const scale = fit === 'contain'
        ? Math.min(w / sw, h / sh)
        : Math.max(w / sw, h / sh);
      dw = sw * scale;
      dh = sh * scale;
    }

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Mirrored by reflecting the canvas rather than by reading the pixels
    // back to front: the flip is free here and the read loop stays a
    // straight walk.
    if (mirror) ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
    return true;
  }

  // Fraction of the darkest and lightest cells autoLevels throws away
  // before stretching. Without a tail, one blown highlight or one black
  // doorway behind the subject sets the whole range and the stretch does
  // nothing.
  const AUTO_TAIL = 0.02;
  // Below this the frame is close to flat - a capped lens, a wall - and
  // stretching it would amplify sensor noise into a full-contrast image of
  // nothing.
  const AUTO_MIN_SPAN = 0.08;

  function autoStretch(lum) {
    const bins = new Uint32Array(64);
    for (let i = 0; i < lum.length; i++) bins[Math.min(63, (lum[i] * 64) | 0)]++;

    const drop = Math.floor(lum.length * AUTO_TAIL);
    let lo = 0;
    let hi = 63;
    for (let acc = 0; lo < 63; lo++) {
      acc += bins[lo];
      if (acc > drop) break;
    }
    for (let acc = 0; hi > 0; hi--) {
      acc += bins[hi];
      if (acc > drop) break;
    }

    const base = lo / 64;
    const span = (hi + 1) / 64 - base;
    if (span < AUTO_MIN_SPAN) return;
    for (let i = 0; i < lum.length; i++) {
      lum[i] = Math.min(1, Math.max(0, (lum[i] - base) / span));
    }
  }

  // Which entry of `pal` a color is closest to, by straight RGB distance.
  // Not a perceptual metric: a proper one (CIEDE2000, or even Lab) would
  // place the boundaries slightly better, and at the sizes a board works
  // at - a handful of colors, a few thousand cells - the difference does
  // not survive the dithering on top of it. Cheap and predictable wins.
  function nearestColor(pal, r, g, b) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const c = pal[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Mean distance from each palette entry to its nearest neighbor - how far
  // apart the available colors are. Ordered dithering needs this: the
  // threshold it adds has to be scaled to the gap it is trying to dither
  // across, or a tight palette gets shredded and a sparse one barely
  // dithers at all.
  function paletteSpread(pal) {
    if (pal.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < pal.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < pal.length; j++) {
        if (i === j) continue;
        const a = pal[i];
        const b = pal[j];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < nearest) nearest = d;
      }
      total += nearest;
    }
    return total / pal.length;
  }

  // The `match` path: every cell to the nearest of a given set of colors,
  // rather than to a step on a brightness ramp. This is what makes a board
  // show a picture in color instead of in shades - and it is a different
  // job from the luminance path, not a variation on it, because "nearest"
  // is now a question about three axes at once and brightness order has
  // stopped meaning anything.
  function matchGrid(px, cols, rows, pal, dither, invert, contrast, brightness) {
    const n = cols * rows;
    const out = new Uint8Array(n);
    // A working copy in RGB, because diffusion writes error back into it.
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      for (let c = 0; c < 3; c++) {
        let v = px[p + c];
        if (invert) v = 255 - v;
        if (contrast !== 1 || brightness !== 0) {
          v = (v - 128) * contrast + 128 + brightness * 255;
        }
        rgb[i * 3 + c] = v;
      }
    }

    if (dither === 'diffusion') {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const k = i * 3;
          const got = nearestColor(pal, rgb[k], rgb[k + 1], rgb[k + 2]);
          out[i] = got;
          const chosen = pal[got];
          for (let c = 0; c < 3; c++) {
            const err = rgb[k + c] - chosen[c];
            if (err === 0) continue;
            if (x + 1 < cols) rgb[k + 3 + c] += err * 0.4375;
            if (y + 1 < rows) {
              const below = (i + cols) * 3 + c;
              if (x > 0) rgb[below - 3] += err * 0.1875;
              rgb[below] += err * 0.3125;
              if (x + 1 < cols) rgb[below + 3] += err * 0.0625;
            }
          }
        }
      }
      return out;
    }

    if (dither === 'none') {
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        out[i] = nearestColor(pal, rgb[k], rgb[k + 1], rgb[k + 2]);
      }
      return out;
    }

    // Ordered: nudge the cell along every axis by the same signed amount
    // before matching, so cells falling between two palette colors land on
    // one or the other in a fixed pattern. Half the spread is the useful
    // amplitude - enough to cross a boundary for a color sitting midway,
    // not so much that a cell sitting squarely on a palette color gets
    // pushed off it.
    const amplitude = paletteSpread(pal) * 0.5;
    for (let y = 0; y < rows; y++) {
      const brow = (y & 3) * 4;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const k = i * 3;
        const m = ((BAYER4[brow + (x & 3)] + 0.5) / 16 - 0.5) * amplitude;
        out[i] = nearestColor(pal, rgb[k] + m, rgb[k + 1] + m, rgb[k + 2] + m);
      }
    }
    return out;
  }

  function imageGrid(source, cols, rows, opts = {}) {
    if (!source || !(cols > 0) || !(rows > 0)) return null;
    const ctx = scratchCtx(cols, rows);
    if (!ctx) return null;
    if (!drawFitted(ctx, source, cols, rows, opts.fit || 'cover', !!opts.mirror)) {
      return null;
    }

    const n = cols * rows;
    const px = ctx.getImageData(0, 0, cols, rows).data;
    const remap = Array.isArray(opts.states) ? opts.states : null;
    const accessor = (out) => (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
      const level = out[y * cols + x];
      return remap ? (remap[level] == null ? null : remap[level]) : level;
    };

    // Color matching takes over entirely when `match` is given: there is no
    // brightness ramp left to apply levels or autoLevels to.
    if (Array.isArray(opts.match) && opts.match.length >= 2) {
      return accessor(matchGrid(
        px, cols, rows,
        opts.match.map((c) => parseColor(typeof c === 'string' ? c : (c && c.fill) || '#000')),
        DITHERS[opts.dither] || DITHERS.ordered,
        !!opts.invert,
        opts.contrast == null ? 1 : opts.contrast,
        opts.brightness == null ? 0 : opts.brightness,
      ));
    }

    const lum = new Float32Array(n);
    // Rec. 709 luminance - green weighted far above blue because that is
    // how brightness is actually perceived, and a plain channel average
    // turns a blue shirt into a light gray one.
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      lum[i] = (px[p] * 0.2126 + px[p + 1] * 0.7152 + px[p + 2] * 0.0722) / 255;
    }

    if (opts.autoLevels) autoStretch(lum);

    const contrast = opts.contrast == null ? 1 : opts.contrast;
    const brightness = opts.brightness == null ? 0 : opts.brightness;
    if (contrast !== 1 || brightness !== 0) {
      // Contrast pivots on mid gray so it opens and closes the range
      // rather than also darkening it.
      for (let i = 0; i < n; i++) {
        const v = (lum[i] - 0.5) * contrast + 0.5 + brightness;
        lum[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
    if (opts.invert) for (let i = 0; i < n; i++) lum[i] = 1 - lum[i];

    const levels = Math.max(2, Math.round(opts.levels == null ? 2 : opts.levels));
    const top = levels - 1;
    const out = new Uint8Array(n);
    const dither = DITHERS[opts.dither] || DITHERS.ordered;

    if (dither === 'diffusion') {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const want = lum[i] * top;
          const got = Math.max(0, Math.min(top, Math.round(want)));
          out[i] = got;
          // The error is carried in luminance units, not state units, so
          // it means the same thing at two levels as at sixteen.
          const err = (want - got) / top;
          if (err !== 0) {
            if (x + 1 < cols) lum[i + 1] += err * 0.4375;
            if (y + 1 < rows) {
              if (x > 0) lum[i + cols - 1] += err * 0.1875;
              lum[i + cols] += err * 0.3125;
              if (x + 1 < cols) lum[i + cols + 1] += err * 0.0625;
            }
          }
        }
      }
    } else if (dither === 'none') {
      for (let i = 0; i < n; i++) {
        out[i] = Math.max(0, Math.min(top, Math.round(lum[i] * top)));
      }
    } else {
      for (let y = 0; y < rows; y++) {
        const brow = (y & 3) * 4;
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          // The matrix cell as a threshold inside one state's worth of
          // gray: a cell sitting a third of the way between two states
          // turns on in the third of the pattern whose threshold it clears.
          const m = (BAYER4[brow + (x & 3)] + 0.5) / 16;
          out[i] = Math.max(0, Math.min(top, Math.floor(lum[i] * top + m)));
        }
      }
    }

    return accessor(out);
  }

  // How many iterations the clustering below gets. Six is past where the
  // centers stop visibly moving on photographic input, and the cost is
  // linear in it.
  const KMEANS_ITERATIONS = 6;

  // The colors actually in an image, as a palette to hand straight to
  // `palette` - and then to `imageGrid`'s `match`, which is the pair that
  // makes a board show a picture in its own colors rather than in shades
  // of someone else's.
  //
  // k-means over a downsampled frame. The one thing worth knowing is the
  // initialization, because on a sequence it matters more than the
  // algorithm: seeded from the previous palette when one is passed, and
  // otherwise from evenly spaced points along the frame's own brightness
  // order. Never from random points. Random seeding converges somewhere
  // just as good, but somewhere *different* each call - and a palette that
  // jumps between two equally good answers every second is a board that
  // changes color for no reason the viewer can see.
  function imagePalette(source, count = 4, opts = {}) {
    const k = Math.max(2, Math.min(16, Math.round(count)));
    const w = Math.max(8, Math.round(opts.sample || 48));
    const h = Math.max(6, Math.round(w * 0.75));
    const ctx = scratchCtx(w, h, 'palette');
    if (!ctx || !source) return null;
    if (!drawFitted(ctx, source, w, h, opts.fit || 'cover', !!opts.mirror)) return null;

    const px = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const luma = (i) => px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722;

    const centers = [];
    const seed = Array.isArray(opts.seed) && opts.seed.length === k ? opts.seed : null;
    if (seed) {
      seed.forEach((c) => centers.push(parseColor(typeof c === 'string' ? c : (c && c.fill) || '#000')));
    } else {
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => luma(a) - luma(b));
      for (let c = 0; c < k; c++) {
        const i = order[Math.min(n - 1, Math.floor(((c + 0.5) / k) * n))];
        centers.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
      }
    }

    const sums = new Float64Array(k * 3);
    const counts = new Uint32Array(k);
    for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
      sums.fill(0);
      counts.fill(0);
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const c = nearestColor(centers, px[p], px[p + 1], px[p + 2]);
        sums[c * 3] += px[p];
        sums[c * 3 + 1] += px[p + 1];
        sums[c * 3 + 2] += px[p + 2];
        counts[c]++;
      }
      for (let c = 0; c < k; c++) {
        // An empty cluster keeps where it was rather than being re-seeded
        // somewhere new: a color nothing in this frame is near is usually
        // a color something in the next frame will be, and moving it would
        // be the same jump that random seeding causes.
        if (!counts[c]) continue;
        centers[c] = [
          sums[c * 3] / counts[c],
          sums[c * 3 + 1] / counts[c],
          sums[c * 3 + 2] / counts[c],
        ];
      }
    }

    const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    const toHex = (c) => `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;

    // Order is not cosmetic here, and this is the subtle half of keeping a
    // sequence stable.
    //
    // A palette index IS a dot's state. Reorder the palette and every dot
    // on the board is silently reassigned to a different color without one
    // of them being asked to flip - and worse, the NEXT frame then matches
    // those cells to the new arrangement and flips them all at once. Two
    // clusters of nearly equal brightness - a mid brown and a mid teal, say
    // - will trade places under a luminance sort on nothing more than
    // sensor noise, so sorting every call makes a board that is holding
    // perfectly still flicker once a second for no reason the scene gave
    // it. Seeding the clustering does not help: it preserves which cluster
    // is which, and then the sort throws that away again.
    //
    // So the sort happens only when there is no previous answer to stay
    // consistent with. A seeded call hands back its clusters in the seed's
    // own order, which is the order the first unseeded call sorted them
    // into - approximately dark to light, and more importantly the same
    // order as last time.
    if (seed) return centers.map(toHex);

    // Dark to light, so a first result is a drop-in `palette`: every other
    // part of this component reads a palette as a brightness ramp, and a
    // host that switches `match` back off should get something sane rather
    // than a scrambled one.
    return centers
      .slice()
      .sort((a, b) => (a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722)
        - (b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722))
      .map(toHex);
  }

  // ---------------------------------------------------------------------
  // Color
  // ---------------------------------------------------------------------
  function parseColor(input) {
    if (typeof input !== 'string') return [0, 0, 0];
    const s = input.trim();
    if (s[0] === '#') {
      const h = s.slice(1);
      if (h.length === 3) {
        return [h[0] + h[0], h[1] + h[1], h[2] + h[2]].map((p) => parseInt(p, 16));
      }
      return [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((p) => parseInt(p, 16));
    }
    const nums = s.match(/[\d.]+/g);
    if (nums && nums.length >= 3) return nums.slice(0, 3).map(Number);
    return [0, 0, 0];
  }

  function mixToward(rgb, target, amount) {
    return [
      Math.round(rgb[0] + (target[0] - rgb[0]) * amount),
      Math.round(rgb[1] + (target[1] - rgb[1]) * amount),
      Math.round(rgb[2] + (target[2] - rgb[2]) * amount),
    ];
  }

  // ---------------------------------------------------------------------
  // Sound
  //
  // A single dot's click is easy. The problem is a wave: six thousand dots
  // flipping across half a second is six thousand clicks, which is not a
  // clatter but white noise, and six thousand voices the audio thread can't
  // schedule anyway. So clicks are collected per short window and collapsed
  // into a handful of voices whose loudness grows with the square root of
  // how many flips they stand for - which is roughly how a crowd of
  // uncorrelated clicks actually sums, and is the difference between a
  // board that sounds mechanical and one that hisses.
  //
  // The window's voices are panned toward where its flips happened, so a
  // wipe audibly crosses the board.
  // ---------------------------------------------------------------------
  const CLICK_WINDOW_MS = 12;
  const MAX_VOICES_PER_WINDOW = 4;

  function createClicker(getVolume) {
    let ctx = null;
    let noise = null;
    let pending = 0;
    let panSum = 0;
    let flushTimer = null;

    // One short buffer of white noise, reused by every voice. Generating it
    // per click would be the single most expensive thing this file does.
    function ensureContext() {
      if (ctx) return ctx;
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      const frames = Math.ceil(ctx.sampleRate * 0.05);
      noise = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      return ctx;
    }

    function voice(gain, pan) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;

      // Bandpass around the ~2.5kHz tick of a small plastic disc hitting a
      // stop. The spread per voice is what keeps a group of them from
      // phasing into one tone.
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1700 + Math.random() * 1600;
      band.Q.value = 1.1 + Math.random() * 0.8;

      // A touch of body under the tick, so it reads as a solid object
      // rather than a hiss.
      const body = ctx.createBiquadFilter();
      body.type = 'lowpass';
      body.frequency.value = 5200;

      const amp = ctx.createGain();
      const t = ctx.currentTime;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(gain, t + 0.001);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.028 + Math.random() * 0.016);

      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan));

      src.connect(band).connect(body).connect(amp);
      if (panner) amp.connect(panner).connect(ctx.destination);
      else amp.connect(ctx.destination);

      src.start(t);
      src.stop(t + 0.09);
    }

    function flush() {
      flushTimer = null;
      const n = pending;
      const pan = n > 0 ? panSum / n : 0;
      pending = 0;
      panSum = 0;
      if (!n || !ctx || ctx.state !== 'running') return;

      const volume = getVolume();
      if (volume <= 0) return;

      const voices = Math.max(1, Math.min(MAX_VOICES_PER_WINDOW, Math.round(Math.sqrt(n))));
      // sqrt(n) summing, held at a ceiling so a full-board flip is loud but
      // not a clipped wall, then split across the voices actually firing.
      const total = volume * 0.12 * Math.min(4.5, Math.sqrt(n));
      for (let i = 0; i < voices; i++) {
        voice(total / voices, pan + (Math.random() * 0.5 - 0.25));
      }
    }

    return {
      // Audio can only start from a gesture, so this is a no-op until the
      // page has had one; arm() is wired to the first pointer/key event.
      arm() {
        const c = ensureContext();
        if (c && c.state === 'suspended') c.resume();
        return !!c;
      },
      click(panPosition) {
        if (!ctx || ctx.state !== 'running') return;
        pending++;
        panSum += panPosition;
        if (flushTimer === null) flushTimer = setTimeout(flush, CLICK_WINDOW_MS);
      },
      destroy() {
        if (flushTimer !== null) clearTimeout(flushTimer);
        flushTimer = null;
        if (ctx && ctx.close) ctx.close();
        ctx = null;
      },
    };
  }

  // Proper modulo - JS's remainder keeps the sign of the dividend, and every
  // "which face is showing" question here wants the non-negative answer.
  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  // ---------------------------------------------------------------------
  // The spring, in two numbers
  //
  // `bounce` becomes a damping ratio, which is what decides the SHAPE of
  // the motion - whether the disc glides to its stop or slams and rattles.
  // `flipDuration` becomes a spring constant, which does nothing to that
  // shape and only scales the time axis. That separation is exact rather
  // than approximate: write the spring in units of w0*t and the trajectory
  // depends on the damping ratio alone, so two dots with the same bounce
  // and different durations trace the identical curve at different speeds.
  // It survives the magnet stop too, since that triggers on a position
  // threshold and rebounds by a plain multiplier - neither cares how fast
  // the clock is running.
  //
  // Which is why there is no third knob here, and why a control panel
  // offering both a duration and a stiffness would be lying: there are two
  // degrees of freedom, and stiffness is simply duration in other units.
  // ---------------------------------------------------------------------
  // Shared stand-in for "no per-dot overrides", so the common path neither
  // allocates an options object nor has to null-check before every lookup.
  const EMPTY = {};

  function dampingRatio(bounce) {
    return 1 - Math.min(1, Math.max(0, bounce)) * 0.68;
  }

  // Ceiling on the spring constant, set by the integrator rather than by
  // taste. The loop steps at SUB_STEP with an explicit method, which stays
  // stable only while the step is small against the spring's own period;
  // past roughly w0 * SUB_STEP = 0.25 it starts gaining energy instead of
  // losing it, and a dot will sail through its stop and settle showing the
  // wrong face. 5600 keeps w0 under 75, which covers every flip time down
  // to about 38ms - comfortably past the point where a flip reads as
  // instant anyway.
  //
  // It applies to a `stiffness` the host set directly as much as to one
  // mapped from `flipDuration` (see clampStiffness, and the two places that
  // read `options.stiffness`): the number is a request for a spring, and
  // past this one there is no spring to give - only an integrator coming
  // apart. A flip that is already past instant is the honest answer.
  const MAX_STIFFNESS = 5600;

  function clampStiffness(k) {
    return Math.min(MAX_STIFFNESS, k);
  }

  // Spring constant that puts a dot at its stop after `ms`. This is the
  // standard rise time of an underdamped second-order step response,
  // t = (PI - acos(z)) / (w0 * sqrt(1 - z*z)), solved for w0 - exact, not a
  // fitted curve: measured against the real integrator it tracks the
  // requested time to within a millisecond from 60ms to 500ms.
  //
  // Both clamps below guard the same end of the range. As damping
  // approaches critical the spring barely crosses its target at all, so the
  // constant needed to "arrive" by a deadline runs away to infinity - at
  // bounce 0 and 150ms the raw formula asks for 213,000, which is twenty
  // times past what the integrator can hold together. Capping the damping
  // used *for the mapping* at 0.95 keeps the answer sane while the
  // integration itself still runs at the true ratio, so bounce 0 remains
  // genuinely critically damped. The honest cost: at very low bounce a
  // requested flip time is a request, and the dot may take a little longer.
  function stiffnessFor(ms, zeta) {
    const t = Math.max(0.001, ms / 1000);
    const z = Math.min(0.95, Math.max(0, zeta));
    const w0 = (Math.PI - Math.acos(z)) / (t * Math.sqrt(1 - z * z));
    return clampStiffness(w0 * w0);
  }

  // Roughly when the ringing falls below the threshold _tick settles at:
  // the decay envelope is e^(-zeta*w0*t), so this is where that reaches the
  // settle tolerance. An estimate rather than a measurement - the magnet
  // rebound isn't in it, and that rebound bleeds off energy the envelope
  // doesn't know about, so the answer runs a little long: at the defaults
  // it calls ~470ms where the real integrator takes ~450. The right way
  // round to be wrong, and the only honest way to show a number that
  // nothing in the options sets directly.
  function settleMsFor(k, zeta) {
    const decay = Math.max(0.0001, zeta * Math.sqrt(k));
    return (6.5 / decay) * 1000;
  }

  // Fisher-Yates over the changing cells, returned as cell index -> position
  // in the shuffled order. Every cell gets a distinct position, which is the
  // whole point: it is what separates "in a random order" from "each at a
  // random time". See the `random` transition.
  function shuffledRanks(cells) {
    const order = cells.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    const map = new Map();
    for (let rank = 0; rank < order.length; rank++) map.set(order[rank], rank);
    return map;
  }

  class FlipDots {
    constructor(el, options = {}) {
      if (!el) throw new Error('FlipDots: element is required');
      injectStyles();
      this.el = el;
      this.options = { ...DEFAULTS, ...options };

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'flip-dots__canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      // First child and behind everything, rather than appended on top:
      // the board is a surface as much as it is a display, and a host
      // should be able to put a headline on one without the dots covering
      // it. An element with no children is unaffected either way.
      this.el.insertBefore(this.canvas, this.el.firstChild);
      this.ctx = this.canvas.getContext('2d');

      this._reducedQuery = global.matchMedia
        ? global.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

      // Indices mid-flight (including ones still waiting out a delay). The
      // render loop exists only while this is non-empty, so a board at rest
      // costs nothing at all.
      this._active = new Set();
      this._elapsed = 0;
      this._lastNow = 0;
      this._raf = null;
      this._onScreen = true;
      this._shadeCache = new Map();
      this._edge = null;
      this._movedSinceSettle = false;
      // The running sequence, or null. See the playback section below.
      this._playback = null;

      this._clicker = createClicker(() => (this.options.sound ? this.options.volume : 0));
      this._armSound = this._armSound.bind(this);
      if (this.options.sound) this._listenForGesture();

      this._tick = this._tick.bind(this);
      this._playTick = this._playTick.bind(this);
      this._resize = this._resize.bind(this);
      this._onReducedChange = this._onReducedChange.bind(this);
      if (this._reducedQuery && this._reducedQuery.addEventListener) {
        this._reducedQuery.addEventListener('change', this._onReducedChange);
      }

      this._syncHinge();
      this._syncSpring();

      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.el);

      // Same reasoning as the canvas backgrounds here: requestAnimationFrame
      // pauses itself for a hidden tab but not for an element that has
      // merely scrolled past. Coming back snaps every dot to where it was
      // headed rather than replaying a queue of stale delays.
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (on) this._start();
        else {
          this._stop();
          this._settleAll();
        }
        // A sequence is held across the same boundary, and for a stronger
        // reason than the render loop: a board playing a camera off screen
        // is a camera being read for nobody.
        this._syncPlayClock();
      }, { rootMargin: '150px' });
      this._intersectionObserver.observe(this.el);

      this._measure();
    }

    get reduced() {
      return !!(this._reducedQuery && this._reducedQuery.matches);
    }

    get length() {
      return this.cols * this.rows;
    }

    // The grid the component actually settled on, in px. `cols`/`rows`/
    // `dotSize` are requests measured against the element's box and clamped
    // by MIN_DOT_PX, so these are the answers - worth reading back rather
    // than echoing what was asked for.
    get dotPx() {
      return this._dot;
    }

    get pitchPx() {
      return this._pitch;
    }

    // ---- geometry ----------------------------------------------------

    // Lays out the grid for the element's current size and (re)allocates the
    // dot arrays. Square cells always: a non-square dot grid reads as a
    // stretched image rather than as a board, and every transition's
    // distance math quietly assumes a square cell too.
    //
    // Existing content is resampled nearest-neighbor rather than cleared, so
    // a resize - or a grid-size change from a control - keeps showing
    // whatever was on the board instead of blanking it.
    _measure() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this._dpr = dpr;
      const w = Math.max(1, this.el.clientWidth);
      const h = Math.max(1, this.el.clientHeight);
      this._w = w;
      this._h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      // The CSS size has to be set explicitly, not left to `inset: 0`. A
      // canvas is a replaced element, so with `width: auto` it takes its
      // intrinsic size - the backing store above, which is `dpr` times too
      // big - instead of stretching to the box the way a plain div would.
      // Left to the stylesheet, everything draws at double scale on a 2x
      // display and the overflow is simply clipped away.
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { cols, rows, dotSize, gap } = this.options;
      const fill = Math.max(0.05, 1 - Math.min(0.9, gap));

      let c;
      let r;
      if (cols > 0 && rows > 0) {
        c = Math.round(cols);
        r = Math.round(rows);
      } else if (cols > 0) {
        c = Math.round(cols);
        r = Math.max(1, Math.round(h / (w / c)));
      } else {
        const pitch = Math.max(1, dotSize) / fill;
        c = Math.max(1, Math.round(w / pitch));
        r = Math.max(1, Math.round(h / pitch));
      }

      // Honor MIN_DOT_PX by thinning the grid rather than by drawing dots
      // too small to read. Scaling both axes by the same factor keeps the
      // aspect the caller asked for.
      // Dot size scales inversely with the column count, so to lift a dot
      // from `asked` up to MIN_DOT_PX the grid has to shrink by exactly
      // asked/MIN - and flooring that lands at or just under it, which is
      // the safe side. (A square root here looks plausible and is wrong:
      // the root of a fraction is larger than the fraction, so it thins the
      // grid by less than is needed and leaves the dots still too small.)
      const pitchFor = (cc, rr) => Math.min(w / cc, h / rr);
      const asked = pitchFor(c, r) * fill;
      if (asked < MIN_DOT_PX) {
        const scale = asked / MIN_DOT_PX;
        c = Math.max(1, Math.floor(c * scale));
        r = Math.max(1, Math.floor(r * scale));
      }

      const prev = this._state ? { cols: this.cols, rows: this.rows, state: this._state } : null;

      this.cols = c;
      this.rows = r;
      this._pitch = pitchFor(c, r);
      this._dot = this._pitch * fill;
      // Centered in the box: the grid keeps square cells, so unless the
      // element's aspect happens to match the grid's there is slack on one
      // axis, and splitting it looks deliberate where pinning it to a corner
      // looks like a bug.
      this._originX = (w - this._pitch * c) / 2;
      this._originY = (h - this._pitch * r) / 2;
      // How far a leaning disc may stray from its cell's center: half the
      // gap, so it reaches the cell's edge and no further. This is what
      // lets a repaint clear exactly one cell - see _paintCell. A board
      // with no gap has no room to lean, which is the honest answer anyway,
      // since a disc leaning into a neighbor it is already touching would
      // read as overlap rather than as depth.
      this._leanMax = (this._pitch - this._dot) / 2;

      this._allocate();
      if (prev) this._resample(prev);
      this._paintAll();
    }

    _allocate() {
      const n = this.cols * this.rows;
      this._state = new Uint8Array(n);      // what each dot is showing//heading to
      this._turn = new Float64Array(n);     // continuous position, in half turns
      this._target = new Float64Array(n);   // the half turn it is springing to
      this._vel = new Float64Array(n);
      this._faceEven = new Uint8Array(n);   // state painted on even half turns
      this._faceOdd = new Uint8Array(n);    // ...and on odd ones
      this._delay = new Float64Array(n);    // absolute time this dot may start
      this._wob = new Float32Array(n);      // per-dot spring-rate variation
      // The spring each dot is actually running, resolved once when it is
      // asked to flip rather than recomputed every frame for every dot.
      // This is what makes per-dot timing free: the loop was already doing
      // a per-dot multiply for jitter, and now it just reads the answer.
      this._k = new Float32Array(n);
      this._c = new Float32Array(n);
      this._silent = new Uint8Array(n);     // suppress this dot's click
      this._active.clear();

      const jitter = this.options.jitter;
      const base = this._baseSpring();
      for (let i = 0; i < n; i++) {
        this._wob[i] = 1 + (Math.random() * 2 - 1) * jitter * 0.35;
        this._k[i] = base.k * this._wob[i];
        this._c[i] = 2 * base.zeta * Math.sqrt(this._k[i]);
      }
    }

    // The spring the board's own options describe, before any per-dot
    // override. `stiffness` wins when the host set it, since a host that
    // states a force has opted out of stating a time. Cached rather than
    // recomputed per request: an acos and a square root per dot of a
    // board-wide update would be real work for an answer that only changes
    // when update() is called.
    _syncSpring() {
      this._springZeta = dampingRatio(this.options.bounce);
      this._springK = this.options.stiffness != null
        ? clampStiffness(this.options.stiffness)
        : stiffnessFor(this.options.flipDuration, this._springZeta);
    }

    _baseSpring() {
      return { k: this._springK, zeta: this._springZeta };
    }

    // The effective spring constant, after resolving flipDuration. Read-only
    // and derived - `options.stiffness` is the override, this is the answer.
    get springConstant() {
      return this._baseSpring().k;
    }

    // Roughly how long a flip takes to stop ringing, as opposed to
    // `flipDuration`, which is how long it takes to arrive.
    get settleMs() {
      const { k, zeta } = this._baseSpring();
      return settleMsFor(k, zeta);
    }

    // Nearest-neighbor resample of the previous grid onto the new one. Dots
    // land settled and flat rather than animating into place: a resize is
    // not an update to the content, and treating it as one would fire a
    // board-wide flip (and a board-wide clatter) every frame of a window
    // drag.
    _resample(prev) {
      for (let y = 0; y < this.rows; y++) {
        const sy = Math.min(prev.rows - 1, Math.floor((y / this.rows) * prev.rows));
        for (let x = 0; x < this.cols; x++) {
          const sx = Math.min(prev.cols - 1, Math.floor((x / this.cols) * prev.cols));
          const s = prev.state[sy * prev.cols + sx];
          const i = y * this.cols + x;
          this._state[i] = s;
          this._faceEven[i] = s;
          this._faceOdd[i] = s;
        }
      }
    }

    // ---- state -------------------------------------------------------

    // The core move. `turn` is continuous and unbounded-ish, `target` is the
    // flat position it springs to, and which face you see is decided by the
    // parity of the nearest flat position - so painting the *other* parity's
    // face is always invisible, and that is what makes an arbitrary palette
    // work on a two-sided disc.
    //
    // Mid-flight re-requests are the case worth following. A dot still short
    // of edge-on has not revealed its destination face yet, so a new state
    // just overwrites it and the dot carries on with its momentum intact.
    // Past edge-on the destination is already showing, so it has to turn
    // again - and if the new state is what it was *leaving*, it springs back
    // the way it came rather than continuing round, which is both shorter and
    // what a real disc being yanked back would do.
    // `opts` carries the per-dot overrides - `flipDuration`, `bounce`,
    // `stiffness`, `direction`, `silent`. The same object is reused across
    // every dot of a setGrid rather than built per cell, so a board-wide
    // update allocates nothing here.
    _request(i, state, startAt, opts = EMPTY) {
      const n = this.options.palette.length;
      const s = Math.max(0, Math.min(n - 1, Math.round(state)));
      this._state[i] = s;

      // Where it will come to rest, and what face that will be showing.
      const aimedAt = Math.round(this._target[i]);
      const aimed = mod(aimedAt, 2) === 0 ? this._faceEven[i] : this._faceOdd[i];
      // Settled on it already, or on its way there - either way there is
      // nothing to do, and re-requesting must not restart the flip.
      if (aimed === s) return;

      const here = Math.round(this._turn[i]);
      const shown = mod(here, 2) === 0 ? this._faceEven[i] : this._faceOdd[i];
      if (shown === s) {
        // What was asked for is what is on screen, so the dot is mid-flight
        // away from it: spring back to the flat position it came from rather
        // than carrying on round to meet it again.
        this._target[i] = here;
      } else {
        // A forced direction beats the state comparison, which is what lets
        // a caller turn a whole wave the same way over a palette that has no
        // natural order for "up" to mean anything against.
        const dir = opts.direction != null
          ? (opts.direction < 0 ? -1 : 1)
          : (this.options.directional ? (s > shown ? 1 : -1) : 1);
        const t = here + dir;
        this._target[i] = t;
        if (mod(t, 2) === 0) this._faceEven[i] = s;
        else this._faceOdd[i] = s;
      }

      // Resolve this dot's spring once, here, rather than per frame. Jitter
      // still rides on top of a caller's own duration: it is the mechanical
      // slop of one physical disc, not a property of the instruction.
      const zeta = opts.bounce != null ? dampingRatio(opts.bounce) : this._springZeta;
      let k;
      if (opts.stiffness != null) k = clampStiffness(opts.stiffness);
      else if (opts.flipDuration != null) k = stiffnessFor(opts.flipDuration, zeta);
      else if (opts.bounce != null) k = stiffnessFor(this.options.flipDuration, zeta);
      else k = this._springK;
      this._k[i] = k * this._wob[i];
      this._c[i] = 2 * zeta * Math.sqrt(this._k[i]);
      this._silent[i] = opts.silent ? 1 : 0;

      this._delay[i] = startAt || 0;
      this._active.add(i);
      this._movedSinceSettle = true;
      if (this.reduced) this._settle(i);
      else this._start();
    }

    // Writes one dot. Bare, it lands now - an individual poke should.
    //
    // `opts` is the whole per-dot vocabulary, and it is deliberately the
    // same questions a transition answers for a board at once:
    //
    //   delay         ms before this dot starts
    //   flipDuration  ms for this dot's own half turn
    //   stiffness     the same, in spring units, if you prefer
    //   bounce        how hard this dot rings against its stop
    //   direction     1 or -1, forcing which way it turns
    //   silent        no click from this one
    //
    // With these, hand-rolled choreography is not a lesser path than a
    // transition - a transition is just a convenient way to generate
    // `delay` for every dot at once.
    set(x, y, state, opts = EMPTY) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return this;
      const at = opts.delay ? this._elapsed + opts.delay / 1000 : 0;
      this._request(y * this.cols + x, state, at, opts);
      return this;
    }

    // Whether everything has come to rest. False while any dot is moving or
    // still waiting out a delay.
    get settled() {
      return this._active.size === 0;
    }

    // Whether this particular dot is mid-flight (or waiting to start).
    isAnimating(x, y) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
      return this._active.has(y * this.cols + x);
    }

    // Drops everything onto its target immediately, with no travel. For
    // cutting an update short - a visitor who navigated away from what the
    // board was mid-way through saying should not have to watch it finish.
    settle() {
      if (this.settled) return this;
      this._stop();
      this._settleAll();
      this._announceSettle();
      return this;
    }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
      return this._state[y * this.cols + x];
    }

    // Writes the whole board, choreographed. `data` is a 2D array, a flat
    // array, or an array of strings read through `charMap` - the string form
    // being there because a pattern someone typed by hand is the common
    // case, and `['..##..', '.####.']` is readable where nested arrays of
    // integers are not.
    setGrid(data, opts = {}) {
      const grid = this._normalize(data, opts.charMap);
      if (!grid) return this;

      const spec = 'transition' in opts ? opts.transition : this.options.transition;
      const fn = resolveTransition(spec);
      const ease = resolveEasing('easing' in opts ? opts.easing : this.options.easing);
      const duration = ('duration' in opts ? opts.duration : this.options.duration) / 1000;

      // First pass works out which dots are actually changing, before any
      // of them are told to. Only the changing ones are choreographed - a
      // dot already showing what it was asked for does not flip, so letting
      // it take up a slot in the order would leave visible dead air where
      // its turn came round and nothing happened. It also means a
      // transition can be asked questions about the set as a whole, which
      // is what `random` needs and could not have under a single pass.
      const cells = [];
      const targets = [];
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          const next = grid(x, y);
          if (next === null || next === undefined) continue;
          const i = y * this.cols + x;
          if (this._state[i] === next && !this._active.has(i)) continue;
          cells.push(i);
          targets.push(next);
        }
      }
      if (cells.length === 0) return this;

      const ctx = {
        cols: this.cols,
        rows: this.rows,
        // A shuffled update picks its wipe direction too - a shuffle that
        // always wiped the same way would give itself away immediately.
        direction: opts.direction
          || (spec === 'shuffle'
            ? WIPE_DIRECTIONS[Math.floor(Math.random() * WIPE_DIRECTIONS.length)]
            : 'left'),
        origin: opts.origin || null,
        // How many dots this update actually touches.
        count: cells.length,
      };

      // A dot's place in a random permutation of the changing dots, 0..1.
      // Built on first use and not before: shuffling and mapping thousands
      // of cells is real work, and all but one of the transitions here
      // never ask.
      let ranks = null;
      ctx.rank = (x, y) => {
        if (!ranks) ranks = shuffledRanks(cells);
        return cells.length < 2 ? 0 : ranks.get(y * this.cols + x) / (cells.length - 1);
      };

      const now = this._elapsed;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const x = i % this.cols;
        const y = (i - x) / this.cols;
        // Clamped before easing, because an easing is only defined over
        // 0..1 and some of them turn non-monotonic outside it - which
        // would have a dot further along the order start *earlier* than
        // one behind it, and the wave visibly fold back on itself.
        const place = Math.max(0, Math.min(1, fn(x, y, ctx)));
        // `opts` doubles as the per-dot override bag - flipDuration, bounce,
        // direction and silent mean the same here as they do on set(), and
        // apply to every dot of this update. Note `duration` is the spread
        // and `flipDuration` is one dot's own turn: the two are independent,
        // which is what lets a slow wave be made of fast flips.
        this._request(i, targets[k], now + ease(place) * duration, opts);
      }
      return this;
    }

    // Returns an (x, y) => state accessor for whatever shape the caller
    // passed, so setGrid's loop doesn't branch per dot. Out-of-range cells
    // answer null, which setGrid reads as "leave this one alone" - a 5x5
    // pattern written to a 40x24 board changes 25 dots and nothing else.
    _normalize(data, charMap) {
      if (typeof data === 'function') return data;
      // A typed array is the flat row-major form. Worth accepting
      // alongside a plain array because it is what `snapshot()` hands
      // back - so a saved frame goes straight back on the board - and
      // because a clip of frames wants to be one byte per dot rather than
      // one boxed number. DataView is the one view that isn't indexable,
      // and BYTES_PER_ELEMENT is what tells it apart.
      const typed = ArrayBuffer.isView(data) && !!data.BYTES_PER_ELEMENT;
      if (!typed && !Array.isArray(data)) return null;
      if (data.length === 0) return null;

      if (!typed && typeof data[0] === 'string') {
        const map = charMap || null;
        return (x, y) => {
          const row = data[y];
          if (typeof row !== 'string' || x >= row.length) return null;
          const ch = row[x];
          if (map) return ch in map ? map[ch] : null;
          // With no charMap, a digit is its own state index and anything
          // else is state 0 - enough for the common two- and three-color
          // pattern without making the caller write a map for it.
          const d = ch.charCodeAt(0) - 48;
          return d >= 0 && d <= 9 ? d : 0;
        };
      }

      if (!typed && Array.isArray(data[0])) {
        return (x, y) => {
          const row = data[y];
          if (!row || x >= row.length) return null;
          return row[x];
        };
      }

      // Flat array, row-major.
      return (x, y) => {
        const i = y * this.cols + x;
        return i < data.length ? data[i] : null;
      };
    }

    // Writes a line of text across the whole board - lit dots for the
    // glyphs, `off` everywhere else - centered unless `x`/`y` say otherwise.
    // Goes through setGrid, so it takes a transition and an easing like any
    // other whole-board update, which is what makes a message arrive on a
    // wipe instead of simply being there.
    text(str, opts = {}) {
      return this.setGrid(textGrid(str, this.cols, this.rows, opts), opts);
    }

    // How wide a string would be, in dots, at this board's font. For
    // deciding whether a message fits before committing to it.
    measureText(str, opts = {}) {
      const spacing = opts.spacing == null ? 1 : opts.spacing;
      const n = String(str).length;
      return n ? n * FONT_W + (n - 1) * spacing : 0;
    }

    // Partial writes. Each returns null outside its own area, which setGrid
    // reads as "leave this one alone" - so a rect or a row is choreographed
    // among its own dots and the rest of the board is untouched rather than
    // being rewritten with what it already had.
    rect(x, y, w, h, state, opts) {
      return this.setGrid(
        (cx, cy) => (cx >= x && cx < x + w && cy >= y && cy < y + h ? state : null),
        opts,
      );
    }

    // `states` is an array across the line, or a single state for all of it.
    row(y, states, opts) {
      const at = Array.isArray(states) ? (x) => (x < states.length ? states[x] : null) : () => states;
      return this.setGrid((cx, cy) => (cy === y ? at(cx) : null), opts);
    }

    col(x, states, opts) {
      const at = Array.isArray(states) ? (y) => (y < states.length ? states[y] : null) : () => states;
      return this.setGrid((cx, cy) => (cx === x ? at(cy) : null), opts);
    }

    fill(state, opts) {
      return this.setGrid(() => state, opts);
    }

    clear(opts) {
      return this.fill(0, opts);
    }

    randomize(opts) {
      const n = this.options.palette.length;
      return this.setGrid(() => Math.floor(Math.random() * n), opts);
    }

    // A copy of what is on the board, row-major. Handy for saving a frame,
    // and for diffing in tests.
    snapshot() {
      return this._state.slice();
    }

    // Grid coordinates of the dot under a client-space point (a pointer
    // event's clientX/clientY), or null if the point missed - including the
    // slack around a centered grid, which is background rather than a dot.
    // Here rather than in page code because the pitch and the centering
    // offset are this instance's business, and every hover/paint/ripple-from
    // -here interaction needs exactly this answer.
    dotAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left - this._originX) / this._pitch);
      const y = Math.floor((clientY - rect.top - this._originY) / this._pitch);
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
      return [x, y];
    }

    // ---- playback ----------------------------------------------------
    //
    // A board showing a sequence rather than a state. There are exactly two
    // halves to this - a source of frames and a clock - and keeping them
    // apart is why one method covers both a canned clip and a live feed.
    //
    //   an array     one entry per frame, each anything setGrid takes.
    //                A clip: known length, loops by default.
    //   a function   (frame, board) => content. Open-ended, and the
    //                interesting one: a camera, a simulation, a game of
    //                life, a progress bar reading a real number. Return
    //                null and the board holds what it is already showing,
    //                so a source with nothing new to say costs nothing.
    //
    // Frames are dropped, never queued. A board is a physical display with
    // a real refresh limit - one half turn per dot per `flipDuration` - and
    // a queue would let a source that outruns it push the board further and
    // further behind the thing it is supposed to be mirroring. Falling
    // behind by a frame is a dropped frame; falling behind by a hundred is
    // a different display entirely.
    //
    // What playback is NOT is a mode. Nothing here locks the board: set(),
    // setGrid() and text() all still write, and the next frame simply
    // writes over them. A board can be played and poked at the same time.
    //
    // One thing this deliberately does NOT do is stop for
    // prefers-reduced-motion, and it is the one place in the component
    // where the setting is the host's call rather than ours. Everywhere
    // else "reduce motion" has an unambiguous answer - the dot arrives
    // without the flip - but a sequence has no still to fall back to that
    // the component could pick. A board autoplaying a decorative loop
    // should not run at all; a board a visitor started to look at their own
    // camera plainly should. The component cannot tell those apart, so it
    // reads `reduced` for the flip and leaves the clock to the caller. Both
    // sides of that choice are on this site: see home.js for the loop that
    // opts out, and mirror/mirror.js for the one that doesn't.
    play(source, opts = {}) {
      const list = Array.isArray(source) ? source : null;
      if (!list && typeof source !== 'function') return this;
      if (list && list.length === 0) return this;

      // A second play() replaces the first rather than layering on it -
      // two clocks writing the same board is never what was meant.
      this._stopPlayClock();
      const start = Math.max(0, Math.round(opts.start || 0));
      this._playback = {
        list,
        fn: list ? null : source,
        // null means "whatever the board's fps option says", so
        // update({ fps }) retimes a running sequence. A figure passed here
        // is this sequence's own and ignores the option.
        fps: opts.fps == null ? null : Number(opts.fps),
        loop: opts.loop !== false,
        onFrame: typeof opts.onFrame === 'function' ? opts.onFrame : null,
        index: list ? start % list.length : start,
        paused: false,
        next: 0,
        raf: null,
        // Playback defaults to no choreography, where the rest of the
        // component defaults to a ripple. A transition is a wave crossing
        // the board; running one inside every frame of a sequence is the
        // choreography fighting the content, and at any real frame rate
        // there isn't time for it anyway. Overridable because a slow clip
        // of a few frames is exactly where it earns its place.
        //
        // The whole bag is carried through rather than the setGrid keys
        // picked out of it, so `fps`, `loop`, `start` and `onFrame` ride
        // along into every write. They mean nothing to setGrid or _request
        // today, which is what makes this safe - and is also the reason a
        // future per-dot option must not be given one of those four names.
        opts: { transition: 'instant', ...opts },
      };
      this._syncPlayClock();
      return this;
    }

    // Whether the clock is running. False while paused, while the board is
    // off screen, and when there is no sequence loaded at all.
    get playing() {
      return !!(this._playback && this._playback.raf);
    }

    // Which frame goes up next, or -1 with nothing loaded. For an array
    // source this counts past the end and wraps on read, so it is a frame
    // count as much as an index.
    get frame() {
      return this._playback ? this._playback.index : -1;
    }

    // Holds the sequence where it is. The board keeps whatever frame is on
    // it - pausing a sequence is not clearing it.
    pause() {
      if (!this._playback) return this;
      this._playback.paused = true;
      this._stopPlayClock();
      return this;
    }

    resume() {
      if (!this._playback) return this;
      this._playback.paused = false;
      this._syncPlayClock();
      return this;
    }

    // Ends playback and forgets the sequence. The board is left showing the
    // last frame, which is almost always what is wanted - clear() after
    // this if not.
    stop() {
      this._stopPlayClock();
      this._playback = null;
      return this;
    }

    // Jumps to a frame. Takes effect on the next beat of the clock rather
    // than drawing immediately, so seeking a running sequence does not
    // double up with the frame already due.
    seek(index) {
      if (!this._playback) return this;
      const at = Math.max(0, Math.round(index));
      const list = this._playback.list;
      this._playback.index = list ? at % list.length : at;
      return this;
    }

    // The clock runs only while there is a sequence, the host has not
    // paused it, and the board is on screen - the same gating the render
    // loop uses, for the same reason.
    _syncPlayClock() {
      const pb = this._playback;
      if (!pb || pb.paused || !this._onScreen) {
        this._stopPlayClock();
        return;
      }
      if (pb.raf) return;
      // Due now, so starting or resuming puts a frame up immediately
      // instead of showing the old one for one more interval.
      pb.next = performance.now();
      pb.raf = requestAnimationFrame(this._playTick);
    }

    _stopPlayClock() {
      const pb = this._playback;
      if (!pb || !pb.raf) return;
      cancelAnimationFrame(pb.raf);
      pb.raf = null;
    }

    _playTick(now) {
      const pb = this._playback;
      if (!pb || !pb.raf) return;
      pb.raf = requestAnimationFrame(this._playTick);
      if (now < pb.next) return;

      // Clamped at both ends: a rate of zero would make the deadline
      // meaningless, and anything past the display's own refresh is a
      // number the clock cannot honor whatever the board could.
      const fps = pb.fps == null ? this.options.fps : pb.fps;
      const interval = 1000 / Math.max(0.1, Math.min(120, Number(fps) || 1));
      // Scheduled off the deadline rather than off `now`, so the sequence
      // keeps real time instead of losing the slack in every frame - but
      // never pushed further back than the present, which is what makes a
      // stall cost one dropped frame instead of a burst replaying the
      // backlog at full speed.
      pb.next = Math.max(now, pb.next + interval);
      this._playFrame();
    }

    _playFrame() {
      const pb = this._playback;
      const at = pb.index;
      const content = pb.list ? pb.list[at % pb.list.length] : pb.fn(at, this);
      pb.index = at + 1;
      // null is "nothing new", not "an empty board" - see play().
      if (content != null) this.setGrid(content, pb.opts);
      if (pb.onFrame) pb.onFrame(at, this);

      // Only a list can run out; a function source is open-ended by nature
      // and ends when the host stops it.
      if (pb.list && !pb.loop && pb.index >= pb.list.length) {
        this.stop();
        this.el.dispatchEvent(new CustomEvent('flip-dots:end', {
          bubbles: true,
          detail: { board: this },
        }));
      }
    }

    // ---- animation ---------------------------------------------------

    _start() {
      // Nothing to animate means no loop - without this, anything that
      // speculatively starts one (coming back on screen, say) would spin up
      // a frame whose only act is to notice it has nothing to do and
      // announce a settle that never un-settled.
      if (this._active.size === 0) return;
      if (this._raf || !this._onScreen || this.reduced) return;
      this._lastNow = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    // Drops a dot onto its target with no travel left.
    _settle(i) {
      this._turn[i] = this._target[i];
      this._vel[i] = 0;
      this._active.delete(i);
      // Rebase to keep `turn` small over a long-lived board: shifting both
      // by an even number of half turns leaves face parity - and so the
      // visible state - untouched.
      const base = this._target[i] - mod(this._target[i], 2);
      this._turn[i] -= base;
      this._target[i] -= base;
      this._paintCell(i);
    }

    _settleAll() {
      Array.from(this._active).forEach((i) => this._settle(i));
    }

    _tick(now) {
      const dt = Math.min(0.05, (now - this._lastNow) / 1000);
      this._lastNow = now;
      this._elapsed += dt;

      const { overshoot } = this.options;
      const steps = Math.max(1, Math.ceil(dt / SUB_STEP));
      const h = dt / steps;
      const flipped = [];

      this._active.forEach((i) => {
        if (this._delay[i] > this._elapsed) return;

        // Resolved when this dot was asked to flip - see _request.
        const k = this._k[i];
        const c = this._c[i];
        const target = this._target[i];
        const faceBefore = mod(Math.round(this._turn[i]), 2);
        // Which side of the target the dot is approaching from decides
        // which side its stop is on.
        const approach = Math.sign(target - this._turn[i]) || 1;

        let turn = this._turn[i];
        let vel = this._vel[i];
        for (let s = 0; s < steps; s++) {
          vel += (-k * (turn - target) - c * vel) * h;
          turn += vel * h;
          // The magnet. A real disc cannot rotate past its stop, so travel
          // beyond the target is capped and what velocity is left rebounds
          // - the overshoot you see is the disc flexing against the stop,
          // not swinging past it.
          const past = (turn - target) * approach;
          if (past > overshoot) {
            turn = target + overshoot * approach;
            vel = -vel * 0.25;
          }
        }
        this._turn[i] = turn;
        this._vel[i] = vel;

        const faceAfter = mod(Math.round(turn), 2);
        // Passing edge-on is both when the face swaps and when the disc
        // meets its stop, so it is the honest moment to call a dot flipped.
        if (faceAfter !== faceBefore) flipped.push(i);

        if (Math.abs(turn - target) < 0.0015 && Math.abs(vel) < 0.02) {
          this._settle(i);
        } else {
          this._paintCell(i);
        }
      });

      if (flipped.length) {
        const cols = this.cols;
        const onFlip = this.options.onFlip;
        const sound = this.options.sound;
        for (let f = 0; f < flipped.length; f++) {
          const i = flipped[f];
          const x = i % cols;
          if (sound && !this._silent[i]) {
            this._clicker.click(cols > 1 ? (x / (cols - 1)) * 1.6 - 0.8 : 0);
          }
          // A per-dot callback rather than a DOM event: a board-wide wave is
          // thousands of these in one frame, and dispatching thousands of
          // events would cost more than the animation does. Off unless the
          // host asks for it.
          if (onFlip) onFlip(x, (i - x) / cols, this._state[i], this);
        }
      }

      if (this._active.size === 0) {
        this._stop();
        this._announceSettle();
        return;
      }
      this._raf = requestAnimationFrame(this._tick);
    }

    // Fired once each time the board goes from moving to still. This is the
    // hook for chaining: the settle time of an update is `duration` plus a
    // flip plus whatever ringing bounce adds plus per-dot jitter, which is
    // not a sum a caller should be reconstructing with setTimeout.
    //
    // Guarded on something actually having moved since the last one, so it
    // marks a transition rather than a state. A board that is already still
    // can be asked to settle, or stopped and restarted, any number of times
    // without a listener hearing about it.
    _announceSettle() {
      if (!this._movedSinceSettle) return;
      this._movedSinceSettle = false;
      this.el.dispatchEvent(new CustomEvent('flip-dots:settle', {
        bubbles: true,
        detail: { board: this },
      }));
    }

    // ---- drawing -----------------------------------------------------

    _entry(state) {
      const p = this.options.palette;
      const e = p[Math.max(0, Math.min(p.length - 1, state))];
      return typeof e === 'string' ? { fill: e } : (e || { fill: '#000' });
    }

    // The rim color, derived once per palette when `edgeColor` is null: the
    // average of every face mixed toward black. Averaging rather than
    // picking one end means the rim lands between the palette's extremes
    // whatever they are, so it stays visible against both the darkest face
    // and the lightest - which is the whole job, and is why this is derived
    // rather than left to the host to get right.
    _edgeRgb() {
      if (this._edge) return this._edge;
      if (this.options.edgeColor) {
        this._edge = parseColor(this.options.edgeColor);
        return this._edge;
      }
      const p = this.options.palette;
      const sum = [0, 0, 0];
      for (let i = 0; i < p.length; i++) {
        const rgb = parseColor(this._entry(i).fill);
        sum[0] += rgb[0];
        sum[1] += rgb[1];
        sum[2] += rgb[2];
      }
      const avg = [sum[0] / p.length, sum[1] / p.length, sum[2] / p.length];
      this._edge = mixToward(avg, [0, 0, 0], 0.42);
      return this._edge;
    }

    // The color to draw a face at a given foreshortening, quantized to 64
    // steps and cached: a board redrawing hundreds of dots a frame would
    // otherwise spend most of its time building `rgb(...)` strings. Both
    // effects below are functions of `squash` alone, so one step indexes
    // both and the cache stays small.
    _shaded(state, squash) {
      const step = Math.round(squash * 63);
      const key = state * 64 + step;
      const hit = this._shadeCache.get(key);
      if (hit) return hit;

      const s = step / 63;
      const entry = this._entry(state);
      // Lambert-ish: the face darkens as it turns away from the light.
      // Toward black, not toward transparent - the dot is in shadow, not
      // fading out, and over a light background fading would read as a
      // ghost rather than as a tilt.
      const lit = mixToward(parseColor(entry.fill), [0, 0, 0], this.options.shade * (1 - s) * 0.7);
      // ...and then the rim takes over, steeply, only as the face runs out
      // of width - see `edgeFalloff` for why it has to be steep.
      const edge = 'edge' in entry ? parseColor(entry.edge) : this._edgeRgb();
      const c = mixToward(lit, edge, Math.pow(1 - s, this.options.edgeFalloff));

      const css = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      this._shadeCache.set(key, css);
      return css;
    }

    _paintAll() {
      const { ctx } = this;
      if (this.options.background) {
        ctx.fillStyle = this.options.background;
        ctx.fillRect(0, 0, this._w, this._h);
      } else {
        ctx.clearRect(0, 0, this._w, this._h);
      }
      for (let i = 0; i < this._state.length; i++) this._drawDot(i);
    }

    // Repaints one cell: clear it back to the background, then draw. Only
    // the cells that moved are touched, so a board with twenty dots in
    // flight costs twenty small rects rather than a full-canvas redraw.
    //
    // The cleared rect is exactly the cell and never a pixel more, which is
    // what makes this safe to do per dot: a padded clear would reach into
    // the neighbors and shave the dots already drawn there, and the only
    // repair for that is repainting a whole neighborhood per dirty cell. A
    // disc that stays inside its own cell (see _leanMax) needs none of it.
    // Precomputes what the hinge angle means for drawing, so _drawDot does
    // no trigonometry or branching arithmetic per dot per frame.
    _syncHinge() {
      // Folded onto 0..180: a hinge line has no near end and far end, so an
      // axle at 190 degrees is the same axle as one at 10.
      const folded = mod(Number(this.options.hinge) || 0, 180);
      this._hingeRad = (folded * Math.PI) / 180;
      // Within a tenth of a degree of flat or upright counts as aligned, so
      // a slider resting on 0 or 90 takes the crisp snapped path rather than
      // falling into the rotated one over a rounding error.
      const off = folded % 90;
      this._hingeAligned = off < 0.1 || off > 89.9;
      this._hingeUpright = this._hingeAligned && Math.abs(folded - 90) < 0.1;
    }

    // Snaps a CSS-pixel coordinate to a whole device pixel. Cell boundaries
    // land on fractions of a pixel otherwise, and a fill that stops halfway
    // through a pixel is antialiased against what was already there - so
    // every cell leaves a faint seam along its edge, and a board of them
    // draws a visible grid over the panel. Deriving both of a cell's edges
    // from the same snapped boundary means neighbors share it exactly:
    // no seam, and no overlap to shave the next dot either.
    _snap(v) {
      return Math.round(v * this._dpr) / this._dpr;
    }

    _paintCell(i) {
      const { ctx } = this;
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      const left = this._snap(this._originX + x * this._pitch);
      const top = this._snap(this._originY + y * this._pitch);
      const right = this._snap(this._originX + (x + 1) * this._pitch);
      const bottom = this._snap(this._originY + (y + 1) * this._pitch);
      if (this.options.background) {
        ctx.fillStyle = this.options.background;
        ctx.fillRect(left, top, right - left, bottom - top);
      } else {
        ctx.clearRect(left, top, right - left, bottom - top);
      }
      this._drawDot(i);
    }

    _drawDot(i) {
      const { ctx } = this;
      const { shape, thickness, perspective } = this.options;
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);

      const turn = this._turn[i];
      const phase = turn * Math.PI;
      const squash = Math.abs(Math.cos(phase));
      const face = mod(Math.round(turn), 2) === 0 ? this._faceEven[i] : this._faceOdd[i];

      const d = this._dot;
      const edge = Math.max(0.5, d * thickness);
      // The face foreshortens to nothing at 90 degrees but the disc's own
      // edge does not, so the drawn extent never goes below `edge`. Without
      // this the flip has a frame where the dot is simply gone, and that
      // gap is exactly what makes a CSS-transform flip look like paper.
      const extent = Math.max(edge, d * squash);

      // Swinging toward the viewer on the way round. sin is signed, so the
      // dot leans one way through the first half of the turn and the other
      // way through the second - which is what sells the hinge. Capped at
      // the cell's own slack so a repaint never has to touch a neighbor.
      const lean = Math.max(-this._leanMax, Math.min(this._leanMax,
        Math.sin(phase) * d * perspective));

      // The disc foreshortens perpendicular to its axle, and leans the same
      // way - so both follow the hinge angle rather than a fixed axis.
      const rad = this._hingeRad;
      const ox = -Math.sin(rad) * lean;
      const oy = Math.cos(rad) * lean;

      // The cell's own bounds, snapped to whole device pixels. Everything
      // below is measured from these rather than from a fractional center
      // and a width, which is what keeps square dots at zero gap from
      // antialiasing against the background along every edge and drawing a
      // grid of seams over the board.
      const left = this._snap(this._originX + x * this._pitch);
      const top = this._snap(this._originY + y * this._pitch);
      const right = this._snap(this._originX + (x + 1) * this._pitch);
      const bottom = this._snap(this._originY + (y + 1) * this._pitch);

      const entry = this._entry(face);
      const border = 'border' in entry ? entry.border : this.options.borderColor;
      ctx.fillStyle = this._shaded(face, squash);

      // A disc that is flat on is not foreshortened at all, so whatever its
      // axle angle, what you see is the plain axis-aligned shape - and it
      // may as well be drawn through the crisp snapped path. This is not
      // just an optimization: a resting board is exactly where seams would
      // show, so a diagonal axle has to come back to the snapped path by the
      // time it settles or it would reintroduce them.
      const flatOn = squash > 0.9995;

      if (this._hingeAligned || flatOn) {
        // The drawn shape stays axis-aligned, so it can be built from the
        // snapped cell bounds by insetting and neighbors agree exactly
        // where the edge between them falls.
        const upright = this._hingeAligned && this._hingeUpright;
        const boxW = upright ? extent : d;
        const boxH = this._hingeAligned ? (upright ? d : extent) : d;
        const insetX = ((right - left) - boxW) / 2;
        const insetY = ((bottom - top) - boxH) / 2;

        const x0 = this._snap(left + insetX + ox);
        const y0 = this._snap(top + insetY + oy);
        let x1 = this._snap(right - insetX + ox);
        let y1 = this._snap(bottom - insetY + oy);
        // Snapping can collapse the edge-on sliver onto a single boundary.
        // One device pixel is the thinnest a disc may ever draw - at zero it
        // would vanish, which is the dead frame `thickness` exists to stop.
        const onePx = 1 / this._dpr;
        if (x1 - x0 < onePx) x1 = x0 + onePx;
        if (y1 - y0 < onePx) y1 = y0 + onePx;
        const w = x1 - x0;
        const hh = y1 - y0;

        ctx.beginPath();
        if (shape === 'square') {
          ctx.rect(x0, y0, w, hh);
        } else if (shape === 'rounded' && ctx.roundRect) {
          ctx.roundRect(x0, y0, w, hh, Math.min(w, hh) * 0.28);
        } else {
          ctx.ellipse(x0 + w / 2, y0 + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        if (border) {
          ctx.lineWidth = Math.max(0.5, d * this.options.borderWidth);
          ctx.strokeStyle = border;
          ctx.stroke();
        }
        return;
      }

      // A diagonal axle, part way through its turn. The foreshortening is no
      // longer along either screen axis, so there is no axis-aligned box to
      // snap to and the dot is drawn under a transform instead. Nothing is
      // lost by it: the seams that snapping prevents only appear where dots
      // tile edge to edge, which is the resting board - and a resting board
      // is flat on, which the branch above has already taken.
      const cx = (left + right) / 2 + ox;
      const cy = (top + bottom) / 2 + oy;
      // Foreshortening as a fraction of the disc's full width. Floored well
      // above zero because a scale of exactly 0 is a singular transform,
      // which canvas declines to draw through at all.
      const k = Math.max(0.0005, extent / d);

      ctx.save();
      if (shape !== 'circle') {
        // A squashed circle always fits inside the circle it came from, so
        // it cannot leave its cell. A squashed *square* can: at 45 degrees
        // and fully edge-on it collapses onto its own diagonal, which is
        // longer than the cell is wide, and the ends would reach into the
        // neighbors - whose dots have already been drawn and are not going
        // to be drawn again. Clipping to the cell is what keeps "a dot
        // never leaves its cell" true for every shape and angle, and so
        // keeps the one-rect-per-dot repaint correct.
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();
      }
      // Squash along the axle's perpendicular, and only along it: rotate the
      // world so the axle lies flat, compress, then rotate back, and draw
      // the dot's own shape in its own orientation inside that. Rotating the
      // *shape* by the hinge angle instead would be a different thing
      // entirely - a square would sit as a diamond even lying flat on, when
      // a disc that is not foreshortened at all should look exactly like
      // one on any other axle.
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.scale(1, k);
      ctx.rotate(-rad);
      ctx.beginPath();
      if (shape === 'square') {
        ctx.rect(-d / 2, -d / 2, d, d);
      } else if (shape === 'rounded' && ctx.roundRect) {
        ctx.roundRect(-d / 2, -d / 2, d, d, d * 0.28);
      } else {
        ctx.ellipse(0, 0, d / 2, d / 2, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      if (border) {
        ctx.lineWidth = Math.max(0.5, d * this.options.borderWidth);
        ctx.strokeStyle = border;
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- lifecycle ---------------------------------------------------

    _listenForGesture() {
      document.addEventListener('pointerdown', this._armSound, { once: true });
      document.addEventListener('keydown', this._armSound, { once: true });
    }

    _armSound() {
      this._clicker.arm();
    }

    // Starts audio now, for a page with its own "sound on" button - a
    // gesture that already happened cannot be waited for.
    enableSound() {
      this.options.sound = true;
      this._clicker.arm();
      return this;
    }

    _onReducedChange() {
      if (this.reduced) {
        this._stop();
        this._settleAll();
      }
    }

    // New option values, e.g. from a control panel. Anything that changes
    // the grid's shape or the dots' size re-measures (which resamples the
    // content onto the new grid); a palette or shading change only
    // invalidates the color cache and repaints.
    update(newOptions = {}) {
      const before = this.options;
      const structural = ['cols', 'rows', 'dotSize', 'gap', 'jitter', 'perspective']
        .some((k) => k in newOptions && newOptions[k] !== before[k]);
      const recolor = ['palette', 'shade', 'edgeColor', 'edgeFalloff', 'background', 'borderColor', 'borderWidth', 'shape', 'hinge', 'thickness']
        .some((k) => k in newOptions);

      this.options = { ...before, ...newOptions };

      if ('hinge' in newOptions) this._syncHinge();
      if ('flipDuration' in newOptions || 'bounce' in newOptions || 'stiffness' in newOptions) {
        this._syncSpring();
      }
      if ('sound' in newOptions && newOptions.sound) this._clicker.arm();
      if (recolor) {
        this._shadeCache.clear();
        this._edge = null;
      }

      if (structural) this._measure();
      else if (recolor) this._paintAll();
      return this;
    }

    _resize() {
      this._measure();
    }

    destroy() {
      this._stop();
      this.stop();
      this._resizeObserver.disconnect();
      this._intersectionObserver.disconnect();
      if (this._reducedQuery && this._reducedQuery.removeEventListener) {
        this._reducedQuery.removeEventListener('change', this._onReducedChange);
      }
      document.removeEventListener('pointerdown', this._armSound);
      document.removeEventListener('keydown', this._armSound);
      this._clicker.destroy();
      this.canvas.remove();
    }
  }

  FlipDots.transitions = transitions;
  FlipDots.easings = easings;
  FlipDots.font = font;
  FlipDots.textGrid = textGrid;
  FlipDots.imageGrid = imageGrid;
  FlipDots.imagePalette = imagePalette;
  FlipDots.defaults = DEFAULTS;

  FlipDots.initAll = function initAll(selector = '.flip-dots', options = {}) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__flipDotsInstance)
      .map((el) => {
        const instance = new FlipDots(el, options);
        el.__flipDotsInstance = instance;
        return instance;
      });
  };

  // Look up the instance auto-init already created for an element (or the
  // first match of a selector) - page code should use this rather than
  // calling initAll() again, which would find nothing left to claim.
  FlipDots.get = function get(elOrSelector) {
    if (!elOrSelector) return null;
    const el = typeof elOrSelector === 'string'
      ? document.querySelector(elOrSelector)
      : elOrSelector;
    return el ? el.__flipDotsInstance || null : null;
  };

  FlipDots.getAll = function getAll(selector = '.flip-dots') {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.__flipDotsInstance)
      .filter(Boolean);
  };

  global.FlipDots = FlipDots;

  function autoInit() {
    FlipDots.initAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
