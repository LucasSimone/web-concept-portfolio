const PROFILES = {
  default: {
    offsetX: 0,
    offsetY: 60,
    lag: 0.15,
    rebound: 0,
    speed: 1,
    opacity: 0.5,
    blur: 0,
  },
  rebound: {
    offsetX: 0,
    offsetY: 60,
    lag: 0.15,
    rebound: 1.5,
    speed: 1,
    opacity: 0.5,
    blur: 0,
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const lagTexts = LagText.initAll();

  const textEls = Array.from(document.querySelectorAll('.lag-text'));

  const controls = {
    profile: document.getElementById('profileSelect'),
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
  };

  function updateAll(options) {
    lagTexts.forEach((lagText) => lagText.update(options));
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

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.font.addEventListener('input', () => {
    textEls.forEach((el) => {
      el.style.fontFamily = controls.font.value;
    });
  });

  controls.text.addEventListener('input', () => {
    lagTexts.forEach((lagText) => {
      lagText.setText(controls.text.value);
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

  controls.invert.addEventListener('click', () => {
    const inverted = controls.invert.getAttribute('aria-pressed') !== 'true';

    controls.invert.setAttribute('aria-pressed', String(inverted));
    controls.invert.textContent = inverted ? 'Main text lags behind' : 'Ghost lags behind';
    updateAll({ inverted });
  });

  syncLabels();
  applyProfile('default');
});
