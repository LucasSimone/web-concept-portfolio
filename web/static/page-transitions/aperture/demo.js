document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const blades = document.getElementById('ptBlades');
  const bladesVal = document.getElementById('ptBladesVal');
  const styleButtons = Array.from(document.querySelectorAll('[data-style-group] .pt-style-btn'));
  const panelSwatches = Array.from(document.querySelectorAll('[data-swatch-group="panel"] .pt-swatch'));
  const lineSwatches = Array.from(document.querySelectorAll('[data-swatch-group="line"] .pt-swatch'));

  // Remembers the last values chosen on EITHER demo page, so arriving on
  // the other one shows the same settings instead of resetting to
  // defaults. Separate from aperture.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 'pt-aperture-demo-controls';

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
        blades: blades.value,
        style: link.dataset.ptStyle,
        color: link.dataset.ptColor,
        lineColor: link.dataset.ptLineColor,
      }));
    } catch (e) {}
  }

  function selectSwatch(list, color, datasetKey) {
    const match = list.find((b) => b.dataset.color === color) || list[0];
    list.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset[datasetKey] = match.dataset.color;
  }

  function selectStyle(style) {
    const match = styleButtons.find((b) => b.dataset.style === style) || styleButtons[0];
    styleButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.ptStyle = match.dataset.style;
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

  function syncBlades() {
    link.dataset.ptBlades = blades.value;
    bladesVal.textContent = blades.value;
    save();
  }

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  blades.addEventListener('input', syncBlades);

  panelSwatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectSwatch(panelSwatches, btn.dataset.color, 'ptColor');
      save();
    });
  });
  lineSwatches.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectSwatch(lineSwatches, btn.dataset.color, 'ptLineColor');
      save();
    });
  });
  styleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectStyle(btn.dataset.style);
      save();
    });
  });

  const saved = loadSaved();
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    blades.value = saved.blades || 8;
    selectStyle(saved.style);
    selectSwatch(panelSwatches, saved.color, 'ptColor');
    selectSwatch(lineSwatches, saved.lineColor, 'ptLineColor');
  } else {
    selectStyle(styleButtons.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.style);
    selectSwatch(panelSwatches, panelSwatches.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.color, 'ptColor');
    selectSwatch(lineSwatches, lineSwatches.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.color, 'ptLineColor');
  }
  syncDuration();
  syncEasing();
  syncBlades();
});
