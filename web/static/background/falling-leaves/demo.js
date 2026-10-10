document.addEventListener('DOMContentLoaded', () => {
  const instances = FallingLeaves.getAll();

  const AUTUMN = ['#b5381f', '#d3622a', '#e39b2d', '#c9a227', '#7a4a22'];
  const ALL_LEAVES = ['maple', 'oak', 'birch', 'oval'];

  // Presets for the sliders below. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  // `shapes` has no control of its own; a profile is the only place this
  // page changes it. `colors` and `blend` seed the Colors controls.
  const PROFILES = {
    default: {
      count: 40, fallSpeed: 45, sway: 40, tumble: 1, wind: 10, gusts: 1, size: 14,
      colors: AUTUMN, blend: false, shapes: ALL_LEAVES,
    },
    maple: {
      count: 30, fallSpeed: 40, sway: 45, tumble: 1, wind: 10, gusts: 1, size: 18,
      colors: ['#a3241b', '#c63a1f', '#dd5a26', '#e8862f'], blend: false, shapes: ['maple'],
    },
    still: {
      count: 15, fallSpeed: 20, sway: 55, tumble: 0.5, wind: 0, gusts: 0, size: 16,
      colors: AUTUMN, blend: false, shapes: ALL_LEAVES,
    },
    windy: {
      count: 70, fallSpeed: 70, sway: 25, tumble: 1.8, wind: 60, gusts: 2, size: 12,
      colors: AUTUMN, blend: false, shapes: ALL_LEAVES,
    },
    blossom: {
      count: 90, fallSpeed: 25, sway: 45, tumble: 1.4, wind: 20, gusts: 1, size: 7,
      colors: ['#fbe1e6', '#e98aa2'], blend: true, shapes: ['petal'],
    },
    mono: {
      count: 40, fallSpeed: 45, sway: 40, tumble: 1, wind: 10, gusts: 1, size: 14,
      colors: ['#1a1a1a', '#8c8c8c'], blend: true, shapes: ALL_LEAVES,
    },
  };

  const sliderKeys = ['count', 'fallSpeed', 'sway', 'tumble', 'wind', 'gusts', 'size'];

  const controls = { profile: document.getElementById('profileSelect') };
  const labels = {};
  sliderKeys.forEach((key) => {
    controls[key] = document.getElementById(`${key}Range`);
    labels[key] = document.getElementById(`${key}Val`);
  });

  const UNITS = {
    count: '', fallSpeed: 'px/s', sway: 'px', tumble: '×', wind: 'px/s', gusts: '×', size: 'px',
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
    input.setAttribute('aria-label', 'Leaf color');
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
  // range doesn't suddenly throw an unrelated color into the field.
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

  const numeric = sliderKeys.map((key) => [key, key]);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({ profile, controls, numeric });
    setSwatches(profile.colors);
    setBlend(profile.blend);
    syncColorControls();
    apply({
      ...options, colors: currentColors(), blend: profile.blend, shapes: profile.shapes,
    });
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  applyProfile('default');
});
