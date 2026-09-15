document.addEventListener('DOMContentLoaded', () => {
  const instances = CircuitBoard.getAll();

  const controls = {
    maxTraces: document.getElementById('maxTracesRange'),
    cell: document.getElementById('cellRange'),
    maxLength: document.getElementById('maxLengthRange'),
    speed: document.getElementById('speedRange'),
    fadeDuration: document.getElementById('fadeDurationRange'),
  };

  const labels = {
    maxTraces: document.getElementById('maxTracesVal'),
    cell: document.getElementById('cellVal'),
    maxLength: document.getElementById('maxLengthVal'),
    speed: document.getElementById('speedVal'),
    fadeDuration: document.getElementById('fadeDurationVal'),
  };

  const overlapToggle = document.getElementById('overlapToggle');
  const randomizeButton = document.getElementById('randomizeButton');

  function syncLabels() {
    labels.maxTraces.textContent = controls.maxTraces.value;
    labels.cell.textContent = `${controls.cell.value}px`;
    labels.maxLength.textContent = controls.maxLength.value;
    labels.speed.textContent = controls.speed.value;
    labels.fadeDuration.textContent = `${Number(controls.fadeDuration.value).toFixed(1)}s`;
  }

  Object.keys(controls).forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      const value = Number(controls[key].value);
      instances.forEach((instance) => instance.update({ [key]: value }));
    });
  });

  function setOverlap(allow) {
    overlapToggle.setAttribute('aria-pressed', String(allow));
    overlapToggle.textContent = allow ? 'Overlap: On' : 'Overlap: Off';
    instances.forEach((instance) => instance.update({ allowOverlap: allow }));
  }

  overlapToggle.addEventListener('click', () => {
    setOverlap(overlapToggle.getAttribute('aria-pressed') !== 'true');
  });

  randomizeButton.addEventListener('click', () => {
    instances.forEach((instance) => instance.randomize());
  });

  syncLabels();
});
