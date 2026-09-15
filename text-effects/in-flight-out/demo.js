document.addEventListener('DOMContentLoaded', () => {
  const instance = InFlightOut.get('.in-flight-out');
  const textEl = document.querySelector('.in-flight-out');

  const controls = {
    randomize: document.getElementById('randomizeButton'),
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    path: document.getElementById('pathSelect'),
    scatter: document.getElementById('scatterRange'),
    maxDistance: document.getElementById('maxDistanceRange'),
    rotation: document.getElementById('rotationRange'),
    maxAngle: document.getElementById('maxAngleRange'),
    entry: document.getElementById('entryRange'),
    hang: document.getElementById('hangRange'),
    exit: document.getElementById('exitRange'),
  };

  const labels = {
    scatter: document.getElementById('scatterVal'),
    maxDistance: document.getElementById('maxDistanceVal'),
    rotation: document.getElementById('rotationVal'),
    maxAngle: document.getElementById('maxAngleVal'),
    entry: document.getElementById('entryVal'),
    hang: document.getElementById('hangVal'),
    exit: document.getElementById('exitVal'),
  };

  function syncLabels() {
    labels.scatter.textContent = controls.scatter.value;
    labels.maxDistance.textContent = `${controls.maxDistance.value}%`;
    labels.rotation.textContent = controls.rotation.value;
    labels.maxAngle.textContent = `${controls.maxAngle.value}°`;
    labels.entry.textContent = `${controls.entry.value}%`;
    labels.hang.textContent = `${controls.hang.value}%`;
    labels.exit.textContent = `${controls.exit.value}%`;
  }

  controls.font.addEventListener('input', () => {
    textEl.style.fontFamily = controls.font.value;
  });

  controls.text.addEventListener('input', () => {
    instance.setText(controls.text.value);
  });

  controls.path.addEventListener('change', () => {
    instance.update({ path: controls.path.value });
  });

  ['scatter', 'maxDistance', 'rotation', 'maxAngle'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      instance.update({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  // Entry/hangtime/exit always need to sum to 100 — when one slider moves,
  // redistribute the delta across the other two in proportion to their
  // current share (or split evenly if both are at 0).
  const phaseKeys = ['entry', 'hang', 'exit'];

  function normalizePhases(changedKey) {
    const values = {};
    phaseKeys.forEach((key) => {
      values[key] = Number(controls[key].value);
    });

    const others = phaseKeys.filter((key) => key !== changedKey);
    const remaining = 100 - values[changedKey];
    const othersSum = values[others[0]] + values[others[1]];

    if (othersSum <= 0) {
      values[others[0]] = remaining / 2;
      values[others[1]] = remaining / 2;
    } else {
      others.forEach((key) => {
        values[key] = remaining * (values[key] / othersSum);
      });
    }

    // Round to whole percents, then nudge the largest untouched slider so
    // the three still sum to exactly 100 after rounding.
    others.forEach((key) => {
      values[key] = Math.round(values[key]);
    });
    values[changedKey] = Math.round(values[changedKey]);

    const drift = 100 - (values.entry + values.hang + values.exit);
    if (drift !== 0) {
      const adjustKey = others.reduce(
        (a, b) => (values[a] >= values[b] ? a : b),
        others[0],
      );
      values[adjustKey] += drift;
    }

    phaseKeys.forEach((key) => {
      controls[key].value = values[key];
    });

    instance.update({
      entryPercent: values.entry,
      hangPercent: values.hang,
      exitPercent: values.exit,
    });
    syncLabels();
  }

  phaseKeys.forEach((key) => {
    controls[key].addEventListener('input', () => normalizePhases(key));
  });

  controls.randomize.addEventListener('click', () => {
    instance.reshuffle();
  });

  instance.update({
    path: controls.path.value,
    scatter: Number(controls.scatter.value),
    maxDistance: Number(controls.maxDistance.value),
    rotation: Number(controls.rotation.value),
    maxAngle: Number(controls.maxAngle.value),
    entryPercent: Number(controls.entry.value),
    hangPercent: Number(controls.hang.value),
    exitPercent: Number(controls.exit.value),
  });
  syncLabels();
});

