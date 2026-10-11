document.addEventListener('DOMContentLoaded', () => {
  const instances = Confetti.getAll();

  // The one custom shape on this page, to show the extension point: a
  // shape is a function that fills itself, centered on (0, 0), about
  // `size` px across. The fill color is already set, and the piece's spin
  // and tumble are already applied to the context.
  function heart(ctx, size) {
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.2, 0, -s * 0.9, -s * 1.1, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.9, -s * 1.1, s * 1.2, 0, 0, s * 0.9);
    ctx.fill();
  }

  const CUSTOM_SHAPES = { heart };

  const FESTIVE = ['#e63946', '#f3722c', '#e9a800', '#2a9d8f', '#3a6ff7', '#9b3fd4'];

  // Presets for every control. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  const PROFILES = {
    default: {
      amount: 1, spread: 50, reach: 200, gravity: 500, size: 9,
      shapes: ['square', 'strip', 'circle'], colors: FESTIVE,
    },
    pastel: {
      amount: 1, spread: 60, reach: 180, gravity: 400, size: 8,
      shapes: ['circle', 'square'], colors: ['#f4a3b4', '#f7c59f', '#a0d8c8', '#a7c4f2', '#c9b3ec'],
    },
    gold: {
      amount: 1.25, spread: 45, reach: 240, gravity: 450, size: 10,
      shapes: ['strip', 'star'], colors: ['#d4a017', '#b8860b', '#f0c75e', '#9c9c9c', '#c0c0c0'],
    },
    mono: {
      amount: 1, spread: 50, reach: 200, gravity: 500, size: 8,
      shapes: ['square', 'strip', 'circle', 'triangle'], colors: ['#111111', '#8c8c8c'],
    },
    hearts: {
      amount: 0.75, spread: 70, reach: 220, gravity: 350, size: 14,
      shapes: ['heart'], colors: ['#e63946', '#ff7a8a', '#c9184a'],
    },
    blizzard: {
      amount: 2.5, spread: 90, reach: 320, gravity: 600, size: 7,
      shapes: ['square', 'strip', 'circle', 'triangle', 'star'], colors: FESTIVE,
    },
  };

  const sliderKeys = ['amount', 'spread', 'reach', 'gravity', 'size'];

  const controls = { profile: document.getElementById('profileSelect') };
  const labels = {};
  sliderKeys.forEach((key) => {
    controls[key] = document.getElementById(`${key}Range`);
    labels[key] = document.getElementById(`${key}Val`);
  });

  const UNITS = {
    amount: '×', spread: '°', reach: 'px', gravity: 'px/s²', size: 'px',
  };

  function syncLabels() {
    sliderKeys.forEach((key) => {
      labels[key].textContent = `${controls[key].value}${UNITS[key]}`;
    });
  }

  // --- Shapes ---------------------------------------------------------
  const shapeChips = Array.from(document.querySelectorAll('#shapeChips [data-shape]'));

  function currentShapes() {
    return shapeChips
      .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
      .map((chip) => CUSTOM_SHAPES[chip.dataset.shape] || chip.dataset.shape);
  }

  function setShapes(names) {
    shapeChips.forEach((chip) => {
      chip.setAttribute('aria-pressed', String(names.includes(chip.dataset.shape)));
    });
  }

  shapeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      // The last one switched on stays on: confetti with no shape at all
      // would just fall back to squares, which isn't what anyone asked for.
      if (!on && currentShapes().length <= 1) return;
      chip.setAttribute('aria-pressed', String(on));
      applyAll();
    });
  });

  // --- Colors ---------------------------------------------------------
  // One <input type="color"> per color, rebuilt whenever a profile sets a
  // new list. Every edit sends the whole list.
  const MIN_COLORS = 1;
  const MAX_COLORS = 6;
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

  // Hard stops, so the strip shows one band per color.
  function syncColorControls() {
    const colors = currentColors();
    removeColorButton.disabled = colors.length <= MIN_COLORS;
    addColorButton.disabled = colors.length >= MAX_COLORS;
    colorPreview.style.background = colors.length === 1
      ? colors[0]
      : `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`;
  }

  function addSwatch(hex) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 't-swatch';
    input.setAttribute('aria-label', 'Confetti color');
    setColorInputValue(input, hex);
    input.addEventListener('input', () => {
      syncColorControls();
      applyAll();
    });
    swatches.appendChild(input);
  }

  function setSwatches(colors) {
    swatchInputs().forEach((input) => input.remove());
    colors.forEach(addSwatch);
    syncColorControls();
  }

  addColorButton.addEventListener('click', () => {
    const colors = currentColors();
    addSwatch(colors[colors.length - 1]);
    syncColorControls();
    applyAll();
  });

  removeColorButton.addEventListener('click', () => {
    const inputs = swatchInputs();
    if (inputs.length <= MIN_COLORS) return;
    inputs[inputs.length - 1].remove();
    syncColorControls();
    applyAll();
  });

  // --- Applying -------------------------------------------------------
  // Every instance gets the whole set on any change. Amount scales each
  // one's own mode's base count rather than setting a count outright, and
  // spread and reach are left alone on the screen buttons, whose own
  // defaults are sized to the window rather than to a button.
  function applyAll() {
    const amount = Number(controls.amount.value);
    const shared = {
      gravity: Number(controls.gravity.value),
      size: Number(controls.size.value),
      shapes: currentShapes(),
      colors: currentColors(),
    };
    instances.forEach((instance) => {
      const { mode } = instance.resolved;
      const options = {
        ...shared,
        count: Math.max(1, Math.round(Confetti.MODE_DEFAULTS[mode].count * amount)),
      };
      if (mode !== 'screen') {
        options.spread = Number(controls.spread.value);
        options.reach = Number(controls.reach.value);
      }
      instance.update(options);
    });
  }

  sliderKeys.forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      applyAll();
    });
  });

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    sliderKeys.forEach((key) => {
      controls[key].value = profile[key];
    });
    setShapes(profile.shapes);
    setSwatches(profile.colors);
    syncLabels();
    applyAll();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  // --- Any angle ------------------------------------------------------
  // Not part of the panel: it belongs to the one button it aims, and it
  // sits beside that button so the arrow and the confetti can be compared.
  const angleButton = document.getElementById('angleButton');
  const angleInput = document.getElementById('angleInput');
  const angleReadout = document.getElementById('angleReadout');

  function syncAngle() {
    const degrees = Number(angleInput.value);
    angleReadout.textContent = degrees;
    angleButton.style.setProperty('--cf-angle', `${degrees}deg`);
    const instance = Confetti.get(angleButton);
    if (instance) instance.update({ direction: degrees });
  }

  angleInput.addEventListener('input', syncAngle);

  syncAngle();
  applyProfile('default');
});
