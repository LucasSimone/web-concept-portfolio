document.addEventListener('DOMContentLoaded', () => {
  // sweep.js's own auto-init already claimed both strips on the page by
  // the time this runs (its DOMContentLoaded listener is registered first,
  // since this file loads after sweep.js) - so this is just a defensive
  // fallback in case that hasn't happened yet, same as every other demo
  // page's own initAll() call. initAll() skips anything already claimed,
  // so running it again here is a no-op in the normal case.
  Sweep.initAll();
  const demo = Sweep.get('#sweepDemo');
  if (!demo) return;

  function apply(options) {
    demo.update(options);
  }

  // Cards 1-7 are the curated ones authored in index.body.html. Past that,
  // extra cards are generic placeholders, created lazily the first time the
  // slider asks for more than have existed so far and never destroyed
  // afterward - just hidden, same as the docs' "Filtering the cards" recipe
  // (hide + call .refresh()) rather than removed and rebuilt each time.
  const cardCountControl = document.getElementById('cardCountRange');
  const cardCountVal = document.getElementById('cardCountVal');
  const track = document.getElementById('sweepDemoGrid');
  const curatedCards = Array.from(track.children);
  const extraCards = [];
  const LOREM_IPSUM = 'Lorem ipsum dolor sit amet, consectetur adipiscing '
    + 'elit. Sed do eiusmod tempor incididunt ut labore et dolore magna '
    + 'aliqua.';

  function applyCardCount(count) {
    curatedCards.forEach((card, i) => { card.hidden = i >= count; });

    const neededExtras = Math.max(0, count - curatedCards.length);
    while (extraCards.length < neededExtras) {
      const num = curatedCards.length + extraCards.length + 1;
      const card = document.createElement('div');
      card.className = 'sweep-card sw-card';
      card.innerHTML = `<span class="sw-card__num">${String(num).padStart(2, '0')}</span>`
        + `<h3>Card ${num}</h3><p>${LOREM_IPSUM}</p>`;
      track.appendChild(card);
      extraCards.push(card);
    }
    extraCards.forEach((card, i) => { card.hidden = i >= neededExtras; });

    demo.refresh();
    cardCountVal.textContent = String(count);
  }

  cardCountControl.addEventListener('input', () => {
    applyCardCount(Number(cardCountControl.value));
  });

  // Hover/wheel are input-mode switches, not part of the feel a Profile
  // tunes - kept independent of the PROFILES table below, same as Cards
  // above, so switching profiles never silently re-enables one a visitor
  // just turned off.
  const hoverFollowCheckbox = document.getElementById('hoverFollowCheckbox');
  const wheelEnabledCheckbox = document.getElementById('wheelEnabledCheckbox');
  hoverFollowCheckbox.addEventListener('change', () => {
    apply({ hoverFollow: hoverFollowCheckbox.checked });
  });
  wheelEnabledCheckbox.addEventListener('change', () => {
    apply({ wheelEnabled: wheelEnabledCheckbox.checked });
  });

  // Presets for the controls below. Matches the "Profile" pattern used on
  // the other demo pages: picking one sets every control to a known-good
  // combination, but each stays freely editable afterward.
  const PROFILES = {
    default: {
      cardStep: 200, minScale: 0.42, scaleDecay: 0.75, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Light and fast: a short card step and a hard, quick-settling spring.
    snappy: {
      cardStep: 120, minScale: 0.5, scaleDecay: 0.85, wheelSensitivity: 1.4,
      maxVelocity: 0.6, friction: 0.7, snapStrength: 0.09, wheelIdleDelay: 100, dragThreshold: 4,
    },
    // Heavier, coasts a long way before catching - a lazier browse.
    floaty: {
      cardStep: 220, minScale: 0.42, scaleDecay: 0.65, wheelSensitivity: 0.8,
      maxVelocity: 0.3, friction: 0.9, snapStrength: 0.02, wheelIdleDelay: 220, dragThreshold: 8,
    },
    // Takes much more input to travel the same distance - a long throw.
    wide: {
      cardStep: 360, minScale: 0.5, scaleDecay: 0.6, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.82, snapStrength: 0.04, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Neighbors drop away fast and small - the focused card reads as
    // standing apart from a tightly packed stack behind it.
    stacked: {
      cardStep: 200, minScale: 0.18, scaleDecay: 1.3, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    cardStep: document.getElementById('cardStepRange'),
    minScale: document.getElementById('minScaleRange'),
    scaleDecay: document.getElementById('scaleDecayRange'),
    wheelSensitivity: document.getElementById('wheelSensitivityRange'),
    maxVelocity: document.getElementById('maxVelocityRange'),
    friction: document.getElementById('frictionRange'),
    snapStrength: document.getElementById('snapStrengthRange'),
    wheelIdleDelay: document.getElementById('wheelIdleDelayRange'),
    dragThreshold: document.getElementById('dragThresholdRange'),
  };

  function syncLabels() {
    document.getElementById('cardStepVal').textContent = `${controls.cardStep.value}px`;
    document.getElementById('minScaleVal').textContent = controls.minScale.value;
    document.getElementById('scaleDecayVal').textContent = controls.scaleDecay.value;
    document.getElementById('wheelSensitivityVal').textContent = `${Number(controls.wheelSensitivity.value).toFixed(1)}×`;
    document.getElementById('maxVelocityVal').textContent = controls.maxVelocity.value;
    document.getElementById('frictionVal').textContent = controls.friction.value;
    document.getElementById('snapStrengthVal').textContent = controls.snapStrength.value;
    document.getElementById('wheelIdleDelayVal').textContent = `${controls.wheelIdleDelay.value}ms`;
    document.getElementById('dragThresholdVal').textContent = `${controls.dragThreshold.value}px`;
  }

  // Every control maps one range input straight onto one option - worth a
  // table rather than nine near-identical listener bodies.
  const numeric = [
    ['cardStep', 'cardStep'],
    ['minScale', 'minScale'],
    ['scaleDecay', 'scaleDecay'],
    ['wheelSensitivity', 'wheelSensitivity'],
    ['maxVelocity', 'maxVelocity'],
    ['friction', 'friction'],
    ['snapStrength', 'snapStrength'],
    ['wheelIdleDelay', 'wheelIdleDelay'],
    ['dragThreshold', 'dragThreshold'],
  ];

  numeric.forEach(([key, option]) => {
    controls[key].addEventListener('input', () => {
      apply({ [option]: Number(controls[key].value) });
      syncLabels();
    });
  });

  // See shared/demo-shared.js: one pass over the same table the individual
  // listeners use, so a profile can only ever set what a control could
  // have set by hand.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({ profile, controls, numeric });
    apply(options);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  applyProfile('default');
  applyCardCount(Number(cardCountControl.value));
});
