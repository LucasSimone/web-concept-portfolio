document.addEventListener('DOMContentLoaded', () => {
  const instances = OuterWorlds.getAll();
  // The hero is the one whose seed the panel reports. The two cards below
  // it keep their own worlds — showing three seeds would be noise, and the
  // point of the readout is that a seed is a world you can get back.
  const hero = OuterWorlds.get('.world-hero');

  // Presets for the controls below. Each one sets every control, including
  // the drawing style, so switching between them always lands somewhere
  // fully defined rather than inheriting half of the last preset.
  //
  // `landRange` has no slider of its own — it's the length of the ramp from
  // coastline to full-strength ink, which is a character decision each
  // preset makes (Continents flattens it for solid graphic landmasses,
  // Atlas keeps it long for halftone relief) rather than something worth
  // its own control.
  //
  // The Pointer toggle is deliberately absent, and is the one control a
  // preset leaves alone: whether the cursor drives is a decision about the
  // page the background sits on, not about how the world looks, so it
  // should survive flipping through presets to compare them.
  const PROFILES = {
    atlas: {
      mode: 'dots', projection: 'globe', momentum: 1.1, autoSpin: 0.8, sensitivity: 1, scale: 1.25,
      dotSpacing: 13, meshSpacing: 34, relief: 0.05, seaLevel: 0.1, frequency: 2.3,
      landRange: 0.42, oceanAlpha: 0.13, fillAlpha: 0.16,
      land: '#000000', ocean: '#000000', background: '#ffffff',
    },
    wireframe: {
      mode: 'wire', projection: 'globe', momentum: 1.1, autoSpin: 0.8, sensitivity: 1, scale: 1.25,
      dotSpacing: 11, meshSpacing: 34, relief: 0.05, seaLevel: 0.1, frequency: 2.3,
      landRange: 0.42, oceanAlpha: 0.13, fillAlpha: 0.16,
      land: '#000000', ocean: '#000000', background: '#ffffff',
    },
    reliefGlobe: {
      mode: 'wire', projection: 'globe', momentum: 1.6, autoSpin: 2.2, sensitivity: 1, scale: 0.78,
      dotSpacing: 8, meshSpacing: 26, relief: 0.09, seaLevel: 0.12, frequency: 2,
      landRange: 0.42, oceanAlpha: 0.16, fillAlpha: 0.16,
      land: '#000000', ocean: '#000000', background: '#ffffff',
    },
    // The two Map presets run their three inks solid rather than as tints
    // of one color - flat land, flat sea, a dark coastline between them -
    // which is the whole point of the style.
    cartograph: {
      mode: 'map', projection: 'globe', momentum: 1.4, autoSpin: 1.6, sensitivity: 1, scale: 0.82,
      dotSpacing: 10, meshSpacing: 34, relief: 0.05, seaLevel: 0.1, frequency: 2.1,
      landRange: 0.42, oceanAlpha: 1, fillAlpha: 1,
      land: '#efe8d8', border: '#14181c', ocean: '#cfdfe8', background: '#ffffff',
    },
    paperMap: {
      mode: 'map', projection: 'flat', momentum: 1.4, autoSpin: 1.2, sensitivity: 1, scale: 0.3,
      dotSpacing: 8, meshSpacing: 34, relief: 0.05, seaLevel: 0.1, frequency: 2.3,
      landRange: 0.42, oceanAlpha: 1, fillAlpha: 1,
      land: '#f4eedd', border: '#1b1b18', ocean: '#c6dae3', background: '#fbf7ef',
    },
    continents: {
      mode: 'dots', projection: 'globe', momentum: 1.1, autoSpin: 0.6, sensitivity: 1, scale: 1.25,
      dotSpacing: 12, meshSpacing: 34, relief: 0.05, seaLevel: 0.08, frequency: 1.6,
      landRange: 0.16, oceanAlpha: 0.1, fillAlpha: 0.16,
      land: '#000000', ocean: '#000000', background: '#ffffff',
    },
    archipelago: {
      mode: 'dots', projection: 'globe', momentum: 1.4, autoSpin: 1.2, sensitivity: 1, scale: 1.25,
      dotSpacing: 9, meshSpacing: 34, relief: 0.05, seaLevel: 0.26, frequency: 4.2,
      landRange: 0.3, oceanAlpha: 0.15, fillAlpha: 0.16,
      land: '#000000', ocean: '#000000', background: '#ffffff',
    },
    nightWatch: {
      mode: 'wire', projection: 'globe', momentum: 1.8, autoSpin: 1.4, sensitivity: 1, scale: 1.1,
      dotSpacing: 9, meshSpacing: 30, relief: 0.07, seaLevel: 0.1, frequency: 2.3,
      landRange: 0.42, oceanAlpha: 0.32, fillAlpha: 0.16,
      land: '#f4f4f2', ocean: '#6f97b4', background: '#0b0d12',
    },
  };

  const controls = {
    momentum: document.getElementById('momentumRange'),
    autoSpin: document.getElementById('autoSpinRange'),
    sensitivity: document.getElementById('sensitivityRange'),
    scale: document.getElementById('scaleRange'),
    dotSpacing: document.getElementById('dotSpacingRange'),
    meshSpacing: document.getElementById('meshSpacingRange'),
    relief: document.getElementById('reliefRange'),
    seaLevel: document.getElementById('seaLevelRange'),
    frequency: document.getElementById('frequencyRange'),
    fillAlpha: document.getElementById('fillAlphaRange'),
  };

  const labels = {
    momentum: document.getElementById('momentumVal'),
    autoSpin: document.getElementById('autoSpinVal'),
    sensitivity: document.getElementById('sensitivityVal'),
    scale: document.getElementById('scaleVal'),
    dotSpacing: document.getElementById('dotSpacingVal'),
    meshSpacing: document.getElementById('meshSpacingVal'),
    relief: document.getElementById('reliefVal'),
    seaLevel: document.getElementById('seaLevelVal'),
    frequency: document.getElementById('frequencyVal'),
    fillAlpha: document.getElementById('fillAlphaVal'),
  };

  const profileSelect = document.getElementById('profileSelect');
  const styleSelect = document.getElementById('styleSelect');
  const projectionToggle = document.getElementById('projectionToggle');
  const pointerToggle = document.getElementById('pointerToggle');
  const controlRows = Array.from(document.querySelectorAll('.controls .control-row'));
  const pickers = {
    land: document.getElementById('landColorPicker'),
    border: document.getElementById('borderColorPicker'),
    ocean: document.getElementById('oceanColorPicker'),
    background: document.getElementById('backgroundPicker'),
  };
  const seedVal = document.getElementById('seedVal');
  const newWorldButton = document.getElementById('newWorldButton');

  function syncLabels() {
    labels.momentum.textContent = `${Number(controls.momentum.value).toFixed(1)}s`;
    labels.autoSpin.textContent = `${Number(controls.autoSpin.value).toFixed(1)}°/s`;
    labels.sensitivity.textContent = `${Number(controls.sensitivity.value).toFixed(1)}x`;
    labels.scale.textContent = `${Number(controls.scale.value).toFixed(2)}x`;
    labels.dotSpacing.textContent = `${controls.dotSpacing.value}px`;
    labels.meshSpacing.textContent = `${controls.meshSpacing.value}px`;
    labels.relief.textContent = Number(controls.relief.value).toFixed(3);
    labels.seaLevel.textContent = Number(controls.seaLevel.value).toFixed(2);
    labels.frequency.textContent = Number(controls.frequency.value).toFixed(1);
    labels.fillAlpha.textContent = `${Math.round(Number(controls.fillAlpha.value) * 100)}%`;
  }

  function syncSeed() {
    if (hero) seedVal.textContent = hero.options.seed;
  }

  function apply(options) {
    instances.forEach((instance) => instance.update(options));
  }

  Object.keys(controls).forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      apply({ [key]: Number(controls[key].value) });
    });
  });

  // Hides the controls that have nothing to act on. `data-style` marks a row
  // as belonging to one drawing style; `data-pointer` marks one that only
  // means something while the cursor is allowed to drive.
  function syncVisibility() {
    const style = styleSelect.value;
    const pointerOn = pointerToggle.getAttribute('aria-pressed') === 'true';
    const flat = projectionToggle.getAttribute('aria-pressed') === 'true';
    // A flat Map paints its sea over the whole canvas, so the background is
    // behind something opaque and has nothing to show - the one combination
    // where that picker is genuinely inert.
    const deadBackground = style === 'map' && flat;
    controlRows.forEach((row) => {
      const forStyle = row.dataset.style;
      const ok = (!forStyle || forStyle.split(' ').indexOf(style) !== -1)
        && (!row.hasAttribute('data-pointer') || pointerOn)
        && !(row.dataset.hideWhen === 'flat-map' && deadBackground);
      row.hidden = !ok;
    });
  }

  styleSelect.addEventListener('change', () => {
    apply({ mode: styleSelect.value });
    syncVisibility();
    syncStaging();
  });

  // Zoom means the same number in both projections — the globe's radius in
  // px — but a flat view needs several times less of it to frame a useful
  // span, and correspondingly finer Detail to keep a coastline dithering
  // over more than a cell. Carrying one pair across the toggle therefore
  // lands badly whichever way it is flipped, so each projection keeps its
  // own and the sliders are moved to match — visibly, rather than the
  // values being quietly rewritten behind controls still reading the old
  // numbers.
  // Mesh spacing rides along for the same reason: a flat view frames more
  // world, so each landmass gets fewer mesh lines across it at the same px
  // spacing, and the wireframe reads sparser than the globe's does.
  const viewFor = {
    globe: { scale: 1.25, dotSpacing: 13, meshSpacing: 34 },
    flat: { scale: 0.3, dotSpacing: 7, meshSpacing: 24 },
  };

  function setProjection(flat) {
    const from = projectionToggle.getAttribute('aria-pressed') === 'true' ? 'flat' : 'globe';
    const to = flat ? 'flat' : 'globe';
    if (from !== to) {
      viewFor[from] = {
        scale: Number(controls.scale.value),
        dotSpacing: Number(controls.dotSpacing.value),
        meshSpacing: Number(controls.meshSpacing.value),
      };
      controls.scale.value = viewFor[to].scale;
      controls.dotSpacing.value = viewFor[to].dotSpacing;
      controls.meshSpacing.value = viewFor[to].meshSpacing;
    }
    projectionToggle.setAttribute('aria-pressed', String(flat));
    projectionToggle.textContent = flat ? 'View: Flat' : 'View: Globe';
    apply({
      projection: to,
      scale: Number(controls.scale.value),
      dotSpacing: Number(controls.dotSpacing.value),
      meshSpacing: Number(controls.meshSpacing.value),
    });
    syncLabels();
    syncVisibility();
  }

  projectionToggle.addEventListener('click', () => {
    setProjection(projectionToggle.getAttribute('aria-pressed') !== 'true');
  });

  function setPointer(on) {
    pointerToggle.setAttribute('aria-pressed', String(on));
    pointerToggle.textContent = on ? 'Pointer: On' : 'Pointer: Off';
    apply({ interactive: on });
    syncVisibility();
  }

  pointerToggle.addEventListener('click', () => {
    setPointer(pointerToggle.getAttribute('aria-pressed') !== 'true');
  });

  // The demo page's own staging — the card captions — is a halo of whatever
  // sits behind the text, in whatever the darkest ink on screen happens to
  // be. Without this a dark profile leaves white stickers floating on a
  // black planet.
  //
  // Map is the exception on both counts: its text lands on the sea rather
  // than on the canvas background, and its dark ink is the coastline rather
  // than the land, which in that style is a pale fill.
  function syncStaging() {
    const map = styleSelect.value === 'map';
    const root = document.documentElement.style;
    root.setProperty('--world-paper', map ? pickers.ocean.value : pickers.background.value);
    root.setProperty('--world-ink', `rgb(${hexToRgbString(map ? pickers.border.value : pickers.land.value)})`);
  }

  function syncColors() {
    apply({
      landColor: hexToRgbString(pickers.land.value),
      borderColor: hexToRgbString(pickers.border.value),
      oceanColor: hexToRgbString(pickers.ocean.value),
      background: pickers.background.value,
    });
    syncStaging();
  }

  Object.values(pickers).forEach((picker) => picker.addEventListener('input', syncColors));

  // `controls` is the one place that lists every slider (also true of the
  // individual input listeners above), so a new slider only ever has to be
  // added there and to `labels`/syncLabels - this loop picks it up with
  // nothing else to edit. Only the non-slider parts of a profile (drawing
  // style, projection, the two range-less options, and the color pickers)
  // stay hand-listed below.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    const options = {};
    Object.keys(controls).forEach((key) => {
      controls[key].value = profile[key];
      options[key] = Number(controls[key].value);
    });

    pickers.land.value = profile.land;
    pickers.border.value = profile.border || profile.land;
    pickers.ocean.value = profile.ocean;
    pickers.background.value = profile.background;

    styleSelect.value = profile.mode;
    const flat = profile.projection === 'flat';
    projectionToggle.setAttribute('aria-pressed', String(flat));
    projectionToggle.textContent = flat ? 'View: Flat' : 'View: Globe';
    // A preset states a zoom and detail for the projection it uses, so
    // make those the ones the toggle comes back to.
    viewFor[profile.projection] = {
      scale: profile.scale, dotSpacing: profile.dotSpacing, meshSpacing: profile.meshSpacing,
    };

    apply({
      ...options,
      mode: profile.mode,
      projection: profile.projection,
      landRange: profile.landRange,
      oceanAlpha: profile.oceanAlpha,
      landColor: hexToRgbString(profile.land),
      borderColor: hexToRgbString(profile.border || profile.land),
      oceanColor: hexToRgbString(profile.ocean),
      background: profile.background,
    });

    syncLabels();
    syncStaging();
    syncVisibility();
  }

  profileSelect.addEventListener('change', () => applyProfile(profileSelect.value));

  newWorldButton.addEventListener('click', () => {
    instances.forEach((instance) => instance.newWorld());
    syncSeed();
  });

  applyProfile('atlas');
  syncSeed();
});
