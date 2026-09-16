document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const swatches = Array.from(document.querySelectorAll('.pt-swatch'));

  // Remembers the last values chosen on EITHER demo page, so arriving on
  // the other one shows the same settings instead of resetting to
  // defaults. Separate from shutter.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 'pt-shutter-demo-controls';

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
        color: link.dataset.ptColor,
      }));
    } catch (e) {}
  }

  function selectSwatch(color) {
    const match = swatches.find((b) => b.dataset.color === color) || swatches[0];
    swatches.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.ptColor = match.dataset.color;
  }

  function syncDuration() {
    link.dataset.ptDuration = duration.value;
    durationVal.textContent = `${duration.value}ms`;
    save();
  }

  function syncEasing() {
    link.dataset.ptEasing = easing.value;
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

  const saved = loadSaved();
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    selectSwatch(saved.color);
  } else {
    selectSwatch(swatches.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.color);
  }
  syncDuration();
  syncEasing();
});
