document.addEventListener('DOMContentLoaded', () => {
  const instances = Fireflies.getAll();

  // Presets for the sliders below. Picking one sets these controls to
  // known-good values, but each stays a normal editable control afterward.
  const PROFILES = {
    default: {
      count: 100, speed: 25, wander: 1.4, blinkMin: 1.2, blinkMax: 4, visibleMin: 0.4, visibleMax: 1.1, glowSize: 9, color: '#9acd32',
    },
    dense: {
      count: 100, speed: 30, wander: 1.4, blinkMin: 0.4, blinkMax: 1.4, visibleMin: 0.3, visibleMax: 0.7, glowSize: 9, color: '#9acd32',
    },
    sparse: {
      count: 20, speed: 6, wander: 0.4, blinkMin: 3, blinkMax: 8, visibleMin: 0.6, visibleMax: 1.8, glowSize: 9, color: '#9acd32',
    },
    flicker: {
      count: 100, speed: 25, wander: 1.4, blinkMin: 0.3, blinkMax: 1, visibleMin: 0.2, visibleMax: 0.3, glowSize: 9, color: '#9acd32',
    },
    slowglow: {
      count: 60, speed: 12, wander: 0.8, blinkMin: 1, blinkMax: 2.4, visibleMin: 2, visibleMax: 4, glowSize: 12, color: '#9acd32',
    },
    mono: {
      count: 100, speed: 25, wander: 1.4, blinkMin: 1.2, blinkMax: 4, visibleMin: 0.4, visibleMax: 1.1, glowSize: 9, color: '#000000',
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    count: document.getElementById('countRange'),
    speed: document.getElementById('speedRange'),
    wander: document.getElementById('wanderRange'),
    blinkMin: document.getElementById('blinkMinRange'),
    blinkMax: document.getElementById('blinkMaxRange'),
    visibleMin: document.getElementById('visibleMinRange'),
    visibleMax: document.getElementById('visibleMaxRange'),
    glowSize: document.getElementById('glowSizeRange'),
  };

  const labels = {
    count: document.getElementById('countVal'),
    speed: document.getElementById('speedVal'),
    wander: document.getElementById('wanderVal'),
    blinkMin: document.getElementById('blinkMinVal'),
    blinkMax: document.getElementById('blinkMaxVal'),
    visibleMin: document.getElementById('visibleMinVal'),
    visibleMax: document.getElementById('visibleMaxVal'),
    glowSize: document.getElementById('glowSizeVal'),
  };

  function syncLabels() {
    labels.count.textContent = controls.count.value;
    labels.speed.textContent = `${controls.speed.value}px/s`;
    labels.wander.textContent = controls.wander.value;
    labels.blinkMin.textContent = `${controls.blinkMin.value}s`;
    labels.blinkMax.textContent = `${controls.blinkMax.value}s`;
    labels.visibleMin.textContent = `${controls.visibleMin.value}s`;
    labels.visibleMax.textContent = `${controls.visibleMax.value}s`;
    labels.glowSize.textContent = `${controls.glowSize.value}px`;
  }

  const sliderKeys = ['count', 'speed', 'wander', 'blinkMin', 'blinkMax', 'visibleMin', 'visibleMax', 'glowSize'];

  sliderKeys.forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      const value = Number(controls[key].value);
      instances.forEach((instance) => instance.update({ [key]: value }));
    });
  });

  const colorPicker = document.getElementById('colorPicker');

  function syncColor() {
    const glowColor = hexToRgbString(colorPicker.value);
    instances.forEach((instance) => instance.update({ glowColor }));
  }

  colorPicker.addEventListener('input', syncColor);

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    sliderKeys.forEach((key) => {
      controls[key].value = profile[key];
    });
    colorPicker.value = profile.color;

    instances.forEach((instance) => instance.update({
      count: profile.count,
      speed: profile.speed,
      wander: profile.wander,
      blinkMin: profile.blinkMin,
      blinkMax: profile.blinkMax,
      visibleMin: profile.visibleMin,
      visibleMax: profile.visibleMax,
      glowSize: profile.glowSize,
      glowColor: hexToRgbString(profile.color),
    }));

    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  applyProfile('default');
});
