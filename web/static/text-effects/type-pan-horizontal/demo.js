document.addEventListener('DOMContentLoaded', () => {
  const typePan = TypePanHorizontal.get('.type-pan');
  const controlsPanel = document.querySelector('.controls');

  const controls = {
    driveMode: document.getElementById('driveModeButton'),
    typeDuration: document.getElementById('typeDurationRange'),
    holdDuration: document.getElementById('holdDurationRange'),
    rollbackSpeed: document.getElementById('rollbackSpeedRange'),
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    size: document.getElementById('sizeRange'),
    pan: document.getElementById('panRange'),
    lag: document.getElementById('lagRange'),
    erase: document.getElementById('eraseButton'),
    cursor: document.getElementById('cursorButton'),
    reset: document.getElementById('resetButton'),
  };

  const labels = {
    typeDuration: document.getElementById('typeDurationVal'),
    holdDuration: document.getElementById('holdDurationVal'),
    rollbackSpeed: document.getElementById('rollbackSpeedVal'),
    size: document.getElementById('sizeVal'),
    pan: document.getElementById('panVal'),
    lag: document.getElementById('lagVal'),
  };

  function syncLabels() {
    labels.typeDuration.textContent = `${controls.typeDuration.value}ms`;
    labels.holdDuration.textContent = `${controls.holdDuration.value}ms`;
    labels.rollbackSpeed.textContent = `${controls.rollbackSpeed.value}ms`;
    labels.size.textContent = `${controls.size.value}px`;
    labels.pan.textContent = controls.pan.value;
    labels.lag.textContent = controls.lag.value;
  }

  controls.driveMode.addEventListener('click', () => {
    const continuous = controls.driveMode.getAttribute('aria-pressed') !== 'true';

    controls.driveMode.setAttribute('aria-pressed', String(continuous));
    controls.driveMode.textContent = continuous ? 'Continuous' : 'Scroll';
    controlsPanel.dataset.driveMode = continuous ? 'continuous' : 'scroll';

    typePan.update({ driveMode: continuous ? 'continuous' : 'scroll' });
  });

  controls.typeDuration.addEventListener('input', () => {
    typePan.update({ typeDuration: Number(controls.typeDuration.value) });
    syncLabels();
  });

  controls.holdDuration.addEventListener('input', () => {
    typePan.update({ holdDuration: Number(controls.holdDuration.value) });
    syncLabels();
  });

  controls.rollbackSpeed.addEventListener('input', () => {
    typePan.update({ rollbackSpeed: Number(controls.rollbackSpeed.value) });
    syncLabels();
  });

  controls.font.addEventListener('input', () => {
    document.querySelector('.type-pan').style.fontFamily = controls.font.value;
    typePan.update({});
  });

  controls.text.addEventListener('input', () => {
    typePan.setText(controls.text.value);
  });

  controls.size.addEventListener('input', () => {
    document.documentElement.style.setProperty('--type-pan-size', `${controls.size.value}px`);
    typePan.update({});
    syncLabels();
  });

  controls.pan.addEventListener('input', () => {
    typePan.update({ panPosition: Number(controls.pan.value) });
    syncLabels();
  });

  controls.lag.addEventListener('input', () => {
    typePan.update({ lag: Number(controls.lag.value) });
    syncLabels();
  });

  controls.erase.addEventListener('click', () => {
    const eraseOnReverse = controls.erase.getAttribute('aria-pressed') !== 'true';

    controls.erase.setAttribute('aria-pressed', String(eraseOnReverse));
    controls.erase.textContent = eraseOnReverse ? 'Erasing on scroll back' : 'Keeping typed text';
    typePan.update({ eraseOnReverse });
  });

  controls.cursor.addEventListener('click', () => {
    const cursorBlink = controls.cursor.getAttribute('aria-pressed') !== 'true';

    controls.cursor.setAttribute('aria-pressed', String(cursorBlink));
    controls.cursor.textContent = cursorBlink ? 'Cursor blinking on' : 'Cursor blinking off';
    typePan.update({ cursorBlink });
  });

  controls.reset.addEventListener('click', () => {
    typePan.reset();
  });

  syncLabels();
});
