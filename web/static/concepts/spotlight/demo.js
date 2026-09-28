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

  const controls = {
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

  numeric.forEach(([key, option, transform]) => {
    controls[key].addEventListener('input', () => {
      const value = Number(controls[key].value);
      apply({ [option]: transform ? transform(value) : value });
      syncLabels();
    });
  });

  ['edgeGlow', 'haloGlow', 'floorGlow', 'dustMotes'].forEach((key) => {
    controls[key].addEventListener('change', () => apply({ [key]: controls[key].checked }));
  });

  controls.color.addEventListener('input', () => apply({ color: controls.color.value }));

  syncLabels();
});
