// A transition of this page's own, registered at load - before deck.js's
// auto-init runs on DOMContentLoaded, which is why the markup can ask for it by
// name in data-transition exactly like a built-in. This is the entire public
// surface for extending the component.
Deck.transitions.flip = {
  scrub: true,
  cull: 1.05,
  defaults: { flipTilt: 90 },
  measure(ctx, frames) {
    ctx.port.style.perspective = `${Math.round(ctx.w * 2)}px`;
    frames.forEach((f) => { f.style.transformOrigin = '50% 50%'; });
  },
  style(frame, delta, ctx) {
    frame.style.transform =
      `rotateX(${(-delta * ctx.options.flipTilt).toFixed(2)}deg)`
      + ` translate3d(0, ${(delta * 100).toFixed(2)}%, 0)`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  // deck.js's own auto-init already claimed every deck on the page by the time
  // this runs (its DOMContentLoaded listener is registered first, since this
  // file loads after it) - this is just a defensive fallback. Note what that
  // means for most of this page: the six-transition row, the custom-transition
  // deck, the content frames and two of the three sizing decks take no options
  // at all, only markup.
  Deck.initAll();

  // The round one in the sizing grid runs itself.
  const square = Deck.get('#deckSquare');
  if (square) square.update({ autoplay: 2600 });

  // Cards on the page rather than in a box. --dk-body and the shadow are this
  // page's CSS; `clip` is the one option involved, and it's off because an
  // unclipped box is the whole point of the look.
  const loose = Deck.get('#deckLoose');
  if (loose) loose.update({ clip: false, bounce: 0.35 });

  // The deck driven by this page's own rail: the built-in arrows and dots are
  // switched off, and everything that advances it is markup in index.body.html
  // (data-deck-to / data-deck-prev / data-deck-next / data-deck-lever).
  const custom = Deck.get('#deckCustom');
  if (custom) custom.update({ arrows: false, dots: false, lever: false });

  const deck = Deck.get('#deckDemo');
  if (!deck) return;

  // --- The caption under the hero deck ---------------------------------
  // Driven entirely by the bubbling deck-settle event rather than by polling
  // position: it fires once a frame is actually parked, not for every frame
  // passed on the way there.
  const TITLES = [
    'The Aperture',
    'Long Horizon',
    'Ridge Line',
    'Strata',
    'Shore Ripples',
    'Ringed World',
    'Halftone Sky',
  ];
  const countEl = document.getElementById('deckCount');
  const titleEl = document.getElementById('deckTitle');
  const root = document.getElementById('deckDemo');

  function writePlate(index, total) {
    countEl.textContent = `${pad(index + 1)} / ${pad(total)}`;
    titleEl.textContent = TITLES[index] || `Frame ${index + 1}`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  root.addEventListener('deck-settle', (event) => {
    const frames = Array.from(root.querySelectorAll('.deck-frame')).filter((el) => !el.hidden);
    writePlate(frames.indexOf(event.target), frames.length);
  });

  // --- Frame count -----------------------------------------------------
  // Frames 1-7 are the curated ones authored in index.body.html. Past that,
  // extras reuse the same artwork and are created lazily the first time the
  // slider asks for more than have existed so far, never destroyed afterward.
  const port = root.querySelector('.deck-port');
  const curatedFrames = Array.from(port.querySelectorAll('.deck-frame'));
  const extraFrames = [];

  function applyFrameCount(count) {
    curatedFrames.forEach((frame, i) => { frame.hidden = i >= count; });

    const neededExtras = Math.max(0, count - curatedFrames.length);
    while (extraFrames.length < neededExtras) {
      const n = curatedFrames.length + extraFrames.length;
      const frame = document.createElement('div');
      frame.className = `deck-frame dk-slide dk-art--${(n % curatedFrames.length) + 1}`;
      // Ahead of the glare overlay when there is one, so it stays on top.
      port.insertBefore(frame, port.querySelector('.deck-glare'));
      extraFrames.push(frame);
    }
    extraFrames.forEach((frame, i) => { frame.hidden = i >= neededExtras; });

    deck.refresh();
    document.getElementById('frameCountVal').textContent = String(count);
    writePlate(Math.max(0, deck.index), count);
  }

  // --- Control panel ---------------------------------------------------
  const controls = {
    transition: document.getElementById('transitionSelect'),
    frameCount: document.getElementById('frameCountRange'),
    maxWidth: document.getElementById('maxWidthRange'),
    aspect: document.getElementById('aspectSelect'),
    body: document.getElementById('bodySelect'),
    duration: document.getElementById('durationRange'),
    bounce: document.getElementById('bounceRange'),
    autoplay: document.getElementById('autoplayRange'),
    autoplayEnd: document.getElementById('autoplayEndSelect'),
    mask: document.getElementById('maskSelect'),
    wheel: document.getElementById('wheelSelect'),
    loop: document.getElementById('loopCheckbox'),
    arrows: document.getElementById('arrowsCheckbox'),
    dots: document.getElementById('dotsCheckbox'),
    click: document.getElementById('clickCheckbox'),
    drag: document.getElementById('dragCheckbox'),
    clip: document.getElementById('clipCheckbox'),
    lever: document.getElementById('leverCheckbox'),
    glare: document.getElementById('glareCheckbox'),
  };

  // Options the *core* owns - every transition has them. Note the third
  // slot here is a *formatter* for the readout, not the value transform
  // that shared/demo-shared.js's `numeric` tables carry in that position:
  // this panel has no Profile preset, so it never goes through
  // applyProfileFromTable. Wiring one up would mean splitting the two
  // apart first, or it would call update({ duration: '320ms' }).
  const numeric = [
    ['duration', 'duration', (v) => `${v}ms`],
    ['bounce', 'bounce', (v) => v.toFixed(2)],
    ['autoplay', 'autoplay', (v) => (v === 0 ? 'Off' : `${v}ms`)],
  ];
  const toggles = ['loop', 'arrows', 'dots', 'click', 'drag', 'clip', 'lever', 'glare'];

  // Options a *transition* owns. Only the rows belonging to the running
  // transition are shown, and their values are re-read from the deck whenever
  // it changes - because switching transitions re-seeds its own defaults.
  const transitionRows = [
    ['gap', (v) => v.toFixed(2)],
    ['arc', (v) => v.toFixed(2)],
    ['zoomScale', (v) => v.toFixed(2)],
    ['stackInset', (v) => v.toFixed(2)],
    ['stackScale', (v) => v.toFixed(3)],
    ['stackOffset', (v) => `${v}%`],
    ['flipTilt', (v) => `${v}°`],
  ];

  function rowFor(key) {
    return {
      row: document.querySelector(`.control-row[data-option="${key}"]`),
      input: document.getElementById(`${key}Range`),
      out: document.getElementById(`${key}Val`),
    };
  }

  function syncTransitionRows() {
    const definition = Deck.transitions[deck.transition];
    const owned = Object.keys((definition && definition.defaults) || {});
    transitionRows.forEach(([key, format]) => {
      const { row, input, out } = rowFor(key);
      const mine = owned.indexOf(key) !== -1;
      row.hidden = !mine;
      if (!mine) return;
      input.value = deck.options[key];
      out.textContent = format(Number(input.value));
    });
    document.getElementById('transitionGroup').hidden = owned.length === 0;
    document.getElementById('scrubBadge').textContent =
      definition && definition.scrub === false ? '· ratchets' : '· scrubs';
  }

  transitionRows.forEach(([key, format]) => {
    const { input, out } = rowFor(key);
    input.addEventListener('input', () => {
      deck.update({ [key]: Number(input.value) });
      out.textContent = format(Number(input.value));
    });
  });

  numeric.forEach(([key, option, format]) => {
    controls[key].addEventListener('input', () => {
      const value = Number(controls[key].value);
      deck.update({ [option]: value });
      document.getElementById(`${key}Val`).textContent = format(value);
    });
  });

  toggles.forEach((key) => {
    controls[key].addEventListener('change', () => {
      deck.update({ [key]: controls[key].checked });
    });
  });

  controls.mask.addEventListener('change', () => deck.update({ mask: controls.mask.value }));
  controls.autoplayEnd.addEventListener('change', () => deck.update({
    autoplayEnd: controls.autoplayEnd.value,
  }));
  controls.wheel.addEventListener('change', () => deck.update({
    wheel: controls.wheel.value === 'off' ? false : controls.wheel.value,
  }));

  controls.transition.addEventListener('change', () => {
    deck.update({ transition: controls.transition.value });
    syncTransitionRows();
  });

  // These three aren't options at all: size and background are custom
  // properties, so they're something the *page* sets. The panel changes exactly
  // the values a stylesheet would.
  function applyPageStyle() {
    root.style.maxWidth = `${controls.maxWidth.value}px`;
    root.style.setProperty('--dk-aspect', controls.aspect.value);
    root.style.setProperty('--dk-body', controls.body.value);
    document.getElementById('maxWidthVal').textContent = `${controls.maxWidth.value}px`;
  }

  controls.maxWidth.addEventListener('input', applyPageStyle);
  controls.aspect.addEventListener('change', applyPageStyle);
  controls.body.addEventListener('change', applyPageStyle);
  controls.frameCount.addEventListener('input', () => {
    applyFrameCount(Number(controls.frameCount.value));
  });

  function syncCoreLabels() {
    numeric.forEach(([key, , format]) => {
      document.getElementById(`${key}Val`).textContent = format(Number(controls[key].value));
    });
  }

  applyPageStyle();
  syncCoreLabels();
  syncTransitionRows();
  applyFrameCount(Number(controls.frameCount.value));
});
