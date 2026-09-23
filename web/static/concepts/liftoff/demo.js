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
    underglow: {
      dwell: 1500, riseSmoothing: 220, lift: 22, driftX: 7, driftY: 5, tilt: 1.6, scale: 1.035,
      shadowAtRest: true, glow: true, shadowColor: '#000000', glowColor: '#000000', thrustColor: '#000000',
    },
    rocket: {
      dwell: 900, riseSmoothing: 160, lift: 46, driftX: 10, driftY: 14, tilt: 3.2, scale: 1.07,
      shadowAtRest: true, glow: true, shadowColor: '#000000', glowColor: '#ff5a1f', thrustColor: '#ffd23f',
    },
    drone: {
      dwell: 2200, riseSmoothing: 340, lift: 14, driftX: 3, driftY: 2, tilt: 0.6, scale: 1.015,
      shadowAtRest: true, glow: true, shadowColor: '#0f172a', glowColor: '#38bdf8', thrustColor: '#60a5fa',
    },
    // What the homepage actually uses on every card (see home.js's
    // Liftoff.HOMEPAGE_PRESET) - a quicker, subtler preview tuned for
    // browsing rather than a one-off deliberate hover, with the glow
    // dropped entirely. Colors aren't part of that shared preset (the
    // homepage doesn't override them), so they're just the library
    // defaults here.
    homepage: {
      ...Liftoff.HOMEPAGE_PRESET,
      shadowColor: Liftoff.DEFAULTS.shadowColor,
      glowColor: Liftoff.DEFAULTS.glowColor,
      thrustColor: Liftoff.DEFAULTS.thrustColor,
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
    glowColor: document.getElementById('glowColorInput'),
    thrustColor: document.getElementById('thrustColorInput'),
  };

  const sliderLabels = {
    dwell: document.getElementById('dwellVal'),
    riseSmoothing: document.getElementById('riseSmoothingVal'),
    lift: document.getElementById('liftVal'),
    driftX: document.getElementById('driftXVal'),
    driftY: document.getElementById('driftYVal'),
    tilt: document.getElementById('tiltVal'),
    scale: document.getElementById('scaleVal'),
  };

  function syncLabels() {
    sliderLabels.dwell.textContent = `${controls.dwell.value}ms`;
    sliderLabels.riseSmoothing.textContent = `${controls.riseSmoothing.value}ms`;
    sliderLabels.lift.textContent = `${controls.lift.value}px`;
    sliderLabels.driftX.textContent = `${controls.driftX.value}px`;
    sliderLabels.driftY.textContent = `${controls.driftY.value}px`;
    sliderLabels.tilt.textContent = `${controls.tilt.value}deg`;
    sliderLabels.scale.textContent = controls.scale.value;
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
    controls.glowColor.value = profile.glowColor;
    controls.thrustColor.value = profile.thrustColor;

    instance.update(profile);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.shadowAtRest.addEventListener('change', () => {
    instance.update({ shadowAtRest: controls.shadowAtRest.checked });
  });

  controls.glow.addEventListener('change', () => {
    instance.update({ glow: controls.glow.checked });
  });

  controls.shadowColor.addEventListener('input', () => {
    instance.update({ shadowColor: controls.shadowColor.value });
  });

  controls.glowColor.addEventListener('input', () => {
    instance.update({ glowColor: controls.glowColor.value });
  });

  controls.thrustColor.addEventListener('input', () => {
    instance.update({ thrustColor: controls.thrustColor.value });
  });

  Object.keys(sliderLabels).forEach((key) => {
    controls[key].addEventListener('input', () => {
      instance.update({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  applyProfile('underglow');
});
