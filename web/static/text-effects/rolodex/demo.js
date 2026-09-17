document.addEventListener('DOMContentLoaded', () => {
  const instance = Rolodex.get('.rolodex');
  const textEl = document.querySelector('.rolodex');
  const controlsPanel = document.querySelector('.controls');

  // Presets for the flip-style controls below. Matches the "Profile"
  // pattern used on the Paint Drag demo page: picking a profile sets these
  // controls to known-good values, but each stays a normal editable
  // control afterward.
  const PROFILES = {
    'split-flap': { mode: 'split-flap', flipWidth: 50, perspective: 300, shading: 0.02 },
    'single-card': { mode: 'single-card', flipWidth: 95, perspective: 300, shading: 0 },
  };

  const controls = {
    driveMode: document.getElementById('driveModeSelect'),
    loopScroll: document.getElementById('loopScrollCheckbox'),
    loop: document.getElementById('loopCheckbox'),
    hoverScrollDistance: document.getElementById('hoverScrollDistanceRange'),
    interval: document.getElementById('intervalRange'),
    flipDuration: document.getElementById('flipDurationRange'),
    rollbackSpeed: document.getElementById('rollbackSpeedRange'),
    profile: document.getElementById('profileSelect'),
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    mode: document.getElementById('modeSelect'),
    flipWidth: document.getElementById('flipWidthRange'),
    perspective: document.getElementById('perspectiveRange'),
    shading: document.getElementById('shadingRange'),
  };

  const labels = {
    hoverScrollDistance: document.getElementById('hoverScrollDistanceVal'),
    interval: document.getElementById('intervalVal'),
    flipDuration: document.getElementById('flipDurationVal'),
    rollbackSpeed: document.getElementById('rollbackSpeedVal'),
    flipWidth: document.getElementById('flipWidthVal'),
    perspective: document.getElementById('perspectiveVal'),
    shading: document.getElementById('shadingVal'),
  };

  function syncLabels() {
    labels.hoverScrollDistance.textContent = `${controls.hoverScrollDistance.value}px`;
    labels.interval.textContent = `${controls.interval.value}ms`;
    labels.flipDuration.textContent = `${controls.flipDuration.value}ms`;
    labels.rollbackSpeed.textContent = `${controls.rollbackSpeed.value}ms`;
    labels.flipWidth.textContent = `${controls.flipWidth.value}%`;
    labels.perspective.textContent = `${controls.perspective.value}px`;
    labels.shading.textContent = controls.shading.value;
  }

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    controls.mode.value = profile.mode;
    controls.flipWidth.value = profile.flipWidth;
    controls.perspective.value = profile.perspective;
    controls.shading.value = profile.shading;

    instance.update(profile);
    syncLabels();
  }

  controls.driveMode.addEventListener('change', () => {
    const driveMode = controls.driveMode.value;
    controlsPanel.dataset.driveMode = driveMode;
    instance.update({ driveMode });
  });

  controls.loopScroll.addEventListener('change', () => {
    instance.update({ loopScroll: controls.loopScroll.checked });
  });

  controls.loop.addEventListener('change', () => {
    controlsPanel.dataset.loop = controls.loop.checked;
    instance.update({ loop: controls.loop.checked });
  });

  controls.hoverScrollDistance.addEventListener('input', () => {
    instance.update({ hoverScrollDistance: Number(controls.hoverScrollDistance.value) });
    syncLabels();
  });

  controls.interval.addEventListener('input', () => {
    instance.update({ interval: Number(controls.interval.value) });
    syncLabels();
  });

  controls.flipDuration.addEventListener('input', () => {
    instance.update({ flipDuration: Number(controls.flipDuration.value) });
    syncLabels();
  });

  controls.rollbackSpeed.addEventListener('input', () => {
    instance.update({ rollbackSpeed: Number(controls.rollbackSpeed.value) });
    syncLabels();
  });

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.font.addEventListener('input', () => {
    textEl.style.fontFamily = controls.font.value;
    instance.remeasure();
  });

  controls.text.addEventListener('input', () => {
    instance.setText(controls.text.value);
  });

  controls.mode.addEventListener('change', () => {
    instance.update({ mode: controls.mode.value });
  });

  controls.flipWidth.addEventListener('input', () => {
    instance.update({ flipWidth: Number(controls.flipWidth.value) });
    syncLabels();
  });

  controls.perspective.addEventListener('input', () => {
    instance.update({ perspective: Number(controls.perspective.value) });
    syncLabels();
  });

  controls.shading.addEventListener('input', () => {
    instance.update({ shading: Number(controls.shading.value) });
    syncLabels();
  });

  applyProfile('split-flap');
});
