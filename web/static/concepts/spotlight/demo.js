document.addEventListener('DOMContentLoaded', () => {
  // spotlight.js's own auto-init skips creating instances under
  // prefers-reduced-motion, but this page's whole point is to let visitors
  // try the effect via its own controls - so create them directly if the
  // auto-init didn't already. (initAll skips anything already claimed, so
  // running it a second time here is a no-op in the normal case.)
  Spotlight.initAll('.spotlight-el');
  const instances = Array.from(document.querySelectorAll('.spotlight-el'))
    .map((el) => Spotlight.get(el))
    .filter(Boolean);

  // The shared stage reads its options off whichever instance currently
  // holds the light, so a control that only touched the hero card would
  // appear to do nothing the moment the pointer moved to the gallery.
  // Every control here applies to every instance on the page.
  function apply(options) {
    instances.forEach((instance) => instance.update(options));
  }

  // Presets for the controls below. Matches the "Profile" pattern used on
  // the other demo pages: picking one sets every control to a known-good
  // combination, but each stays freely editable afterward. Values are in
  // *control* units, not option units - Page dim is the 0-100 the slider
  // shows - so applyProfile can write them straight into the inputs and
  // hand the same numbers through the `numeric` table's transforms below.
  const PROFILES = {
    // The library's own defaults, white.
    default: {
      scale: 1.06, lift: 12, smoothing: 170, sweep: 240, angle: 18,
      beamOpacity: 0.72, clearance: 16, sourceWidth: 40, overshoot: 1.3,
      edgeGlow: true, haloGlow: true, floorGlow: true, dustMotes: true,
      darkOpacity: 74, blurAmount: 0, color: '#ffffff',
    },
    // The warm amber this effect shipped with as its default, plus the
    // staging that goes with it: a narrow emitter, a deep dim and a steep
    // rake, for a hard theatrical spot on a dark page.
    theatre: {
      scale: 1.08, lift: 16, smoothing: 190, sweep: 300, angle: 22,
      beamOpacity: 0.86, clearance: 10, sourceWidth: 16, overshoot: 1.45,
      edgeGlow: true, haloGlow: true, floorGlow: true, dustMotes: true,
      darkOpacity: 86, blurAmount: 0, color: '#ffd9a0',
    },
    // The opposite end of `sourceWidth`: a wide, near-vertical panel with
    // the atmosphere stripped back. Reads as ambient product lighting
    // rather than a spot picking something out.
    panel: {
      scale: 1.03, lift: 8, smoothing: 260, sweep: 320, angle: 6,
      beamOpacity: 0.5, clearance: 44, sourceWidth: 188, overshoot: 1.15,
      edgeGlow: false, haloGlow: true, floorGlow: true, dustMotes: false,
      darkOpacity: 56, blurAmount: 0, color: '#ffffff',
    },
    // Attention rather than drama - an onboarding step or a "look here"
    // callout. The blur does the work, the beam is barely there, and the
    // element hardly moves so it stays clickable under the pointer.
    focus: {
      scale: 1.02, lift: 4, smoothing: 220, sweep: 200, angle: 10,
      beamOpacity: 0.28, clearance: 30, sourceWidth: 120, overshoot: 1.1,
      edgeGlow: false, haloGlow: true, floorGlow: false, dustMotes: false,
      darkOpacity: 62, blurAmount: 10, color: '#ffffff',
    },
    // Cold, hard and fast: a point source raking in from the left through
    // an almost black page, snapping on with very little easing.
    interrogation: {
      scale: 1.05, lift: 10, smoothing: 110, sweep: 120, angle: -32,
      beamOpacity: 0.94, clearance: 6, sourceWidth: 8, overshoot: 1.6,
      edgeGlow: true, haloGlow: true, floorGlow: true, dustMotes: true,
      darkOpacity: 92, blurAmount: 0, color: '#bfe3ff',
    },
    // Tuned for the hand-off rather than the resting state: a long lazy
    // sweep and a long throw, so moving the pointer along the gallery
    // below swings the beam across instead of cutting to each element.
    searchlight: {
      scale: 1.05, lift: 14, smoothing: 260, sweep: 700, angle: 34,
      beamOpacity: 0.8, clearance: 22, sourceWidth: 28, overshoot: 1.75,
      edgeGlow: true, haloGlow: true, floorGlow: true, dustMotes: true,
      darkOpacity: 82, blurAmount: 0, color: '#dfe9ff',
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    scale: document.getElementById('scaleRange'),
    lift: document.getElementById('liftRange'),
    smoothing: document.getElementById('smoothingRange'),
    sweep: document.getElementById('sweepRange'),
    color: document.getElementById('colorInput'),
    angle: document.getElementById('angleRange'),
    beamOpacity: document.getElementById('beamOpacityRange'),
    clearance: document.getElementById('clearanceRange'),
    sourceWidth: document.getElementById('sourceWidthRange'),
    overshoot: document.getElementById('overshootRange'),
    edgeGlow: document.getElementById('edgeGlowCheckbox'),
    haloGlow: document.getElementById('haloGlowCheckbox'),
    floorGlow: document.getElementById('floorGlowCheckbox'),
    dustMotes: document.getElementById('dustMotesCheckbox'),
    darkOpacity: document.getElementById('darkOpacityRange'),
    blurAmount: document.getElementById('blurAmountRange'),
  };

  function syncLabels() {
    document.getElementById('scaleVal').textContent = controls.scale.value;
    document.getElementById('liftVal').textContent = `${controls.lift.value}px`;
    document.getElementById('smoothingVal').textContent = `${controls.smoothing.value}ms`;
    document.getElementById('sweepVal').textContent = `${controls.sweep.value}ms`;
    document.getElementById('angleVal').textContent = `${controls.angle.value}°`;
    document.getElementById('beamOpacityVal').textContent = controls.beamOpacity.value;
    document.getElementById('clearanceVal').textContent = `${controls.clearance.value}px`;
    document.getElementById('sourceWidthVal').textContent = `${controls.sourceWidth.value}px`;
    document.getElementById('overshootVal').textContent = `${Number(controls.overshoot.value).toFixed(2)}×`;
    document.getElementById('darkOpacityVal').textContent = `${controls.darkOpacity.value}%`;
    document.getElementById('blurAmountVal').textContent = `${controls.blurAmount.value}px`;
  }

  // Every numeric control maps one range input straight onto one option,
  // optionally through a scale - worth a table rather than sixteen
  // near-identical listener bodies.
  const numeric = [
    ['scale', 'scale'],
    ['lift', 'lift'],
    ['smoothing', 'smoothing'],
    ['sweep', 'sweep'],
    ['angle', 'angle'],
    ['beamOpacity', 'beamOpacity'],
    ['clearance', 'clearance'],
    ['sourceWidth', 'sourceWidth'],
    ['overshoot', 'overshoot'],
    ['darkOpacity', 'darkOpacity', (v) => v / 100],
    ['blurAmount', 'blurAmount'],
  ];

  const toggles = ['edgeGlow', 'haloGlow', 'floorGlow', 'dustMotes'];

  numeric.forEach(([key, option, transform]) => {
    controls[key].addEventListener('input', () => {
      const value = Number(controls[key].value);
      apply({ [option]: transform ? transform(value) : value });
      syncLabels();
    });
  });

  toggles.forEach((key) => {
    controls[key].addEventListener('change', () => apply({ [key]: controls[key].checked }));
  });

  controls.color.addEventListener('input', () => apply({ color: controls.color.value }));

  // One pass over the same tables the individual listeners use, so a
  // profile can only ever set what a control could have set by hand.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    const options = { color: profile.color };
    numeric.forEach(([key, option, transform]) => {
      controls[key].value = profile[key];
      // Read back off the input rather than using the profile's own
      // number: a range input snaps whatever it's given to its own
      // min/step grid, and applying the unsnapped value would leave the
      // slider reading one thing while the effect ran on another.
      const value = Number(controls[key].value);
      options[option] = transform ? transform(value) : value;
    });
    toggles.forEach((key) => {
      controls[key].checked = profile[key];
      options[key] = profile[key];
    });
    controls.color.value = profile.color;

    apply(options);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  applyProfile('default');
});
