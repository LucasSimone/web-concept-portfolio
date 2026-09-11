document.addEventListener('DOMContentLoaded', () => {
  const typePanVertical = TypePanVertical.initAll('.type-pan-vertical')[0];

  const controls = {
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    size: document.getElementById('sizeRange'),
    pan: document.getElementById('panRange'),
    lag: document.getElementById('lagRange'),
    erase: document.getElementById('eraseButton'),
    cursor: document.getElementById('cursorButton'),
  };

  const labels = {
    size: document.getElementById('sizeVal'),
    pan: document.getElementById('panVal'),
    lag: document.getElementById('lagVal'),
  };

  function syncLabels() {
    labels.size.textContent = `${controls.size.value}px`;
    labels.pan.textContent = controls.pan.value;
    labels.lag.textContent = controls.lag.value;
  }

  controls.font.addEventListener('input', () => {
    document.querySelector('.type-pan-vertical').style.fontFamily = controls.font.value;
  });

  controls.text.addEventListener('input', () => {
    typePanVertical.setText(controls.text.value);
  });

  controls.size.addEventListener('input', () => {
    document.documentElement.style.setProperty('--type-pan-size', `${controls.size.value}px`);
    syncLabels();
  });

  controls.pan.addEventListener('input', () => {
    typePanVertical.update({ panPosition: Number(controls.pan.value) });
    syncLabels();
  });

  controls.lag.addEventListener('input', () => {
    typePanVertical.update({ lag: Number(controls.lag.value) });
    syncLabels();
  });

  controls.erase.addEventListener('click', () => {
    const eraseOnReverse = controls.erase.getAttribute('aria-pressed') !== 'true';

    controls.erase.setAttribute('aria-pressed', String(eraseOnReverse));
    controls.erase.textContent = eraseOnReverse ? 'Erasing on scroll back' : 'Keeping typed text';
    typePanVertical.update({ eraseOnReverse });
  });

  controls.cursor.addEventListener('click', () => {
    const cursorBlink = controls.cursor.getAttribute('aria-pressed') !== 'true';

    controls.cursor.setAttribute('aria-pressed', String(cursorBlink));
    controls.cursor.textContent = cursorBlink ? 'Cursor blinking on' : 'Cursor blinking off';
    typePanVertical.update({ cursorBlink });
  });

  syncLabels();
});
