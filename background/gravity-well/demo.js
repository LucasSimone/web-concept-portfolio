document.addEventListener('DOMContentLoaded', () => {
  const instances = GravityWell.getAll();

  const controls = {
    cell: document.getElementById('cellRange'),
    radius: document.getElementById('radiusRange'),
    strength: document.getElementById('strengthRange'),
    ease: document.getElementById('easeRange'),
  };

  const labels = {
    cell: document.getElementById('cellVal'),
    radius: document.getElementById('radiusVal'),
    strength: document.getElementById('strengthVal'),
    ease: document.getElementById('easeVal'),
  };

  function syncLabels() {
    labels.cell.textContent = `${controls.cell.value}px`;
    labels.radius.textContent = `${controls.radius.value}px`;
    labels.strength.textContent = `${controls.strength.value}px`;
    labels.ease.textContent = controls.ease.value;
  }

  Object.keys(controls).forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      const value = Number(controls[key].value);
      instances.forEach((instance) => instance.update({ [key]: value }));
    });
  });

  const modeToggle = document.getElementById('modeToggle');

  function setMode(dots) {
    modeToggle.setAttribute('aria-pressed', String(dots));
    modeToggle.textContent = dots ? 'View: Dots' : 'View: Grid';
    instances.forEach((instance) => instance.update({ mode: dots ? 'dots' : 'grid' }));
  }

  modeToggle.addEventListener('click', () => {
    setMode(modeToggle.getAttribute('aria-pressed') !== 'true');
  });

  syncLabels();
});
