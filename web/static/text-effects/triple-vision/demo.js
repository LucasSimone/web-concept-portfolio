const PROFILES = {
  default: {
    offsetX: 100,
    offsetY: 40,
    lag: 0.15,
    rebound: 0,
    speed: 1,
    opacity: 0.75,
    blur: 0,
  },
  rebound: {
    offsetX: 100,
    offsetY: 40,
    lag: 0.15,
    rebound: 1.25,
    speed: 1,
    opacity: 0.75,
    blur: 0,
  },
};

// Continuous mode has no scroll input, so offsetX/lag/rebound instead shape
// the vibrate amplitude/spring or the rotate radius. interval is in seconds
// (converted to ms for the effect); speed is the rotate profile's rate.
const CONTINUOUS_PROFILES = {
  vibrate: { offsetX: 60, lag: 0.2, rebound: 1.8, interval: 2 },
  rotate: { offsetX: 10, speed: 1 },
};

document.addEventListener('DOMContentLoaded', () => {
  const instances = TripleVisionText.getAll();
  const textEls = Array.from(document.querySelectorAll('.triple-vision'));

  const controlsPanel = document.querySelector('.controls');

  const controls = {
    mode: document.getElementById('modeButton'),
    profile: document.getElementById('profileSelect'),
    continuousProfile: document.getElementById('continuousProfileSelect'),
    interval: document.getElementById('intervalRange'),
    rotateSpeed: document.getElementById('rotateSpeedRange'),
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    size: document.getElementById('sizeRange'),
    offsetX: document.getElementById('offsetXRange'),
    offsetY: document.getElementById('offsetYRange'),
    lag: document.getElementById('lagRange'),
    rebound: document.getElementById('reboundRange'),
    speed: document.getElementById('speedRange'),
    opacity: document.getElementById('opacityRange'),
    blur: document.getElementById('blurRange'),
    redColor: document.getElementById('redColorInput'),
    cyanColor: document.getElementById('cyanColorInput'),
    invert: document.getElementById('invertButton'),
  };

  const labels = {
    size: document.getElementById('sizeVal'),
    offsetX: document.getElementById('offsetXVal'),
    offsetY: document.getElementById('offsetYVal'),
    lag: document.getElementById('lagVal'),
    rebound: document.getElementById('reboundVal'),
    speed: document.getElementById('speedVal'),
    opacity: document.getElementById('opacityVal'),
    blur: document.getElementById('blurVal'),
    interval: document.getElementById('intervalVal'),
    rotateSpeed: document.getElementById('rotateSpeedVal'),
  };

  function updateAll(options) {
    instances.forEach((instance) => instance.update(options));
  }

  function syncLabels() {
    labels.size.textContent = `${controls.size.value}vw`;
    labels.offsetX.textContent = `${controls.offsetX.value}px`;
    labels.offsetY.textContent = `${controls.offsetY.value}px`;
    labels.lag.textContent = controls.lag.value;
    labels.rebound.textContent = controls.rebound.value;
    labels.speed.textContent = controls.speed.value;
    labels.opacity.textContent = controls.opacity.value;
    labels.blur.textContent = `${controls.blur.value}px`;
    labels.interval.textContent = Number(controls.interval.value) === 0 ? 'Continuous' : `${controls.interval.value}s`;
    labels.rotateSpeed.textContent = `${controls.rotateSpeed.value}x`;
  }

  function applyProfile(name) {
    const profile = PROFILES[name] || PROFILES.default;

    controls.offsetX.value = profile.offsetX;
    controls.offsetY.value = profile.offsetY;
    controls.lag.value = profile.lag;
    controls.rebound.value = profile.rebound;
    controls.speed.value = profile.speed;
    controls.opacity.value = profile.opacity;
    controls.blur.value = profile.blur;

    updateAll({ ...profile });
    syncLabels();
  }

  function applyContinuousProfile(name) {
    const preset = CONTINUOUS_PROFILES[name] || CONTINUOUS_PROFILES.vibrate;

    if (preset.offsetX !== undefined) controls.offsetX.value = preset.offsetX;
    if (preset.lag !== undefined) controls.lag.value = preset.lag;
    if (preset.rebound !== undefined) controls.rebound.value = preset.rebound;
    if (preset.interval !== undefined) controls.interval.value = preset.interval;
    if (preset.speed !== undefined) controls.rotateSpeed.value = preset.speed;

    controlsPanel.dataset.profile = name;

    const payload = { continuousProfile: name, ...preset };
    if (payload.interval !== undefined) payload.interval *= 1000; // seconds -> ms

    updateAll(payload);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.continuousProfile.addEventListener('change', () => {
    applyContinuousProfile(controls.continuousProfile.value);
  });

  controls.interval.addEventListener('input', () => {
    updateAll({ interval: Number(controls.interval.value) * 1000 });
    syncLabels();
  });

  controls.rotateSpeed.addEventListener('input', () => {
    updateAll({ speed: Number(controls.rotateSpeed.value) });
    syncLabels();
  });

  controls.mode.addEventListener('click', () => {
    const continuous = controls.mode.getAttribute('aria-pressed') !== 'true';

    controls.mode.setAttribute('aria-pressed', String(continuous));
    controls.mode.textContent = continuous ? 'Continuous' : 'Scroll';
    controlsPanel.dataset.mode = continuous ? 'continuous' : 'scroll';

    if (continuous) {
      applyContinuousProfile(controls.continuousProfile.value);
    } else {
      applyProfile(controls.profile.value);
    }
    updateAll({ mode: continuous ? 'continuous' : 'scroll' });
  });

  controls.font.addEventListener('input', () => {
    textEls.forEach((el) => {
      el.style.fontFamily = controls.font.value;
    });
  });

  controls.text.addEventListener('input', () => {
    instances.forEach((instance) => {
      instance.setText(controls.text.value);
    });
  });

  controls.size.addEventListener('input', () => {
    document.documentElement.style.setProperty('--font-size', `${controls.size.value}vw`);
    syncLabels();
  });

  ['offsetX', 'offsetY', 'lag', 'rebound', 'speed', 'opacity', 'blur'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      updateAll({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  controls.redColor.addEventListener('input', () => {
    updateAll({ redColor: controls.redColor.value });
  });

  controls.cyanColor.addEventListener('input', () => {
    updateAll({ cyanColor: controls.cyanColor.value });
  });

  controls.invert.addEventListener('click', () => {
    const inverted = controls.invert.getAttribute('aria-pressed') !== 'true';

    controls.invert.setAttribute('aria-pressed', String(inverted));
    controls.invert.textContent = inverted ? 'Cyan leads' : 'Red leads';
    updateAll({ inverted });
  });

  syncLabels();
  applyProfile('default');
});
