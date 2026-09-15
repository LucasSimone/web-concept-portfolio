document.addEventListener('DOMContentLoaded', () => {
  const instances = Vacuum.getAll();

  const controls = {
    radius: document.getElementById('radiusRange'),
    density: document.getElementById('densityRange'),
    speed: document.getElementById('speedRange'),
    particleSize: document.getElementById('sizeRange'),
    maxParticles: document.getElementById('maxRange'),
  };

  const labels = {
    radius: document.getElementById('radiusVal'),
    density: document.getElementById('densityVal'),
    speed: document.getElementById('speedVal'),
    particleSize: document.getElementById('sizeVal'),
    maxParticles: document.getElementById('maxVal'),
  };

  function syncLabels() {
    labels.radius.textContent = `${controls.radius.value}px`;
    labels.density.textContent = `${controls.density.value}px`;
    labels.speed.textContent = controls.speed.value;
    labels.particleSize.textContent = `${controls.particleSize.value}px`;
    labels.maxParticles.textContent = controls.maxParticles.value;
  }

  Object.keys(controls).forEach((key) => {
    controls[key].addEventListener('input', () => {
      syncLabels();
      const value = Number(controls[key].value);
      instances.forEach((instance) => instance.update({ [key]: value }));
      if (key === 'density') {
        instances.forEach((instance) => instance._rebuildPoints());
      }
    });
  });

  syncLabels();
});
