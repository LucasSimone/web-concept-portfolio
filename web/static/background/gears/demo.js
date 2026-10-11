document.addEventListener('DOMContentLoaded', () => {
  const instances = Gears.getAll();

  // Presets for the controls below. Picking one sets them to known-good
  // values, but each stays a normal editable control afterward.
  const PROFILES = {
    default: {
      toothSize: 4, maxTeeth: 36, density: 0.3, speed: 16, powered: 0.5, coast: 1.5,
      decorate: 'auto', color: '#000000', background: '#ffffff',
    },
    watch: {
      toothSize: 2.5, maxTeeth: 54, density: 0.45, speed: 8, powered: 0.8, coast: 2.5,
      decorate: 'spokes', color: '#6b4e16', background: '#f7f1e3',
    },
    industrial: {
      toothSize: 7, maxTeeth: 28, density: 0.35, speed: 30, powered: 0.6, coast: 0.8,
      decorate: 'holes', color: '#222222', background: '#e9e9e6',
    },
    blueprint: {
      toothSize: 4, maxTeeth: 40, density: 0.35, speed: 12, powered: 0.5, coast: 1.5,
      decorate: 'auto', color: '#e8f0ff', background: '#1d4e89',
    },
    idle: {
      toothSize: 4, maxTeeth: 36, density: 0.3, speed: 16, powered: 0, coast: 3,
      decorate: 'auto', color: '#000000', background: '#ffffff',
    },
  };

  const sliderKeys = ['toothSize', 'maxTeeth', 'density', 'speed', 'powered', 'coast'];

  const controls = {
    profile: document.getElementById('profileSelect'),
    decorate: document.getElementById('decorateSelect'),
  };
  const labels = {};
  sliderKeys.forEach((key) => {
    controls[key] = document.getElementById(`${key}Range`);
    labels[key] = document.getElementById(`${key}Val`);
  });

  const FORMAT = {
    toothSize: (v) => `${v}px`,
    maxTeeth: (v) => `${v} teeth`,
    density: (v) => `${Math.round(v * 100)}%`,
    speed: (v) => `${v}px/s`,
    powered: (v) => `${Math.round(v * 100)}%`,
    coast: (v) => `${Number(v).toFixed(1)}s`,
  };

  function syncLabels() {
    sliderKeys.forEach((key) => {
      labels[key].textContent = FORMAT[key](controls[key].value);
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

  controls.decorate.addEventListener('change', () => {
    apply({ decorate: controls.decorate.value });
  });

  const colorInput = document.getElementById('colorInput');
  const backgroundInput = document.getElementById('backgroundInput');
  colorInput.addEventListener('input', () => apply({ color: colorInput.value }));
  backgroundInput.addEventListener('input', () => apply({ background: backgroundInput.value }));

  // Not part of any profile: how the mouse behaves is the visitor's call,
  // and switching presets shouldn't quietly turn either back on.
  function bindToggle(id, option, text) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      button.textContent = `${text}: ${on ? 'On' : 'Off'}`;
      apply({ [option]: on });
    });
  }
  bindToggle('grabToggle', 'grab', 'Drag to turn');
  bindToggle('brushToggle', 'brush', 'Brush to push');

  document.getElementById('randomizeButton').addEventListener('click', () => {
    instances.forEach((instance) => instance.randomize());
  });

  const numeric = sliderKeys.map((key) => [key, key]);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({ profile, controls, numeric, directs: ['decorate'] });
    setColorInputValue(colorInput, profile.color);
    setColorInputValue(backgroundInput, profile.background);
    apply({ ...options, color: colorInput.value, background: backgroundInput.value });
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  applyProfile('default');
});
