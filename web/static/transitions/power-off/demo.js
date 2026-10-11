document.addEventListener('DOMContentLoaded', () => {
  const engine = Transitions['power-off'];
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Transition Page on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const color = document.getElementById('ptColor');
  const glow = document.getElementById('ptGlow');

  // The "Click me" box below the main link — a small live example of
  // Power Off transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  function toggleElementDemo() {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    engine.play(elementDemo, {
      duration: Number(link.dataset.tDuration),
      easing: link.dataset.tEasing,
      color: link.dataset.tColor,
      glow: link.dataset.tGlow,
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
  // defaults. Separate from power-off.js's own pending-transition handoff
  // — that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-power-off-demo-controls';

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: duration.value,
        easing: easing.value,
        color: link.dataset.tColor,
        glow: link.dataset.tGlow,
      }));
    } catch (e) {}
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

  function syncColor() {
    link.dataset.tColor = color.value;
    save();
  }

  function syncGlow() {
    link.dataset.tGlow = glow.value;
    save();
  }

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  color.addEventListener('input', syncColor);
  glow.addEventListener('input', syncGlow);

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    setColorInputValue(color, saved.color);
    setColorInputValue(glow, saved.glow);
  }
  syncDuration();
  syncEasing();
  syncColor();
  syncGlow();
});
