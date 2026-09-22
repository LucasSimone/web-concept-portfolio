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
  const styleButtons = Array.from(document.querySelectorAll('[data-style-group] .t-style-btn'));
  const panelColor = document.getElementById('ptPanelColor');
  const lineColor = document.getElementById('ptLineColor');

  // The "Click me" box below the main link — a small live example of
  // Aperture transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  function toggleElementDemo() {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    Transitions.aperture.play(elementDemo, {
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
  // defaults. Separate from aperture.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-aperture-demo-controls';

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: duration.value,
        easing: easing.value,
        blades: blades.value,
        style: link.dataset.tStyle,
        color: link.dataset.tColor,
        lineColor: link.dataset.tLineColor,
      }));
    } catch (e) {}
  }

  function syncPanelColor() {
    link.dataset.tColor = panelColor.value;
    save();
  }

  function syncLineColor() {
    link.dataset.tLineColor = lineColor.value;
    save();
  }

  function selectStyle(style) {
    const match = styleButtons.find((b) => b.dataset.style === style) || styleButtons[0];
    styleButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.tStyle = match.dataset.style;
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

  function syncBlades() {
    link.dataset.tBlades = blades.value;
    bladesVal.textContent = blades.value;
    save();
  }

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  blades.addEventListener('input', syncBlades);

  panelColor.addEventListener('input', syncPanelColor);
  lineColor.addEventListener('input', syncLineColor);
  styleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectStyle(btn.dataset.style);
      save();
    });
  });

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    blades.value = saved.blades || 8;
    selectStyle(saved.style);
    setColorInputValue(panelColor, saved.color);
    setColorInputValue(lineColor, saved.lineColor);
  } else {
    selectStyle(styleButtons.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.style);
  }
  syncDuration();
  syncEasing();
  syncBlades();
  syncPanelColor();
  syncLineColor();
});
