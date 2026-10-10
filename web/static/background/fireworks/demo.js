document.addEventListener('DOMContentLoaded', () => {
  const instances = Fireworks.getAll();

  const FESTIVE = ['#e63946', '#f3722c', '#e9a800', '#2a9d8f', '#3a6ff7', '#9b3fd4'];
  // Brighter and lighter, for a dark sky: on white these would wash out.
  const GLOW = ['#ff4d5e', '#ffa53d', '#ffe36e', '#6ef0a0', '#62a8ff', '#c77dff'];
  const WHITE = '#ffffff';
  const NIGHT = '#070a1a';
  const ALL_PATTERNS = ['peony', 'peony', 'ring', 'willow', 'crossette', 'palm'];

  // Presets for the sliders below. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  // `patterns` has no control of its own; a profile is the only place this
  // page changes it. `colors` and `blend` seed the Colors controls, and
  // `background` the Background swatch: each profile's colors are picked
  // for its own sky, so it sets both.
  const PROFILES = {
    default: {
      launchRate: 1, burstSize: 90, burstRadius: 130, gravity: 80, trailLength: 0.3, particleSize: 2,
      background: WHITE, colors: FESTIVE, blend: false, patterns: ALL_PATTERNS,
    },
    night: {
      launchRate: 1, burstSize: 90, burstRadius: 130, gravity: 80, trailLength: 0.3, particleSize: 2,
      background: NIGHT, colors: GLOW, blend: false, patterns: ALL_PATTERNS,
    },
    calm: {
      launchRate: 0.4, burstSize: 70, burstRadius: 110, gravity: 50, trailLength: 0.4, particleSize: 1.5,
      background: WHITE, colors: ['#5b8fd6', '#9a72d0', '#d9739a'], blend: true, patterns: ['peony', 'ring'],
    },
    finale: {
      launchRate: 4, burstSize: 120, burstRadius: 150, gravity: 90, trailLength: 0.25, particleSize: 2,
      background: WHITE, colors: FESTIVE, blend: false, patterns: ALL_PATTERNS,
    },
    willow: {
      launchRate: 0.6, burstSize: 70, burstRadius: 140, gravity: 60, trailLength: 0.4, particleSize: 1.5,
      background: WHITE, colors: ['#e0a224', '#8a5a12'], blend: true, patterns: ['willow'],
    },
    mono: {
      launchRate: 1, burstSize: 90, burstRadius: 130, gravity: 80, trailLength: 0.3, particleSize: 2,
      background: WHITE, colors: ['#111111', '#8c8c8c'], blend: true, patterns: ALL_PATTERNS,
    },
  };

  const sliderKeys = ['launchRate', 'burstSize', 'burstRadius', 'gravity', 'trailLength', 'particleSize'];

  const controls = { profile: document.getElementById('profileSelect') };
  const labels = {};
  sliderKeys.forEach((key) => {
    controls[key] = document.getElementById(`${key}Range`);
    labels[key] = document.getElementById(`${key}Val`);
  });

  const UNITS = {
    launchRate: '/s', burstSize: '', burstRadius: 'px', gravity: 'px/s²', trailLength: 's', particleSize: 'px',
  };

  function syncLabels() {
    sliderKeys.forEach((key) => {
      labels[key].textContent = `${controls[key].value}${UNITS[key]}`;
    });
  }

  function apply(options) {
    instances.forEach((instance) => instance.update(options));
  }

  sliderKeys.forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      apply({ [key]: Number(controls[key].value) });
    });
  });

  // --- Colors ---------------------------------------------------------
  // One <input type="color"> per color, rebuilt whenever a profile sets a
  // new list. Every edit sends the whole list, since the effect reads
  // `colors` as one ordered palette (or gradient) rather than per index.
  const MIN_COLORS = 1;
  const MAX_COLORS = 6;
  const blendToggle = document.getElementById('blendToggle');
  const swatches = document.getElementById('colorSwatches');
  const removeColorButton = document.getElementById('removeColorButton');
  const addColorButton = document.getElementById('addColorButton');
  const colorPreview = document.getElementById('colorPreview');

  function swatchInputs() {
    return Array.from(swatches.querySelectorAll('input[type="color"]'));
  }

  function currentColors() {
    return swatchInputs().map((input) => input.value);
  }

  function currentBlend() {
    return blendToggle.getAttribute('aria-pressed') === 'true';
  }

  // Hard stops for Specific, so the strip shows separate bands; a plain
  // gradient for Range. A single color is a flat fill either way.
  function syncPreview() {
    const colors = currentColors();
    if (colors.length === 1) {
      colorPreview.style.background = colors[0];
      return;
    }
    const stops = currentBlend()
      ? colors
      : colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`);
    colorPreview.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function syncColorControls() {
    const count = swatchInputs().length;
    removeColorButton.disabled = count <= MIN_COLORS;
    addColorButton.disabled = count >= MAX_COLORS;
    syncPreview();
  }

  function applyColors() {
    syncColorControls();
    apply({ colors: currentColors() });
  }

  function addSwatch(hex) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 't-swatch';
    input.setAttribute('aria-label', 'Burst color');
    setColorInputValue(input, hex);
    input.addEventListener('input', applyColors);
    swatches.appendChild(input);
  }

  function setSwatches(colors) {
    swatchInputs().forEach((input) => input.remove());
    colors.forEach(addSwatch);
  }

  function setBlend(blend) {
    blendToggle.setAttribute('aria-pressed', String(blend));
    blendToggle.textContent = blend ? 'Colors: Range' : 'Colors: Specific';
  }

  blendToggle.addEventListener('click', () => {
    setBlend(!currentBlend());
    syncPreview();
    apply({ blend: currentBlend() });
  });

  // A new swatch starts as a copy of the last one, so adding a stop to a
  // range doesn't suddenly throw an unrelated color into the sky.
  addColorButton.addEventListener('click', () => {
    const colors = currentColors();
    addSwatch(colors[colors.length - 1]);
    applyColors();
  });

  removeColorButton.addEventListener('click', () => {
    const inputs = swatchInputs();
    if (inputs.length <= MIN_COLORS) return;
    inputs[inputs.length - 1].remove();
    applyColors();
  });

  // --- Background and click ------------------------------------------
  const backgroundInput = document.getElementById('backgroundInput');
  backgroundInput.addEventListener('input', () => {
    apply({ background: backgroundInput.value });
  });

  // Not part of any profile: whether clicks launch is the visitor's call,
  // and switching presets shouldn't quietly turn it back on.
  const clickToggle = document.getElementById('clickToggle');
  clickToggle.addEventListener('click', () => {
    const on = clickToggle.getAttribute('aria-pressed') !== 'true';
    clickToggle.setAttribute('aria-pressed', String(on));
    clickToggle.textContent = on ? 'Click to launch: On' : 'Click to launch: Off';
    apply({ clickToLaunch: on });
  });

  const numeric = sliderKeys.map((key) => [key, key]);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({ profile, controls, numeric });
    setSwatches(profile.colors);
    setBlend(profile.blend);
    syncColorControls();
    setColorInputValue(backgroundInput, profile.background);
    apply({
      ...options,
      colors: currentColors(),
      blend: profile.blend,
      patterns: profile.patterns,
      background: backgroundInput.value,
    });
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  applyProfile('default');
});
