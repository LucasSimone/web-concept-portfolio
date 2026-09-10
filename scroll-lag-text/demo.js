document.addEventListener('DOMContentLoaded', () => {
  LagText.initAll();

  const demoText = document.getElementById('demoText');
  const lagText = demoText.__lagTextInstance;

  const controls = {
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    size: document.getElementById('sizeRange'),
    offsetX: document.getElementById('offsetXRange'),
    offsetY: document.getElementById('offsetYRange'),
    lag: document.getElementById('lagRange'),
    speed: document.getElementById('speedRange'),
    opacity: document.getElementById('opacityRange'),
    blur: document.getElementById('blurRange'),
  };

  const labels = {
    size: document.getElementById('sizeVal'),
    offsetX: document.getElementById('offsetXVal'),
    offsetY: document.getElementById('offsetYVal'),
    lag: document.getElementById('lagVal'),
    speed: document.getElementById('speedVal'),
    opacity: document.getElementById('opacityVal'),
    blur: document.getElementById('blurVal'),
  };

  function updateAll(options) {
    lagText.update(options);
  }

  function syncLabels() {
    labels.size.textContent = `${controls.size.value}vw`;
    labels.offsetX.textContent = `${controls.offsetX.value}px`;
    labels.offsetY.textContent = `${controls.offsetY.value}px`;
    labels.lag.textContent = controls.lag.value;
    labels.speed.textContent = controls.speed.value;
    labels.opacity.textContent = controls.opacity.value;
    labels.blur.textContent = `${controls.blur.value}px`;
  }

  controls.font.addEventListener('input', () => {
    demoText.style.fontFamily = controls.font.value;
  });

  controls.text.addEventListener('input', () => {
    lagText.setText(controls.text.value);
  });

  controls.size.addEventListener('input', () => {
    document.documentElement.style.setProperty('--font-size', `${controls.size.value}vw`);
    syncLabels();
  });

  ['offsetX', 'offsetY', 'lag', 'speed', 'opacity', 'blur'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      updateAll({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  syncLabels();
});
