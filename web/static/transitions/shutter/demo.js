document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const variantButtons = Array.from(document.querySelectorAll('[data-variant-group] .t-style-btn'));
  const panelColor = document.getElementById('ptColor');
  const border = document.getElementById('ptBorder');
  const borderColor = document.getElementById('ptBorderColor');

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
      border: link.dataset.tBorder,
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

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        duration: duration.value,
        easing: easing.value,
        variant: link.dataset.tVariant,
        color: link.dataset.tColor,
        border: border.checked,
        borderColor: currentBorderColor(),
      }));
    } catch (e) {}
  }

  function syncPanelColor() {
    link.dataset.tColor = panelColor.value;
    save();
  }

  function selectVariant(variant) {
    const match = variantButtons.find((b) => b.dataset.variant === variant) || variantButtons[0];
    variantButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === match)));
    link.dataset.tVariant = match.dataset.variant;
  }

  function currentBorderColor() {
    return borderColor.value;
  }

  function syncBorder() {
    link.dataset.tBorder = border.checked ? `2px solid ${currentBorderColor()}` : '';
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

  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  border.addEventListener('change', syncBorder);
  borderColor.addEventListener('input', syncBorder);
  panelColor.addEventListener('input', syncPanelColor);

  variantButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectVariant(btn.dataset.variant);
      save();
    });
  });

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    duration.value = saved.duration;
    easing.value = saved.easing;
    selectVariant(saved.variant || 'split');
    setColorInputValue(panelColor, saved.color);
    border.checked = !!saved.border;
    setColorInputValue(borderColor, saved.borderColor);
  } else {
    selectVariant(variantButtons.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.variant);
  }
  syncDuration();
  syncEasing();
  syncBorder();
  syncPanelColor();
});
