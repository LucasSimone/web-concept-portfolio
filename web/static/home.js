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
new Carousel(document.getElementById('animationCarousel'));
new Carousel(document.getElementById('backgroundCarousel'));

setupFilter('typeFilter', 'variationGrid', () => variationCarousel.refresh());
setupFilter('conceptTypeFilter', 'conceptGrid', () => conceptCarousel.refresh());

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
  let dragging = false;
  let lastX = 0;

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

  carouselEl.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    nudge(-dx * DRAG_SCALE);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
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
  let dragging = false;
  let lastX = 0;

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

  carouselEl.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    nudge(-dx * dragSensitivity);
  });
  window.addEventListener('pointerup', () => { dragging = false; });

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
PaintDrag.initAll('.variation-card h2.paint-drag', {
  smearLength: 0, spread: 0, blur: 2, fadeTime: 0.1, density: 0,
});
const [inFlightOutCard] = InFlightOut.initAll('.variation-card h2.in-flight-out', {
  scatter: 0.45, maxDistance: 60, rotation: 0.4, maxAngle: 40,
});
if (inFlightOutCard) {
  window.removeEventListener('scroll', inFlightOutCard._onScroll);
  window.removeEventListener('resize', inFlightOutCard._onScroll);
  bindCarouselProgressDriver(variationCarousel.root, inFlightOutCard, { restProgress: 0.5 });
}

const [typePanVerticalCard] = TypePanVertical.initAll('.variation-card h2.type-pan-vertical', {
  panPosition: 0.6, lag: 0.18,
});
if (typePanVerticalCard) {
  window.removeEventListener('scroll', typePanVerticalCard._onScroll);
  window.removeEventListener('resize', typePanVerticalCard._onScroll);
  bindCarouselProgressDriver(variationCarousel.root, typePanVerticalCard, { restProgress: 1 });

  // The window's height (minus the title bar) is the line's vertical
  // travel range: progress 0 sits at the bottom, progress 1 at the top.
  const stageEl = typePanVerticalCard.el.closest('.type-pan-vertical-window')
    .querySelector('.type-pan-vertical-stage');
  (function syncVerticalPosition() {
    const travel = Math.max(0, stageEl.clientHeight - typePanVerticalCard.el.offsetHeight);
    const y = (1 - typePanVerticalCard._progress) * travel;
    typePanVerticalCard.el.style.transform = `translateY(${y.toFixed(1)}px)`;
    requestAnimationFrame(syncVerticalPosition);
  })();
}
// Type Pan Horizontal normally types from wheel input captured right on
// its own title. That's replaced here with the same carousel-driven
// progress approach as Type Pan Vertical, just mapped onto its
// pixel-based typed length instead of a 0-1 progress field.
const [typePanHorizontalCard] = TypePanHorizontal.initAll('.variation-card h2.type-pan', {
  sensitivity: 1, panPosition: 0.75,
});
if (typePanHorizontalCard) {
  typePanHorizontalCard.el.removeEventListener('wheel', typePanHorizontalCard._onWheel);
  bindCarouselProgressDriver(variationCarousel.root, typePanHorizontalCard, {
    restProgress: 1,
    get: () => typePanHorizontalCard._typedPx / (typePanHorizontalCard._totalWidth || 1),
    set: (value) => {
      const px = value * (typePanHorizontalCard._totalWidth || 0);
      typePanHorizontalCard._typedPx = px;
      typePanHorizontalCard._maxTypedPx = Math.max(typePanHorizontalCard._maxTypedPx, px);
    },
  });
}
const [rolodexCard] = Rolodex.initAll('.variation-card h2.rolodex', {
  mode: 'split-flap', flipWidth: 55, perspective: 900, shading: 0.05,
});
if (rolodexCard) {
  window.removeEventListener('scroll', rolodexCard._onScroll);
  window.removeEventListener('resize', rolodexCard._onResize);
  bindCarouselProgressDriver(variationCarousel.root, rolodexCard, { restProgress: 0.1 });
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
