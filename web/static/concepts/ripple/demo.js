document.addEventListener('DOMContentLoaded', () => {
  const instances = Ripple.getAll();

  // What each element's own markup set (its data-ripple-* attributes),
  // taken before the panel touches anything, so "each element's own" on
  // the Shape and Color controls can put it back.
  const own = new Map(instances.map((instance) => [instance, { ...instance.options }]));

  // Presets for every control. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  const PROFILES = {
    // The library's own defaults, on each element's own shape and color.
    default: {
      shape: 'own', ownColor: true, color: '#3a6ff7', strength: 1, duration: 550, fadeDuration: 450,
    },
    // Snappy feedback for a dense UI.
    quick: {
      shape: 'own', ownColor: true, color: '#3a6ff7', strength: 1, duration: 300, fadeDuration: 250,
    },
    // A slow, liquid spread.
    slow: {
      shape: 'own', ownColor: true, color: '#3a6ff7', strength: 1, duration: 1100, fadeDuration: 800,
    },
    // Spreads at the usual pace, then hangs in the air after release.
    linger: {
      shape: 'own', ownColor: true, color: '#3a6ff7', strength: 1, duration: 600, fadeDuration: 1600,
    },
    // Rings rolling out slowly, like a ping on a screen.
    sonar: {
      shape: 'rings', ownColor: false, color: '#2a9d8f', strength: 1.5, duration: 1200, fadeDuration: 900,
    },
    // A warm soft light that blooms under the press.
    glow: {
      shape: 'soft', ownColor: false, color: '#f3a712', strength: 2, duration: 700, fadeDuration: 900,
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    shape: document.getElementById('shapeSelect'),
    ownColor: document.getElementById('ownColorCheckbox'),
    color: document.getElementById('colorInput'),
    strength: document.getElementById('strengthRange'),
    duration: document.getElementById('durationRange'),
    fadeDuration: document.getElementById('fadeDurationRange'),
  };

  const sliderKeys = ['strength', 'duration', 'fadeDuration'];
  const UNITS = { strength: '×', duration: 'ms', fadeDuration: 'ms' };

  function syncLabels() {
    sliderKeys.forEach((key) => {
      document.getElementById(`${key}Val`).textContent = `${controls[key].value}${UNITS[key]}`;
    });
    controls.color.disabled = controls.ownColor.checked;
  }

  // Every instance gets the whole set on any change, worked out from its
  // own markup each time rather than from whatever it was last given, so
  // switching back to "each element's own" restores it exactly. Strength
  // scales each element's own opacity (its data-ripple-opacity, or its
  // shape's), so a ring stays stronger than a fill at any setting.
  function applyAll() {
    const strength = Number(controls.strength.value);
    instances.forEach((instance) => {
      const base = own.get(instance);
      const shape = controls.shape.value === 'own' ? (base.shape || 'fill') : controls.shape.value;
      const color = controls.ownColor.checked ? (base.color || null) : controls.color.value;
      const baseOpacity = Number.isFinite(base.opacity) ? base.opacity : Ripple.shapeOpacity(shape);
      instance.update({
        shape,
        color,
        opacity: Math.min(1, baseOpacity * strength),
        duration: Number(controls.duration.value),
        fadeDuration: Number(controls.fadeDuration.value),
      });
    });
  }

  function onChange() {
    syncLabels();
    applyAll();
  }

  sliderKeys.forEach((key) => controls[key].addEventListener('input', onChange));
  controls.shape.addEventListener('change', onChange);
  controls.ownColor.addEventListener('change', onChange);
  controls.color.addEventListener('input', onChange);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    sliderKeys.forEach((key) => {
      controls[key].value = profile[key];
    });
    controls.shape.value = profile.shape;
    controls.ownColor.checked = profile.ownColor;
    setColorInputValue(controls.color, profile.color);
    onChange();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  applyProfile('default');
});
