/**
 * Home page wiring: Sweep filters, the axis/progress-driver adapters that
 * let Sweep's wheel/drag input stand in for each effect's normal scroll
 * input, and the per-effect initAll() calls tuned for card size.
 *
 * Must be loaded as a plain synchronous <script src="home.js"> (no
 * async/defer). The shared effect scripts loaded just above this one
 * auto-init with default options on DOMContentLoaded; the custom-tuned
 * initAll() calls below need to run and claim these elements (via class
 * matches like h2.double-speak) before that fires, so the defaults never
 * get applied to these preview cards. A plain script tag blocks parsing
 * and runs immediately, before DOMContentLoaded — same guarantee an
 * inline script had.
 */
function setupFilter(filterId, gridId, onChange) {
  const filter = document.getElementById(filterId);
  const cards = Array.from(document.querySelectorAll(`#${gridId} .variation-card[data-type]`));

  filter.addEventListener('change', () => {
    const value = filter.value;
    cards.forEach((card) => {
      const types = card.dataset.type.split(' ');
      card.hidden = value !== 'all' && !types.includes(value);
    });
    if (onChange) onChange();
  });
}

const [variationCarousel] = Sweep.initAll('#variationCarousel');
const [conceptCarousel] = Sweep.initAll('#conceptCarousel');
Sweep.initAll('#transitionCarousel');
Sweep.initAll('#backgroundCarousel');
// #carouselLabCarousel needs no custom options, so it's left for
// sweep.js's own blanket auto-init (on DOMContentLoaded) to pick up -
// the same as any other page just dropping the effect in. Its cards'
// own miniature previews are a different matter, and are set up further
// down with the rest of the per-card effect wiring.

// The plain element, not the Sweep instance's own internal `.root` - kept
// separate so every card-effect wiring below reaches Sweep only through
// its public surface (initAll/get/refresh/update), the same as any other
// effect on this page.
const variationCarouselEl = document.getElementById('variationCarousel');

setupFilter('typeFilter', 'variationGrid', () => variationCarousel.refresh());
setupFilter('conceptTypeFilter', 'conceptGrid', () => conceptCarousel.refresh());

// Tracks a horizontal pointer drag starting on `sweepEl` and calls
// `onDelta(dx)` with each frame's movement in px (negative = dragged
// left) - the drag half of "wheel or drag over the sweep drives whatever's
// currently on screen", shared by every sweep-driven card below.
// pointermove/pointerup listen on window rather than sweepEl so a drag
// keeps tracking even if the pointer slides off the sweep mid-drag.
function bindSweepDrag(sweepEl, onDelta) {
  let dragging = false;
  let lastX = 0;

  sweepEl.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    onDelta(dx);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
}

// While scrolling the page normally, a card's lag effect uses its
// default (vertical) profile, driven by the instance's own window-
// scroll listener. While the user is actively wheeling/dragging the
// sweep itself, we temporarily switch it to the horizontal profile
// and drive the offset directly from that wheel/drag input instead —
// then revert to vertical once sweep input goes idle.
function bindSweepAxisSwitch(sweepEl, instance, verticalProfile, horizontalProfile) {
  const SCALE_X = 1;
  const DRAG_SCALE = 6;
  const IDLE_DELAY = 350;
  const maxOffset = horizontalProfile.offsetX || 0;
  let idleTimer = null;

  function scheduleRevert() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => instance.update(verticalProfile), IDLE_DELAY);
  }

  function nudge(delta) {
    instance.update(horizontalProfile);
    instance._targetX = maxOffset > 0
      ? Math.max(-maxOffset, Math.min(maxOffset, delta * SCALE_X))
      : 0;
    instance._targetY = 0;
    scheduleRevert();
  }

  sweepEl.addEventListener('wheel', (event) => {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    nudge(raw);
  }, { passive: true });

  bindSweepDrag(sweepEl, (dx) => nudge(-dx * DRAG_SCALE));
}

// In Flight Out and Type Pan Vertical normally derive their progress
// (0-1) from the element's position in the viewport as the page
// scrolls. On these cards that's disabled entirely (see below) and
// progress is driven only by wheel/drag input on the sweep itself,
// easing back to a resting value once that input goes idle.
function bindSweepProgressDriver(sweepEl, instance, options = {}) {
  const sensitivity = options.sensitivity ?? 0.0015;
  const dragSensitivity = options.dragSensitivity ?? 0.004;
  const restProgress = options.restProgress ?? 0.5;
  const idleDelay = options.idleDelay ?? 350;
  const revertEase = options.revertEase ?? 0.08;
  // Defaults to reading/writing instance._progress (In Flight Out,
  // Type Pan Vertical); pass get/set to drive some other 0-1 stand-in,
  // e.g. Type Pan Horizontal's pixel-based typed length.
  const getProgress = options.get || (() => instance._progress);
  const setProgress = options.set || ((value) => { instance._progress = value; });
  let idleTimer = null;
  let revertRaf = null;

  function stopRevert() {
    if (revertRaf) cancelAnimationFrame(revertRaf);
    revertRaf = null;
  }

  function startRevert() {
    stopRevert();
    function step() {
      setProgress(getProgress() + (restProgress - getProgress()) * revertEase);
      if (Math.abs(getProgress() - restProgress) < 0.0015) {
        setProgress(restProgress);
        revertRaf = null;
        return;
      }
      revertRaf = requestAnimationFrame(step);
    }
    revertRaf = requestAnimationFrame(step);
  }

  function scheduleIdleRevert() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(startRevert, idleDelay);
  }

  function nudge(delta) {
    stopRevert();
    setProgress(Math.max(0, Math.min(1, getProgress() + delta)));
    scheduleIdleRevert();
  }

  sweepEl.addEventListener('wheel', (event) => {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    nudge(raw * sensitivity);
  }, { passive: true });

  bindSweepDrag(sweepEl, (dx) => nudge(-dx * dragSensitivity));

  setProgress(restProgress);
}

const DOUBLE_SPEAK_VERTICAL = { offsetX: 0, offsetY: 14, lag: 0.15, opacity: 0.5 };
const DOUBLE_SPEAK_HORIZONTAL = { offsetX: 14, offsetY: 0, lag: 0.15, opacity: 0.5 };
const [doubleSpeakCard] = DoubleSpeak.initAll('.variation-card h2.double-speak', DOUBLE_SPEAK_VERTICAL);
if (doubleSpeakCard) {
  bindSweepAxisSwitch(variationCarouselEl, doubleSpeakCard, DOUBLE_SPEAK_VERTICAL, DOUBLE_SPEAK_HORIZONTAL);
}

const TRIPLE_VISION_VERTICAL = { offsetX: 0, offsetY: 100, lag: 0.15, opacity: 0.6 };
const TRIPLE_VISION_HORIZONTAL = { offsetX: 100, offsetY: 0, lag: 0.15, opacity: 0.6 };
const [tripleVisionCard] = TripleVisionText.initAll('.variation-card h2.triple-vision', TRIPLE_VISION_VERTICAL);
if (tripleVisionCard) {
  bindSweepAxisSwitch(variationCarouselEl, tripleVisionCard, TRIPLE_VISION_VERTICAL, TRIPLE_VISION_HORIZONTAL);
}
WaveForm.initAll('.variation-card h2.wave-form', {
  amplitude: 6, frequency: 0.8, spread: 1.1, drift: 0.6,
});
// Mirrors the Minimal preset's crisp, no-smear character (see the Paint
// Drag demo page) - blur is kept scaled down for this card's 28px title
// rather than the preset's blur:10, since blur is an absolute pixel
// value tuned for the demo's much larger headline text.
// zIndex is pulled below the sitewide nav's z-index: 20 (shared/site.css)
// so the trail's fixed, page-level overlay canvas - which sits directly on
// document.body and so isn't contained by the sweep's own stacking
// context - doesn't paint on top of the nav once the sweep scrolls
// under it.
PaintDrag.initAll('.variation-card h2.paint-drag', {
  smearLength: 0, spread: 0, blur: 2, fadeTime: 0.1, density: 0, zIndex: 10,
});
const [inFlightOutCard] = InFlightOut.initAll('.variation-card h2.in-flight-out', {
  scatter: 0.45, maxDistance: 60, rotation: 0.4, maxAngle: 40,
});
if (inFlightOutCard) {
  window.removeEventListener('scroll', inFlightOutCard._onScroll);
  window.removeEventListener('resize', inFlightOutCard._onScroll);
  bindSweepProgressDriver(variationCarouselEl, inFlightOutCard, { restProgress: 0.5 });
}

// Type Pan normally types from real page scroll position. That's replaced
// here with the same sweep-driven progress approach as the other cards.
const [typePanCard] = TypePan.initAll('.variation-card h2.type-pan', {
  sensitivity: 1, panPosition: 0.75,
});
if (typePanCard) {
  window.removeEventListener('scroll', typePanCard._onScroll);
  window.removeEventListener('resize', typePanCard._onResize);
  // Drives it through the public pushProgress() entry point (same one
  // real scroll/hover input feeds internally) rather than poking
  // _progress directly, so an in-flight nextChar()/goTo() step still
  // gets cancelled correctly and _maxProgress still tracks.
  bindSweepProgressDriver(variationCarouselEl, typePanCard, {
    restProgress: 1,
    set: (value) => typePanCard.pushProgress(value),
  });
}
// Wheel input needs no custom wiring at all: 'hover' driveMode is
// Rolodex's own built-in way to take input from wheel/trackpad over some
// other element instead of page scroll (see rolodex.js), and the sweep
// is tagged data-rolodex-hover="rolodexCardTitle" in index.body.html to be
// that element. loopScroll makes the word list circular (wheeling past
// the last word flips straight into the first instead of stopping), loop
// keeps it cycling on its own once the sweep goes idle - same as any
// other page using the effect, just fed by the sweep instead of the
// page scrolling.
const [rolodexCard] = Rolodex.initAll('.variation-card h2.rolodex', {
  mode: 'split-flap', flipWidth: 55, perspective: 900, shading: 0.05,
  driveMode: 'hover', loop: true, loopScroll: true,
});
if (rolodexCard) {
  // Drag has no built-in equivalent to 'hover' driveMode's wheel
  // listening (see the In Flight Out/Type Pan cards above for the same
  // gap), so it's the one piece of custom wiring this card still needs -
  // same shape as those, just calling .pushProgress() directly since
  // there's no separate get/set indirection to thread through here.
  const ROLODEX_DRAG_DISTANCE = 400; // px of drag to sweep the whole word list
  bindSweepDrag(variationCarouselEl, (dx) => {
    rolodexCard.pushProgress(rolodexCard._progress - dx / ROLODEX_DRAG_DISTANCE);
  });

  // Once this card settles into focus (see the 'sweep-settle' event on
  // Sweep), flip it back to its opening word - so browsing away and
  // back always finds it freshly reset rather than wherever a previous
  // visit left it.
  rolodexCard.el.closest('.variation-card').addEventListener('sweep-settle', () => {
    rolodexCard.goTo(0);
  });
}
CircuitBoard.initAll('.liftoff-card.bg-circuit-board', {
  maxTraces: 30, cell: 20, speed: 30,
});
GravityWell.initAll('.liftoff-card.bg-gravity-well', {
  cell: 20, radius: 110, strength: 40,
});
Vacuum.initAll('.liftoff-card.bg-vacuum', {
  radius: 90, density: 8, maxParticles: 80,
});
Fireflies.initAll('.liftoff-card.bg-fireflies', {
  count: 16, glowSize: 6,
});
// Finer dots than the demo page's default, since the card is a fraction of
// the size and 13px spacing would leave a continent only a few dots wide.
// A high sea level keeps the card mostly open water: at full-size defaults
// a continent fills it edge to edge in solid black, and the card's own
// title has to stay readable on top of it.
OuterWorlds.initAll('.liftoff-card.bg-outer-worlds', {
  dotSpacing: 7, autoSpin: 1.6, seaLevel: 0.2,
});

// --- Components Lab card preview -------------------------------------
// Same idea as the background cards above: the card is a live board rather
// than a picture of one. A card is a few hundred dots against the demo
// page's thousand-plus, so the grid is coarse and the dots are big enough
// to still read as discs turning at this size.
//
// White panel, near-black dots: every other card on this page is black on
// white, and with the card's own labels hidden (.fd-card in style.css)
// there is nothing sitting on top that the contrast could swallow.
const [flipDotsPreview] = FlipDots.initAll('#flipDotsPreview', {
  dotSize: 9,
  gap: 0.26,
  background: '#ffffff',
  palette: ['#e9e9e9', '#15171b'],
  flipDuration: 115,
  jitter: 0.3,
  duration: 850,
  // Sound is wired but held at silence, and hover is what raises the
  // volume. `sound: true` is doing one job here: it registers the listeners
  // that arm the audio on the page's first pointerdown or keydown, wherever
  // on the page those land. Browsers unlock audio only on a gesture from
  // that short list, and neither a pointer crossing a card nor a scroll is
  // on it - so a visit spent hovering alone is silent however this is
  // wired. What arming up front buys is the hover *after* the visitor's
  // first click or keypress: the context is already running by then, rather
  // than that hover spending itself on the unlock.
  sound: true,
  volume: 0,
});

// Set below if the card is on the page, and read by the HOVER_EFFECTS list
// further down - which is where every other hover-reactive thing on a card
// is driven from, and so where this one belongs too rather than binding the
// board's own pointer events.
let flipDotsHover = null;

if (flipDotsPreview) {
  // The card spells its own name out, then shows what the board does
  // between names, then spells it again - each step on a different
  // transition and pace, so a glance at the card catches a different move
  // than the last one did. Hovering interrupts all of that and holds the
  // name; see the hover section at the end of this block.
  const FONT_H = FlipDots.font.height;

  // "FLIP DOTS" on one line needs 53 columns and the card has about 26, so
  // it goes on two. textGrid is a plain accessor rather than a method for
  // exactly this: two of them OR'd together compose into one grid, where
  // two text() calls would have the second blanking the first.
  function nameGrid(board) {
    const lines = ['FLIP', 'DOTS'];
    const block = FONT_H * 2 + 1;
    const top = Math.round((board.rows - block) / 2);
    const built = lines.map((line, i) => FlipDots.textGrid(line, board.cols, board.rows, {
      y: top + i * (FONT_H + 1),
    }));
    return (x, y) => (built.some((at) => at(x, y) === 1) ? 1 : 0);
  }

  // Each slide is content plus how it should arrive. Fixed rather than
  // random: this is a card on a page, and it should look choreographed
  // rather than restless.
  const SLIDES = [
    { grid: nameGrid, transition: 'random', easing: 'even' },
    {
      // Concentric bands out from the middle.
      grid: (b) => {
        const cx = (b.cols - 1) / 2;
        const cy = (b.rows - 1) / 2;
        return (x, y) => (Math.floor(Math.hypot(x - cx, y - cy) / 2.5) % 2);
      },
      transition: 'ripple',
      easing: 'smooth',
    },
    { grid: nameGrid, transition: 'wipe', easing: 'even', direction: 'left' },
    {
      // Diagonal stripes.
      grid: () => (x, y) => (Math.floor((x + y) / 3) % 2),
      transition: 'diagonal',
      easing: 'accelerate',
    },
    { grid: nameGrid, transition: 'rows', easing: 'decelerate' },
    {
      // A soft blotchy field - the one slide that is different every time
      // it comes round.
      grid: () => {
        const seed = Math.random() * 100;
        return (x, y) => (
          Math.sin((x + seed) * 0.3) + Math.sin((y - seed) * 0.4) > 0.4 ? 1 : 0
        );
      },
      transition: 'dissolve',
      easing: 'even',
    },
  ];

  let slide = 0;
  let slideTimer = null;
  const beat = () => {
    const spec = SLIDES[slide % SLIDES.length];
    slide++;
    flipDotsPreview.setGrid(spec.grid(flipDotsPreview), {
      transition: spec.transition,
      easing: spec.easing,
      direction: spec.direction,
    });
  };

  function startSlides() {
    if (slideTimer === null) slideTimer = setInterval(beat, 2400);
  }

  function stopSlides() {
    clearInterval(slideTimer);
    slideTimer = null;
  }

  beat();
  startSlides();

  // --- hover ----------------------------------------------------------
  // Hovering stops the slideshow and holds the card on its own name: the
  // board flips to FLIP DOTS, the dots the word doesn't use carry on
  // ticking over underneath it, and the clicks come up out of silence.
  // Together they are the one state where the card is the component being
  // driven rather than a preview playing - which is what a visitor about
  // to click through is asking to see.
  //
  // Driven from HOVER_EFFECTS below rather than from the board's own
  // pointerenter, for the same reason Liftoff is: the sweep slides a
  // hovered card toward center under a stationary cursor, which retriggers
  // native hover on its own. That also means hover does nothing under
  // reduced motion, same as every other card effect on this page.
  const HOVER_VOLUME = 0.5;
  const SHIMMER_EVERY_MS = 240;
  const SHIMMER_COUNT = 8;

  let hovered = false;
  let shimmerTimer = null;
  // The cells the word leaves spare, and the handful of them currently
  // lit. The spare set is measured on each enter rather than once up
  // front: the grid is measured off the card's box, so a resize changes
  // which cells exist at all.
  let spare = [];
  let lit = [];

  function spareCells(mask) {
    const cells = [];
    for (let y = 0; y < flipDotsPreview.rows; y++) {
      for (let x = 0; x < flipDotsPreview.cols; x++) {
        if (mask(x, y) !== 1) cells.push([x, y]);
      }
    }
    return cells;
  }

  // A few spare dots up, and last beat's few back down, which is what
  // keeps this a shimmer around the word rather than a board slowly
  // filling in. The two directions have to be separate beats: a dot holds
  // one instruction, so asking it on the way up to come back down after a
  // delay would only replace the request that was sending it up.
  function shimmer() {
    lit.forEach(([x, y]) => flipDotsPreview.set(x, y, 0));
    lit = [];
    if (!spare.length) return;
    for (let i = 0; i < SHIMMER_COUNT; i++) {
      const cell = spare[Math.floor(Math.random() * spare.length)];
      // Read the board rather than trusting the spare set, which a resize
      // mid-hover can outdate: the word is the one thing on the card that
      // has to stay whole, and punching a hole in it would outlast the
      // pointer.
      if (flipDotsPreview.get(cell[0], cell[1]) === 1) continue;
      lit.push(cell);
      // A little spread per dot, so a beat arrives as a scatter of clicks
      // rather than one louder one - the same per-dot delay a transition
      // hands out, for a handful of dots that aren't an update.
      flipDotsPreview.set(cell[0], cell[1], 1, { delay: Math.random() * 90 });
    }
  }

  // The shimmer belongs to the word being held, not to it arriving, so it
  // waits for the board to come to rest. That wait is the settle event's
  // job rather than a setTimeout reconstructing duration plus a flip plus
  // bounce plus jitter - but a board already showing the name has nothing
  // to flip and so will never announce one, hence the direct check too.
  function startShimmer() {
    if (shimmerTimer === null) shimmerTimer = setInterval(shimmer, SHIMMER_EVERY_MS);
  }

  function onSettle() {
    if (hovered) startShimmer();
  }

  function enter() {
    if (hovered) return;
    hovered = true;
    stopSlides();
    const mask = nameGrid(flipDotsPreview);
    spare = spareCells(mask);
    lit = [];
    // Volume before the grid, so the word's own arrival is the loudest
    // thing the card does. Passing `sound` again re-arms the audio, which
    // is the retry for a context that was created before the page had a
    // gesture to unlock it.
    flipDotsPreview.update({ sound: true, volume: HOVER_VOLUME });
    flipDotsPreview.setGrid(mask, {
      transition: 'ripple', easing: 'smooth', duration: 650,
    });
    if (flipDotsPreview.settled) startShimmer();
    else flipDotsPreview.el.addEventListener('flip-dots:settle', onSettle, { once: true });
  }

  function leave() {
    if (!hovered) return;
    hovered = false;
    clearInterval(shimmerTimer);
    shimmerTimer = null;
    flipDotsPreview.el.removeEventListener('flip-dots:settle', onSettle);
    // Silenced before the shimmer comes down, so the card goes quiet the
    // moment the pointer is off it. The word itself is left standing - the
    // next slide is 2.4s away and is a whole-board update anyway.
    flipDotsPreview.update({ volume: 0 });
    lit.forEach(([x, y]) => flipDotsPreview.set(x, y, 0));
    lit = [];
    startSlides();
  }

  flipDotsHover = { el: flipDotsPreview.el, enter, leave };
}

// --- Carousel Lab card previews --------------------------------------
// Every other lab's cards show the effect they link to actually running,
// and these four now do the same with their own mechanism: a real Sweep,
// Reel, Deck and Dial, in the 86px band each card reserves for one (see
// .carousel-preview in style.css and the markup in index.body.html).
//
// Three options are shared by all four, and they are what make a carousel
// safe to nest inside another one:
//
//   - every input mode that has an option to turn it off, turned off. A
//     preview is a showcase, not a control, and a wheel or a drag over it
//     belongs to the homepage strip it is sitting in. The band is
//     `pointer-events: none`, which is what actually settles that - but an
//     option set honestly beats leaving one CSS line to keep two carousels
//     off the same gesture, so wheel, hover-follow and click-to-select are
//     all switched off at the source too. Dragging is the exception, and
//     the reason the CSS isn't belt and braces: only Deck has an option
//     for it (`drag: false`, set below), so on the other three
//     `pointer-events: none` is the only thing stopping a drag. Worth
//     knowing before removing that line.
//   - `autoplay` as the only thing that moves them, each at a different
//     interval so the four drift out of step with each other rather than
//     marching in lockstep the way one shared number would have them.
//     Each one pauses itself while the pointer rests on its card, off
//     screen, in a background tab, and under reduced motion - all of that
//     is in the shared timer (shared/carousel-kit.js), not here.
//   - tuned-down geometry. These boxes are a fraction of a demo page's, so
//     the cards have to come down with them: a tighter ring, a shallower
//     fade, no grown "selected" card on a disc whose cards are 20px tall.
//
// Claiming these elements here also keeps each effect's own blanket
// auto-init off them - it runs on DOMContentLoaded, after this file, and
// skips anything already initialized.
Sweep.initAll('.cp-strip', {
  // The one preview with two real ends, since a strip has nothing else on
  // offer: it walks to the last chip and reverses, which reads as the
  // mechanism being alive rather than as a reset.
  autoplay: 1900,
  autoplayEnd: 'bounce',
  cardStep: 90,
  minScale: 0.38,
  scaleDecay: 0.85,
  hoverFollow: false,
  wheelEnabled: false,
});
Reel.initAll('.cp-ring', {
  autoplay: 1500,
  loop: true,
  // A band this wide and short fits only a very flat ellipse of a ring,
  // and a flat ring is where Reel's one trick reads worst: the focused
  // card is pulled in to the center of the box while its neighbors sit out
  // on the ring below it, which on a full-size reel is the card being held
  // up to the eye, but with a handful of well-separated cards just looks
  // like the front one has been pushed back.
  //
  // What fixes it is density rather than geometry. Drawn in tight
  // (`ringSize`) with a small `cardAngle` and nothing faded out
  // (`maxDepth`), all eight cards stay on screen and overlap, each tucked
  // behind the one in front of it - so the focused card reads as the front
  // of a fan, which is what it is, and the small lift reads as depth
  // rather than as misalignment. A low `minScale` is the other half of it:
  // neighbors have to be visibly smaller, or nothing marks which card is
  // the one in focus.
  ringSize: 0.62,
  cardAngle: 30,
  minScale: 0.22,
  maxDepth: 0.95,
  clickToSelect: false,
  wheelEnabled: false,
});
Deck.initAll('.cp-deck', {
  // The View-Master arc: frames mounted on a disc whose pivot is off
  // screen below the band, swinging one out as the next swings in. It is
  // the transition that reads as a mechanism rather than as a cut at this
  // size - and the one that can't be scrubbed, which costs nothing on a
  // preview that takes no input anyway.
  transition: 'stereoscope',
  autoplay: 2300,
  duration: 560,
  arrows: false,
  dots: false,
  click: false,
  drag: false,
  wheel: false,
});
Dial.initAll('.cp-disc', {
  autoplay: 2100,
  loop: true,
  cardAngle: 30,
  // A fraction of the radius rather than pixels, so the cards stay seated
  // against the rim as the card (and so the disc) narrows - see the Dial
  // docs on why a fixed pixel margin doesn't scale down.
  rimInset: 0.12,
  // Nothing grows at the gate: at 20px tall the swell reads as a wobble,
  // and the rotation already marks which card is selected.
  selectedScale: 1,
  horizon: 80,
  fadeRange: 30,
  clickToSelect: false,
  wheelEnabled: false,
});

// Whether the OS has "reduce motion" set - shared by the Liftoff wiring
// below and the Transition Lab loop further down, both of which skip their
// own motion entirely in that case rather than just tuning it down.
const prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Liftoff: initialized on every .liftoff-card element, across every lab
// (see style.css for why each card needs its own inner wrapper rather
// than the anchor itself) using only its public API - hoverEvents:false
// skips its own native pointerenter/pointerleave/focusin/focusout
// binding, and .enter()/.leave() are called instead from bindHoverDelegate
// - same reasoning as the Transition Lab cards further down: the
// sweep's hover-follow slides a hovered card toward center under a
// stationary cursor, which would otherwise retrigger native hover on its
// own. Skipped under reduced motion, same as liftoff.js's own default
// auto-init and the Transition Lab loop below - otherwise these cards
// would lift/drift/tilt on hover regardless of the OS setting.
if (!prefersReducedMotion) {
  // These selectors match the Spotlight card too, and deliberately: it
  // opts out at the element instead, via `data-liftoff="off"` in
  // index.body.html (liftoff.js honors that in initAll - and has to,
  // since its own blanket auto-init would otherwise re-claim anything a
  // narrower selector here skipped). The card brings its own motion, and
  // stacking Liftoff's drift/tilt/dashes under a beam that is busy
  // tracking the card's exact rect reads as two effects arguing rather
  // than one. It still carries the .liftoff-card class - that's the
  // structural wrapper holding each card's chrome, and the selector the
  // hover delegate below is scoped to, not just an effect marker.
  //
  // The concept grid's own Liftoff card (the one linking through to the
  // Liftoff concept page itself) gets the classic profile - falling dashes
  // included - instead of the subdued HOMEPAGE_PRESET every other card
  // below uses, since this one card's job is to actually show what the
  // effect looks like. shadowAtRest stays off, same as the homepage preset,
  // so the card doesn't sit with a shadow while idle in the sweep.
  // Initializing it first claims the element so the broader initAll()
  // below (which skips already-initialized elements) leaves it alone.
  Liftoff.initAll('#conceptGrid .liftoff-card', { hoverEvents: false, shadowAtRest: false });
  Liftoff.initAll('.liftoff-card', { hoverEvents: false, ...Liftoff.HOMEPAGE_PRESET });

  // Spotlight: same hoverEvents:false/hover-delegate treatment as Liftoff
  // above, on the one concept-grid card that carries .spotlight-el.
  Spotlight.initAll('#conceptGrid .spotlight-el', { autoBind: false });

  // Every card in these grids now carries exactly one of the two effects,
  // so both lookups have to tolerate a miss: `.get()` returns null for the
  // Spotlight card's Liftoff, and for every other card's Spotlight.
  function liftoffOn(card, method) {
    const instance = Liftoff.get(card);
    if (instance) instance[method]();
  }

  // Raising the spotlit card above its sweep neighbours - see
  // style.css's .sweep .variation-card.is-spotlit rule for what goes
  // wrong without it. Kept here rather than inside spotlight.js on
  // purpose: the effect has no business knowing about this page's
  // sweep, and this is driven entirely through its public
  // enter/leave/amount surface. The class goes on the anchor, not the
  // card - the sweep writes a transform onto every .variation-card,
  // which makes it a stacking context its children can never escape.
  const SPOTLIT = 'is-spotlit';
  let spotlitHost = null;
  let spotlitRaf = null;

  function raiseSpotlit(host) {
    if (spotlitRaf) {
      cancelAnimationFrame(spotlitRaf);
      spotlitRaf = null;
    }
    if (spotlitHost && spotlitHost !== host) spotlitHost.classList.remove(SPOTLIT);
    spotlitHost = host;
    host.classList.add(SPOTLIT);
  }

  // Held until the light has actually gone, not dropped on leave(): the
  // effect eases out over its own `smoothing`, so releasing the card the
  // instant the pointer left would snap it back behind its neighbour with
  // the beam still visibly fading off it.
  function lowerSpotlitWhenDark(host, instance) {
    if (host !== spotlitHost || spotlitRaf) return;
    const step = () => {
      if (instance.amount > 0.002) {
        spotlitRaf = requestAnimationFrame(step);
        return;
      }
      host.classList.remove(SPOTLIT);
      if (spotlitHost === host) spotlitHost = null;
      spotlitRaf = null;
    };
    spotlitRaf = requestAnimationFrame(step);
  }

  function spotlightOn(card, method) {
    const instance = Spotlight.get(card);
    if (!instance) return;
    instance[method]();

    const host = card.closest('.variation-card');
    if (!host) return;
    if (method === 'enter') raiseSpotlit(host);
    else lowerSpotlitWhenDark(host, instance);
  }

  // The Flip Dots card's own hover response (see the Components Lab block
  // above for what it does). Scoped by element rather than by a `.get()`
  // miss like the two above, since there is only ever one board on this
  // page and it is not an effect that every card could carry.
  function flipDotsOn(card, method) {
    if (!flipDotsHover || card !== flipDotsHover.el) return;
    flipDotsHover[method]();
  }

  // Every homepage hover/focus-reactive effect a card can carry, so adding
  // one only means adding it here instead of hunting down every hover/focus
  // call site below.
  const HOVER_EFFECTS = [liftoffOn, spotlightOn, flipDotsOn];
  function hoverPopOn(card, method) {
    HOVER_EFFECTS.forEach((effectOn) => effectOn(card, method));
  }

  // One delegate per sweep track (bindHoverDelegate is scoped to a
  // single container) resolving each hovered .liftoff-card to its own
  // Liftoff (and, where present, Spotlight) instance via .get() -
  // Transition Lab's transitionGrid gets one too, entirely independent of
  // that grid's own cover/reveal hover delegate further down.
  ['variationGrid', 'backgroundGrid', 'transitionGrid', 'conceptGrid', 'carouselLabGrid', 'componentsGrid'].forEach((gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    bindHoverDelegate(grid, '.liftoff-card', (el, prevEl) => {
      if (prevEl) hoverPopOn(prevEl, 'leave');
      if (el) hoverPopOn(el, 'enter');
    });
    // hoverEvents:false above also skips LiftoffCard's own native
    // focusin/focusout binding, so keyboard focus is wired here to give
    // it the same lift/drift/tilt feedback mouse hover gets. Focus lands
    // on the anchor (.liftoff-card is its non-focusable child wrapper -
    // see style.css), so each handler looks the card up from there.
    grid.addEventListener('focusin', (event) => {
      const card = event.target.querySelector && event.target.querySelector('.liftoff-card');
      if (!card) return;
      hoverPopOn(card, 'enter');
    });
    grid.addEventListener('focusout', (event) => {
      const card = event.target.querySelector && event.target.querySelector('.liftoff-card');
      if (!card) return;
      hoverPopOn(card, 'leave');
    });
  });
}

// Transition Lab cards: loop each card's own engine (cover -> reveal, the
// same cover/reveal the click-through demo pages use, minus any content
// swap) directly on the card element instead of the whole page - a small
// always-playing preview of what clicking through actually looks like.
// Skipped under reduced motion: cover()/reveal() still resolve
// (near-)instantly in that case (see shutter.js/aperture.js), which
// without this guard would just spin the loop as fast as JS allows
// instead of showing anything.
if (!prefersReducedMotion) {
  const TRANSITION_LOOP_MIN_PAUSE_MS = 3000;
  const TRANSITION_LOOP_MAX_PAUSE_MS = 6000;
  function randomTransitionPause() {
    return TRANSITION_LOOP_MIN_PAUSE_MS + Math.random() * (TRANSITION_LOOP_MAX_PAUSE_MS - TRANSITION_LOOP_MIN_PAUSE_MS);
  }
  // card element -> { enter, leave }, filled in below and driven by the
  // delegated mousemove tracker underneath it instead of each card's own
  // mouseenter/mouseleave - see that tracker for why.
  const transitionCards = new Map();
  Array.from(document.querySelectorAll('#transitionGrid .variation-card[data-t-transition]')).forEach((card) => {
    const engine = window.Transitions && window.Transitions[card.dataset.tTransition];
    if (!engine) return;
    // Covers the card's .liftoff-card wrapper, not the anchor (`card`
    // itself) - see style.css's Liftoff comment: the anchor is an
    // invisible, sweep-owned hit box, so the cover/reveal motion has to
    // target the same wrapper that carries the card's actual chrome in
    // order to lift along with it instead of staying flat on the page.
    const surface = card.querySelector('.liftoff-card');
    if (!surface) return;
    surface.classList.add('t-el');
    // Card is too small for scanlines to read as anything but noise —
    // Static's own option, ignored by engines that don't have one.
    const overrides = card.dataset.tTransition === 'static' ? { scanlines: false } : undefined;
    // Hovering commandeers the card's own cover()/reveal() calls rather
    // than reaching into shutter.js/aperture.js: cover()/reveal() are
    // built so a newer call on the same target supersedes an in-flight one
    // instead of fighting it (see their "gen" comments) - the CSS
    // transition just retargets from wherever it currently sits. So
    // enter()'s cover() closes it (or, mid-reveal, reverses it closed
    // from wherever it got to) and holds it there since nothing schedules
    // a follow-up reveal while hovering; leave()'s reveal() reopens it
    // and hands the loop its next cycle.
    //
    // Borrows that same "gen" idea for the loop wrapper itself: enter()
    // can land while a natural cycle()'s cover()->reveal() promise chain
    // is still in flight (now routine, since the sweep's hover-follow
    // fires enter/leave far more often than a one-off manual hover did).
    // Without a generation check, that stale chain keeps running after
    // enter() takes over and, if hovering has already ended again by the
    // time its `.then`s resolve, calls its own reveal()/scheduleCycle()
    // alongside the one leave() already started - two loop chains now
    // ticking independently, which reads as the cycle suddenly running
    // too fast. Bumping `gen` on every enter() and having each chain
    // check it's still current before acting keeps exactly one chain
    // alive at a time.
    let hovering = false;
    let pendingCycle = null;
    let gen = 0;
    // Each card re-rolls its own random pause after every cycle, so the
    // cards drift in and out of sync with each other instead of the fixed
    // lockstep a shared interval would give.
    function scheduleCycle(myGen) {
      if (pendingCycle) clearTimeout(pendingCycle);
      pendingCycle = setTimeout(() => cycle(myGen), randomTransitionPause());
    }
    function cycle(myGen) {
      if (hovering || myGen !== gen) return;
      engine.cover(surface, overrides)
        .then(() => { if (!hovering && myGen === gen) return engine.reveal(surface, overrides); })
        .then(() => { if (!hovering && myGen === gen) scheduleCycle(myGen); });
    }
    transitionCards.set(card, {
      enter() {
        if (hovering) return;
        hovering = true;
        gen++;
        if (pendingCycle) {
          clearTimeout(pendingCycle);
          pendingCycle = null;
        }
        engine.cover(surface, overrides);
      },
      leave() {
        if (!hovering) return;
        hovering = false;
        const myGen = gen;
        engine.reveal(surface, overrides).then(() => { if (myGen === gen) scheduleCycle(myGen); });
      },
    });
    scheduleCycle(gen);
  });

  // See shared/hover-delegate.js: the Transition Lab sweep's own
  // hover-follow (see sweep.js) animates cards by sliding them under
  // the pointer, which needs this same mousemove-based delegation instead
  // of each card's own mouseenter/mouseleave to avoid sending this loop's
  // cover/reveal rapidly back and forth as cards slide underneath a
  // stationary cursor.
  const transitionGrid = document.getElementById('transitionGrid');
  if (transitionGrid) {
    bindHoverDelegate(transitionGrid, '.variation-card', (card, prevCard) => {
      if (prevCard && transitionCards.has(prevCard)) transitionCards.get(prevCard).leave();
      if (card && transitionCards.has(card)) transitionCards.get(card).enter();
    });
  }
}

// Remembers how far down the homepage the user had scrolled, so following a
// card through to an effect page and then back via the nav's Home link
// (a normal navigation, not a back-button one - the browser's own scroll
// restoration doesn't apply here) doesn't dump them back at the top. Same
// sessionStorage-per-tab approach as the position caching in sweep.js -
// fades once the tab/session ends rather than sticking around
// indefinitely. Restored here at the end of the script, after every card
// preview above has finished initializing, so nothing still to come can
// shift the page's height out from under the restored position.
const HOME_SCROLL_KEY = 'home-scroll-y';

try {
  const raw = sessionStorage.getItem(HOME_SCROLL_KEY);
  const storedScrollY = raw === null ? null : parseFloat(raw);
  if (Number.isFinite(storedScrollY)) window.scrollTo(0, storedScrollY);
} catch (e) {
  // Ignore (e.g. storage disabled) - just starts at the top as before.
}

let scrollSaveScheduled = false;
function saveHomeScrollY() {
  scrollSaveScheduled = false;
  try {
    sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY));
  } catch (e) {
    // Ignore (e.g. storage disabled/full) - just means it won't persist.
  }
}
window.addEventListener('scroll', () => {
  if (scrollSaveScheduled) return;
  scrollSaveScheduled = true;
  requestAnimationFrame(saveHomeScrollY);
}, { passive: true });
window.addEventListener('pagehide', saveHomeScrollY);
