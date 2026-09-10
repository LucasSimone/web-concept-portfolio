document.addEventListener('DOMContentLoaded', () => {
  const instances = TripleVisionText.initAll();
  const textEls = Array.from(document.querySelectorAll('.triple-vision'));

  const controls = {
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
  }

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
});
