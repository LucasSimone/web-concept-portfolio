document.addEventListener('DOMContentLoaded', () => {
  // magnetic.js's own auto-init skips every element under
  // prefers-reduced-motion, but this page exists to try the effect out, so
  // set them up here regardless. initAll skips anything already claimed,
  // so this is a no-op in the normal case.
  Magnetic.initAll();
  const instances = Magnetic.getAll();

  // Presets for every control. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  const PROFILES = {
    // The library's own defaults.
    default: { strength: 0.35, radius: 60, stiffness: 220, damping: 16 },
    // Barely there: a short reach and no overshoot, for a dense UI where
    // a lot of moving buttons would be noise.
    subtle: { strength: 0.15, radius: 30, stiffness: 300, damping: 34 },
    // Loose and springy. It overshoots on the way in and wobbles back on
    // the way out.
    bouncy: { strength: 0.45, radius: 80, stiffness: 260, damping: 7 },
    // A soft spring and a long reach, so the element trails the cursor as
    // if it had weight.
    heavy: { strength: 0.4, radius: 140, stiffness: 60, damping: 12 },
    // Stiff and well damped: it sticks to the cursor with no lag at all.
    snappy: { strength: 0.3, radius: 40, stiffness: 700, damping: 40 },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    strength: document.getElementById('strengthRange'),
    radius: document.getElementById('radiusRange'),
    stiffness: document.getElementById('stiffnessRange'),
    damping: document.getElementById('dampingRange'),
  };

  // Every slider maps straight onto the option of the same name.
  const numeric = [
    ['strength', 'strength'],
    ['radius', 'radius'],
    ['stiffness', 'stiffness'],
    ['damping', 'damping'],
  ];

  const UNITS = { strength: '', radius: 'px', stiffness: '', damping: '' };

  function syncLabels() {
    numeric.forEach(([key]) => {
      document.getElementById(`${key}Val`).textContent = `${controls[key].value}${UNITS[key]}`;
    });
  }

  // An element that sets an option in its own markup (the icons' stronger
  // pull, the depth card's wider reach) keeps it: the panel only changes
  // what the markup left to the defaults.
  const ATTRS = {
    strength: 'magneticStrength',
    radius: 'magneticRadius',
    stiffness: 'magneticStiffness',
    damping: 'magneticDamping',
  };

  function apply(options) {
    instances.forEach((instance) => {
      const own = {};
      Object.keys(options).forEach((key) => {
        if (instance.el.dataset[ATTRS[key]] == null) own[key] = options[key];
      });
      instance.update(own);
    });
  }

  numeric.forEach(([key, option]) => {
    controls[key].addEventListener('input', () => {
      apply({ [option]: Number(controls[key].value) });
      syncLabels();
    });
  });

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    apply(applyProfileFromTable({ profile, controls, numeric }));
    syncLabels();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  applyProfile('default');
});
