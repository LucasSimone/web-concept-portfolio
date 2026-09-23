document.addEventListener('DOMContentLoaded', () => {
  // liftoff.js's own auto-init skips creating an instance under
  // prefers-reduced-motion, but this page's whole point is to let visitors
  // try the effect via its own controls - so create it directly if the
  // auto-init didn't already.
  const instance = Liftoff.get('#demoCard') || Liftoff.initAll('#demoCard')[0];

  // Presets for the sliders below. Matches the "Profile" pattern used on
  // the other demo pages: picking a profile sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  const PROFILES = {
    classic: {
      dwell: 1500, riseSmoothing: 220, lift: 22, driftX: 7, driftY: 5, tilt: 1.6, scale: 1.035,
      shadowAtRest: true, glow: true, shadowColor: '#000000', dashColor: '#000000',
      thrustColumns: 11, lineThickness: 2, thrustHeight: 54, thrustSpeed: 1,
      lineLengthMin: 6, lineLengthMax: 16, spacingMin: 4, spacingMax: 14, minFallDuration: 750,
    },
    rocket: {
      dwell: 900, riseSmoothing: 160, lift: 46, driftX: 10, driftY: 14, tilt: 3.2, scale: 1.07,
      shadowAtRest: true, glow: true, shadowColor: '#000000', dashColor: '#000000',
      thrustColumns: 9, lineThickness: 2.5, thrustHeight: 74, thrustSpeed: 1.4,
      lineLengthMin: 8, lineLengthMax: 22, spacingMin: 3, spacingMax: 10, minFallDuration: 250,
    },
    drone: {
      dwell: 2200, riseSmoothing: 340, lift: 14, driftX: 3, driftY: 2, tilt: 0.6, scale: 1.015,
      shadowAtRest: true, glow: true, shadowColor: '#0f172a', dashColor: '#0f172a',
      thrustColumns: 5, lineThickness: 1.5, thrustHeight: 34, thrustSpeed: 0.7,
      lineLengthMin: 4, lineLengthMax: 10, spacingMin: 8, spacingMax: 24, minFallDuration: 350,
    },
    // Dense, fast, tightly-packed dashes with barely any pause between
    // them - reads as a sustained, roaring burn rather than a light float.
    afterburner: {
      dwell: 700, riseSmoothing: 140, lift: 50, driftX: 12, driftY: 16, tilt: 3.6, scale: 1.08,
      shadowAtRest: true, glow: true, shadowColor: '#000000', dashColor: '#000000',
      thrustColumns: 14, lineThickness: 3, thrustHeight: 90, thrustSpeed: 2,
      lineLengthMin: 14, lineLengthMax: 34, spacingMin: 1, spacingMax: 5, minFallDuration: 200,
    },
    // Sparse, thin, slow-drifting dashes with long pauses between them -
    // a faint idle mist instead of a thrust.
    hovermist: {
      dwell: 1800, riseSmoothing: 260, lift: 18, driftX: 5, driftY: 4, tilt: 1, scale: 1.02,
      shadowAtRest: true, glow: true, shadowColor: '#000000', dashColor: '#000000',
      thrustColumns: 8, lineThickness: 1, thrustHeight: 26, thrustSpeed: 0.5,
      lineLengthMin: 2, lineLengthMax: 6, spacingMin: 20, spacingMax: 50, minFallDuration: 400,
    },
    // What the homepage actually uses on every card (see home.js's
    // Liftoff.HOMEPAGE_PRESET) - a quicker, subtler preview tuned for
    // browsing rather than a one-off deliberate hover, with the dashes
    // dropped entirely.
    homepage: {
      ...Liftoff.HOMEPAGE_PRESET,
      shadowColor: Liftoff.DEFAULTS.shadowColor,
      dashColor: Liftoff.DEFAULTS.dashColor,
      thrustColumns: Liftoff.DEFAULTS.thrustColumns,
      lineThickness: Liftoff.DEFAULTS.lineThickness,
      thrustHeight: Liftoff.DEFAULTS.thrustHeight,
      thrustSpeed: Liftoff.DEFAULTS.thrustSpeed,
      lineLengthMin: Liftoff.DEFAULTS.lineLengthMin,
      lineLengthMax: Liftoff.DEFAULTS.lineLengthMax,
      spacingMin: Liftoff.DEFAULTS.spacingMin,
      spacingMax: Liftoff.DEFAULTS.spacingMax,
      minFallDuration: Liftoff.DEFAULTS.minFallDuration,
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    shadowAtRest: document.getElementById('shadowAtRestCheckbox'),
    glow: document.getElementById('glowCheckbox'),
    dwell: document.getElementById('dwellRange'),
    riseSmoothing: document.getElementById('riseSmoothingRange'),
    lift: document.getElementById('liftRange'),
    driftX: document.getElementById('driftXRange'),
    driftY: document.getElementById('driftYRange'),
    tilt: document.getElementById('tiltRange'),
    scale: document.getElementById('scaleRange'),
    shadowColor: document.getElementById('shadowColorInput'),
    dashColor: document.getElementById('dashColorInput'),
    thrustColumns: document.getElementById('thrustColumnsRange'),
    lineThickness: document.getElementById('lineThicknessRange'),
    thrustHeight: document.getElementById('thrustHeightRange'),
    thrustSpeed: document.getElementById('thrustSpeedRange'),
    lineLengthMin: document.getElementById('lineLengthMinRange'),
    lineLengthMax: document.getElementById('lineLengthMaxRange'),
    spacingMin: document.getElementById('spacingMinRange'),
    spacingMax: document.getElementById('spacingMaxRange'),
    minFallDuration: document.getElementById('minFallDurationRange'),
  };

  const sliderLabels = {
    dwell: document.getElementById('dwellVal'),
    riseSmoothing: document.getElementById('riseSmoothingVal'),
    lift: document.getElementById('liftVal'),
    driftX: document.getElementById('driftXVal'),
    driftY: document.getElementById('driftYVal'),
    tilt: document.getElementById('tiltVal'),
    scale: document.getElementById('scaleVal'),
    thrustColumns: document.getElementById('thrustColumnsVal'),
    lineThickness: document.getElementById('lineThicknessVal'),
    thrustHeight: document.getElementById('thrustHeightVal'),
    thrustSpeed: document.getElementById('thrustSpeedVal'),
    lineLengthMin: document.getElementById('lineLengthMinVal'),
    lineLengthMax: document.getElementById('lineLengthMaxVal'),
    spacingMin: document.getElementById('spacingMinVal'),
    spacingMax: document.getElementById('spacingMaxVal'),
    minFallDuration: document.getElementById('minFallDurationVal'),
  };

  // Everything from Columns through Min fall duration only affects the
  // dashes themselves, so it does nothing while `glow` (the Dashes
  // checkbox) is off - greyed out and disabled together rather than left
  // active but inert, so it's obvious at a glance which controls currently
  // matter.
  const dashControlRows = document.querySelectorAll('.dash-control');

  function updateDashControlsEnabled() {
    const enabled = controls.glow.checked;
    dashControlRows.forEach((row) => {
      row.classList.toggle('is-disabled', !enabled);
      row.querySelectorAll('input').forEach((input) => { input.disabled = !enabled; });
    });
  }

  function syncLabels() {
    sliderLabels.dwell.textContent = `${controls.dwell.value}ms`;
    sliderLabels.riseSmoothing.textContent = `${controls.riseSmoothing.value}ms`;
    sliderLabels.lift.textContent = `${controls.lift.value}px`;
    sliderLabels.driftX.textContent = `${controls.driftX.value}px`;
    sliderLabels.driftY.textContent = `${controls.driftY.value}px`;
    sliderLabels.tilt.textContent = `${controls.tilt.value}deg`;
    sliderLabels.scale.textContent = controls.scale.value;
    sliderLabels.thrustColumns.textContent = controls.thrustColumns.value;
    sliderLabels.lineThickness.textContent = `${controls.lineThickness.value}px`;
    sliderLabels.thrustHeight.textContent = `${controls.thrustHeight.value}px`;
    sliderLabels.thrustSpeed.textContent = `${controls.thrustSpeed.value}x`;
    sliderLabels.lineLengthMin.textContent = `${controls.lineLengthMin.value}px`;
    sliderLabels.lineLengthMax.textContent = `${controls.lineLengthMax.value}px`;
    sliderLabels.spacingMin.textContent = `${controls.spacingMin.value}px`;
    sliderLabels.spacingMax.textContent = `${controls.spacingMax.value}px`;
    sliderLabels.minFallDuration.textContent = `${controls.minFallDuration.value}ms`;
  }

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    Object.keys(sliderLabels).forEach((key) => {
      controls[key].value = profile[key];
    });
    controls.shadowAtRest.checked = profile.shadowAtRest;
    controls.glow.checked = profile.glow;
    controls.shadowColor.value = profile.shadowColor;
    controls.dashColor.value = profile.dashColor;

    instance.update(profile);
    syncLabels();
    updateDashControlsEnabled();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.shadowAtRest.addEventListener('change', () => {
    instance.update({ shadowAtRest: controls.shadowAtRest.checked });
  });

  controls.glow.addEventListener('change', () => {
    instance.update({ glow: controls.glow.checked });
    updateDashControlsEnabled();
  });

  controls.shadowColor.addEventListener('input', () => {
    instance.update({ shadowColor: controls.shadowColor.value });
  });

  controls.dashColor.addEventListener('input', () => {
    instance.update({ dashColor: controls.dashColor.value });
  });

  Object.keys(sliderLabels).forEach((key) => {
    controls[key].addEventListener('input', () => {
      instance.update({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  applyProfile('classic');
});
