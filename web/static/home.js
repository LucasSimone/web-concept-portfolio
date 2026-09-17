/**
 * Home page wiring: carousel filters, the axis/progress-driver adapters
 * that let carousel wheel/drag input stand in for each effect's normal
 * scroll input, and the per-effect initAll() calls tuned for card size.
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

const variationCarousel = new Carousel(document.getElementById('variationCarousel'));
const conceptCarousel = new Carousel(document.getElementById('conceptCarousel'));
new Carousel(document.getElementById('transitionCarousel'));
new Carousel(document.getElementById('backgroundCarousel'));

setupFilter('typeFilter', 'variationGrid', () => variationCarousel.refresh());
setupFilter('conceptTypeFilter', 'conceptGrid', () => conceptCarousel.refresh());

// Tracks a horizontal pointer drag starting on `carouselEl` and calls
// `onDelta(dx)` with each frame's movement in px (negative = dragged
// left) - the drag half of "wheel or drag over the carousel drives
// whatever's currently on screen", shared by every carousel-driven card
// below. pointermove/pointerup listen on window rather than carouselEl so
// a drag keeps tracking even if the pointer slides off the carousel
// mid-drag.
function bindCarouselDrag(carouselEl, onDelta) {
  let dragging = false;
  let lastX = 0;

  carouselEl.addEventListener('pointerdown', (event) => {
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
// carousel itself, we temporarily switch it to the horizontal profile
// and drive the offset directly from that wheel/drag input instead —
// then revert to vertical once carousel input goes idle.
function bindCarouselAxisSwitch(carouselEl, instance, verticalProfile, horizontalProfile) {
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

  carouselEl.addEventListener('wheel', (event) => {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    nudge(raw);
  }, { passive: true });

  bindCarouselDrag(carouselEl, (dx) => nudge(-dx * DRAG_SCALE));
}

// In Flight Out and Type Pan Vertical normally derive their progress
// (0-1) from the element's position in the viewport as the page
// scrolls. On these cards that's disabled entirely (see below) and
// progress is driven only by wheel/drag input on the carousel itself,
// easing back to a resting value once that input goes idle.
function bindCarouselProgressDriver(carouselEl, instance, options = {}) {
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

  carouselEl.addEventListener('wheel', (event) => {
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    nudge(raw * sensitivity);
  }, { passive: true });

  bindCarouselDrag(carouselEl, (dx) => nudge(-dx * dragSensitivity));

  setProgress(restProgress);
}

const DOUBLE_SPEAK_VERTICAL = { offsetX: 0, offsetY: 14, lag: 0.15, opacity: 0.5 };
const DOUBLE_SPEAK_HORIZONTAL = { offsetX: 14, offsetY: 0, lag: 0.15, opacity: 0.5 };
const [doubleSpeakCard] = DoubleSpeak.initAll('.variation-card h2.double-speak', DOUBLE_SPEAK_VERTICAL);
if (doubleSpeakCard) {
  bindCarouselAxisSwitch(variationCarousel.root, doubleSpeakCard, DOUBLE_SPEAK_VERTICAL, DOUBLE_SPEAK_HORIZONTAL);
}

const TRIPLE_VISION_VERTICAL = { offsetX: 0, offsetY: 100, lag: 0.15, opacity: 0.6 };
const TRIPLE_VISION_HORIZONTAL = { offsetX: 100, offsetY: 0, lag: 0.15, opacity: 0.6 };
const [tripleVisionCard] = TripleVisionText.initAll('.variation-card h2.triple-vision', TRIPLE_VISION_VERTICAL);
if (tripleVisionCard) {
  bindCarouselAxisSwitch(variationCarousel.root, tripleVisionCard, TRIPLE_VISION_VERTICAL, TRIPLE_VISION_HORIZONTAL);
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
// document.body and so isn't contained by the carousel's own stacking
// context - doesn't paint on top of the nav once the carousel scrolls
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
  bindCarouselProgressDriver(variationCarousel.root, inFlightOutCard, { restProgress: 0.5 });
}

// Type Pan normally types from real page scroll position. That's replaced
// here with the same carousel-driven progress approach as the other cards.
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
  bindCarouselProgressDriver(variationCarousel.root, typePanCard, {
    restProgress: 1,
    set: (value) => typePanCard.pushProgress(value),
  });
}
// Wheel input needs no custom wiring at all: 'hover' driveMode is
// Rolodex's own built-in way to take input from wheel/trackpad over some
// other element instead of page scroll (see rolodex.js), and the carousel
// is tagged data-rolodex-hover="rolodexCardTitle" in index.body.html to be
// that element. loopScroll makes the word list circular (wheeling past
// the last word flips straight into the first instead of stopping), loop
// keeps it cycling on its own once the carousel goes idle - same as any
// other page using the effect, just fed by the carousel instead of the
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
  bindCarouselDrag(variationCarousel.root, (dx) => {
    rolodexCard.pushProgress(rolodexCard._progress - dx / ROLODEX_DRAG_DISTANCE);
  });

  // Once this card settles into focus (see the 'carousel-settle' event on
  // Carousel), flip it back to its opening word - so browsing away and
  // back always finds it freshly reset rather than wherever a previous
  // visit left it.
  rolodexCard.el.closest('.variation-card').addEventListener('carousel-settle', () => {
    rolodexCard.goTo(0);
  });
}
CircuitBoard.initAll('.variation-card.bg-circuit-board', {
  maxTraces: 30, cell: 20, speed: 30,
});
GravityWell.initAll('.variation-card.bg-gravity-well', {
  cell: 20, radius: 110, strength: 40,
});
Vacuum.initAll('.variation-card.bg-vacuum', {
  radius: 90, density: 8, maxParticles: 80,
});

// Transition Lab cards: loop each card's own engine (cover -> reveal, the
// same cover/reveal the click-through demo pages use, minus any content
// swap) directly on the card element instead of the whole page - a small
// always-playing preview of what clicking through actually looks like,
// same spirit as Intertwine's own looping card preview above. Skipped
// under reduced motion: cover()/reveal() still resolve (near-)instantly in
// that case (see shutter.js/aperture.js), which without this guard would
// just spin the loop as fast as JS allows instead of showing anything.
if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
  const TRANSITION_LOOP_MIN_PAUSE_MS = 1500;
  const TRANSITION_LOOP_MAX_PAUSE_MS = 6000;
  function randomTransitionPause() {
    return TRANSITION_LOOP_MIN_PAUSE_MS + Math.random() * (TRANSITION_LOOP_MAX_PAUSE_MS - TRANSITION_LOOP_MIN_PAUSE_MS);
  }
  Array.from(document.querySelectorAll('#transitionGrid .variation-card[data-t-transition]')).forEach((card) => {
    const engine = window.Transitions && window.Transitions[card.dataset.tTransition];
    if (!engine) return;
    card.classList.add('t-el');
    // Hovering commandeers the card's own cover()/reveal() calls rather
    // than reaching into shutter.js/aperture.js: cover()/reveal() are
    // built so a newer call on the same target supersedes an in-flight one
    // instead of fighting it (see their "gen" comments) - the CSS
    // transition just retargets from wherever it currently sits. So
    // mouseenter's cover() closes it (or, mid-reveal, reverses it closed
    // from wherever it got to) and holds it there since nothing schedules
    // a follow-up reveal while hovering; mouseleave's reveal() reopens it
    // and hands the loop its next cycle.
    let hovering = false;
    let pendingCycle = null;
    // Each card re-rolls its own random pause after every cycle, so the
    // cards drift in and out of sync with each other instead of the fixed
    // lockstep a shared interval would give.
    function scheduleCycle() {
      pendingCycle = setTimeout(cycle, randomTransitionPause());
    }
    function cycle() {
      if (hovering) return;
      engine.cover(card)
        .then(() => { if (!hovering) return engine.reveal(card); })
        .then(() => { if (!hovering) scheduleCycle(); });
    }
    card.addEventListener('mouseenter', () => {
      hovering = true;
      if (pendingCycle) {
        clearTimeout(pendingCycle);
        pendingCycle = null;
      }
      engine.cover(card);
    });
    card.addEventListener('mouseleave', () => {
      hovering = false;
      engine.reveal(card).then(scheduleCycle);
    });
    scheduleCycle();
  });
}

// Remembers how far down the homepage the user had scrolled, so following a
// card through to an effect page and then back via the nav's Home link
// (a normal navigation, not a back-button one - the browser's own scroll
// restoration doesn't apply here) doesn't dump them back at the top. Same
// sessionStorage-per-tab approach as the carousel position caching in
// carousel.js - fades once the tab/session ends rather than sticking around
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
