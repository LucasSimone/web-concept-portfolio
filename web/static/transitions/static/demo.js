document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const grain = document.getElementById('ptGrain');
  const grainVal = document.getElementById('ptGrainVal');
  const tint = document.getElementById('ptTint');
  const scanlines = document.getElementById('ptScanlines');
  const scanlineSpacing = document.getElementById('ptScanlineSpacing');
  const scanlineSpacingVal = document.getElementById('ptScanlineSpacingVal');
  const scanlineThickness = document.getElementById('ptScanlineThickness');
  const scanlineThicknessVal = document.getElementById('ptScanlineThicknessVal');
  const scanlineBlur = document.getElementById('ptScanlineBlur');

  // The "Click me" box below the main link — a small live example of
  // Static transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  function toggleElementDemo() {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    Transitions.static.play(elementDemo, {
      duration: Number(link.dataset.tDuration),
      easing: link.dataset.tEasing,
      color: link.dataset.tColor,
      grain: Number(link.dataset.tGrain),
      // Too small a box for scanlines to read as anything but noise —
      // always off here regardless of what the controls panel has set.
      scanlines: false,
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
  // defaults. Separate from static.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-static-demo-controls';

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: duration.value,
        easing: easing.value,
        grain: grain.value,
        color: link.dataset.tColor,
        scanlines: scanlines.checked,
        scanlineSpacing: scanlineSpacing.value,
        scanlineThickness: scanlineThickness.value,
        scanlineBlur: scanlineBlur.checked,
      }));
    } catch (e) {}
  }

  function syncTint() {
    link.dataset.tColor = tint.value;
    save();
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

  function syncGrain() {
    link.dataset.tGrain = grain.value;
    grainVal.textContent = `${grain.value}px`;
    save();
  }

  function syncScanlines() {
    link.dataset.tScanlines = String(scanlines.checked);
    save();
  }

  function syncScanlineSpacing() {
    link.dataset.tScanlineSpacing = scanlineSpacing.value;
    scanlineSpacingVal.textContent = `${scanlineSpacing.value}px`;
    save();
  }

  function syncScanlineThickness() {
    link.dataset.tScanlineThickness = scanlineThickness.value;
    scanlineThicknessVal.textContent = `${scanlineThickness.value}px`;
    save();
  }

  function syncScanlineBlur() {
    link.dataset.tScanlineBlur = String(scanlineBlur.checked);
    save();
  }

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  grain.addEventListener('input', syncGrain);
  scanlines.addEventListener('change', syncScanlines);
  scanlineSpacing.addEventListener('input', syncScanlineSpacing);
  scanlineThickness.addEventListener('input', syncScanlineThickness);
  scanlineBlur.addEventListener('change', syncScanlineBlur);
  tint.addEventListener('input', syncTint);

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    grain.value = saved.grain || 2;
    setColorInputValue(tint, saved.color);
    scanlines.checked = saved.scanlines !== false;
    scanlineSpacing.value = saved.scanlineSpacing || 5;
    scanlineThickness.value = saved.scanlineThickness || 2;
    scanlineBlur.checked = !!saved.scanlineBlur;
  }
  syncDuration();
  syncEasing();
  syncGrain();
  syncTint();
  syncScanlines();
  syncScanlineSpacing();
  syncScanlineThickness();
  syncScanlineBlur();
});
