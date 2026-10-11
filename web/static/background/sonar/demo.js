document.addEventListener('DOMContentLoaded', () => {
  const instances = Sonar.getAll();

  // Presets for the controls below. Picking one sets them to known-good
  // values, but each stays a normal editable control afterward.
  const PROFILES = {
    default: {
      speed: 380, range: 800, reflectivity: 0.7, fade: 1.5, autoPing: 0, glow: 0,
      text: 'auto', color: '#000000', background: '#ffffff',
    },
    radar: {
      speed: 320, range: 1000, reflectivity: 0.7, fade: 2.5, autoPing: 0, glow: 0.12,
      text: 'auto', color: '#3dff8b', background: '#04140b',
    },
    deep: {
      speed: 220, range: 1200, reflectivity: 0.8, fade: 3, autoPing: 0, glow: 0.08,
      text: 'auto', color: '#9fe7ff', background: '#06243a',
    },
    echo: {
      speed: 560, range: 2000, reflectivity: 0.92, fade: 0.8, autoPing: 0, glow: 0,
      text: 'glyphs', color: '#000000', background: '#ffffff',
    },
    watch: {
      speed: 320, range: 900, reflectivity: 0.7, fade: 2, autoPing: 1.5, glow: 0.12,
      text: 'auto', color: '#3dff8b', background: '#04140b',
    },
  };

  const sliderKeys = ['speed', 'range', 'reflectivity', 'fade', 'autoPing', 'glow'];

  const controls = {
    profile: document.getElementById('profileSelect'),
    text: document.getElementById('textSelect'),
  };
  const labels = {};
  sliderKeys.forEach((key) => {
    controls[key] = document.getElementById(`${key}Range`);
    labels[key] = document.getElementById(`${key}Val`);
  });

  const FORMAT = {
    speed: (v) => `${v}px/s`,
    range: (v) => `${v}px`,
    reflectivity: (v) => `${Math.round(v * 100)}%`,
    fade: (v) => `${Number(v).toFixed(1)}s`,
    autoPing: (v) => (Number(v) ? `${Number(v).toFixed(1)}s` : 'Off'),
    glow: (v) => (Number(v) ? `${Math.round(v * 100)}%` : 'Off'),
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

  controls.text.addEventListener('change', () => {
    apply({ text: controls.text.value });
  });

  const colorInput = document.getElementById('colorInput');
  const backgroundInput = document.getElementById('backgroundInput');
  colorInput.addEventListener('input', () => apply({ color: colorInput.value }));
  backgroundInput.addEventListener('input', () => apply({ background: backgroundInput.value }));

  // Not part of any profile either: how clicks behave is the visitor's
  // call.
  const originSelect = document.getElementById('originSelect');
  originSelect.addEventListener('change', () => apply({ origin: originSelect.value }));

  // Not part of any profile, so switching presets doesn't hide the walls
  // again while someone is looking at them.
  const wallsToggle = document.getElementById('wallsToggle');
  wallsToggle.addEventListener('click', () => {
    const on = wallsToggle.getAttribute('aria-pressed') !== 'true';
    wallsToggle.setAttribute('aria-pressed', String(on));
    wallsToggle.textContent = `Show walls: ${on ? 'On' : 'Off'}`;
    apply({ showWalls: on });
  });

  const numeric = sliderKeys.map((key) => [key, key]);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({ profile, controls, numeric, directs: ['text'] });
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
