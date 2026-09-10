document.addEventListener('DOMContentLoaded', () => {
  const waveForm = WaveForm.initAll('.wave-form')[0];

  const controls = {
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    amplitude: document.getElementById('amplitudeRange'),
    frequency: document.getElementById('frequencyRange'),
    spread: document.getElementById('spreadRange'),
    drift: document.getElementById('driftRange'),
    fade: document.getElementById('fadeButton'),
  };

  const labels = {
    amplitude: document.getElementById('amplitudeVal'),
    frequency: document.getElementById('frequencyVal'),
    spread: document.getElementById('spreadVal'),
    drift: document.getElementById('driftVal'),
  };

  function syncLabels() {
    labels.amplitude.textContent = controls.amplitude.value;
    labels.frequency.textContent = controls.frequency.value;
    labels.spread.textContent = controls.spread.value;
    labels.drift.textContent = controls.drift.value;
  }

  controls.font.addEventListener('input', () => {
    const textEl = document.querySelector('.wave-form');
    textEl.style.fontFamily = controls.font.value;
  });

  controls.text.addEventListener('input', () => {
    waveForm.setText(controls.text.value);
  });

  ['amplitude', 'frequency', 'spread', 'drift'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      waveForm.update({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  controls.fade.addEventListener('click', () => {
    const fade = controls.fade.getAttribute('aria-pressed') !== 'true';

    controls.fade.setAttribute('aria-pressed', String(fade));
    controls.fade.textContent = fade ? 'Fading on' : 'Fading off';
    waveForm.update({ fade });
  });

  syncLabels();
});
