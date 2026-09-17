document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const variantButtons = Array.from(document.querySelectorAll('[data-variant-group] .t-style-btn'));
  const swatches = Array.from(document.querySelectorAll('.t-swatch'));

  // The "Click me" box below the main link — a small live example of
  // Shutter transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  function toggleElementDemo() {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    Transitions.shutter.play(elementDemo, {
      duration: Number(link.dataset.tDuration),
      easing: link.dataset.tEasing,
      color: link.dataset.tColor,
      variant: link.dataset.tVariant,
      swap: (el) => { el.textContent = nextText; },
    });
  }
  elementDemo.addEventListener('click', toggleElementDemo);
  elementDemo.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleElementDemo();
  });

  // Remembers the last values chosen on EITHER demo page, so arriving on
  // the other one shows the same settings instead of resetting to
  // defaults. Separate from shutter.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-shutter-demo-controls';

  function loadSaved() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: duration.value,
        easing: easing.value,
        variant: link.dataset.tVariant,
        color: link.dataset.tColor,
      }));
    } catch (e) {}
  }

  function selectSwatch(color) {
    const match = swatches.find((b) => b.dataset.color === color) || swatches[0];
    swatches.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.tColor = match.dataset.color;
  }

  function selectVariant(variant) {
    const match = variantButtons.find((b) => b.dataset.variant === variant) || variantButtons[0];
    variantButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.tVariant = match.dataset.variant;
  }

  function syncDuration() {
    link.dataset.tDuration = duration.value;
    durationVal.textContent = `${duration.value}ms`;
    save();
  }

  function syncEasing() {
    link.dataset.tEasing = easing.value;
    save();
  }

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);

  swatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectSwatch(btn.dataset.color);
      save();
    });
  });

  variantButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectVariant(btn.dataset.variant);
      save();
    });
  });

  const saved = loadSaved();
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    selectVariant(saved.variant || 'split');
    selectSwatch(saved.color);
  } else {
    selectVariant(variantButtons.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.variant);
    selectSwatch(swatches.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.color);
  }
  syncDuration();
  syncEasing();
});
