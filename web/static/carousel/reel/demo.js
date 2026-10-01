document.addEventListener('DOMContentLoaded', () => {
  // reel.js's own auto-init already claimed every reel on the page by the
  // time this runs (its DOMContentLoaded listener is registered first,
  // since this file loads after reel.js) - this is just a defensive
  // fallback, same as Sweep's demo.js.
  Reel.initAll();

  // The gallery ring below the hero takes wheelAxis: 'horizontal' rather
  // than the default 'both', for the same reason Dial's in-page discs do:
  // it's a large element sitting partway down a long page, so capturing
  // the vertical axis would stop the page scrolling every time the pointer
  // crossed it on the way past. The hero ring keeps the default - it's the
  // one with the controls attached, and its Wheel axis select switches
  // between all three settings live.
  const media = Reel.get('#reelMedia');
  if (media) media.update({ wheelAxis: 'horizontal' });

  const demo = Reel.get('#reelDemo');
  if (!demo) return;

  function apply(options) {
    demo.update(options);
  }

  // Cards 1-7 are the curated ones authored in index.body.html. Past that,
  // extra cards are generic placeholders, created lazily the first time the
  // slider asks for more than have existed so far and never destroyed
  // afterward - same recipe as Sweep's demo.js.
  const cardCountControl = document.getElementById('cardCountRange');
  const cardCountVal = document.getElementById('cardCountVal');
  const track = document.getElementById('reelDemoGrid');
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
      card.className = 'reel-card rl-card';
      card.innerHTML = `<span class="rl-card__num">${String(num).padStart(2, '0')}</span>`
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

  // Input-mode switches: which ways of spinning the ring are live, rather
  // than part of the feel a Profile tunes - kept independent of the
  // PROFILES table below, same reasoning as Sweep's. (`loop` is in the
  // table instead: it changes what the mechanism *is*, not which input
  // reaches it, and a profile wanting an arc with two ends has to be able
  // to say so.)
  const switches = ['clickToSelect', 'wheelEnabled'];
  const switchControls = {
    clickToSelect: document.getElementById('clickToSelectCheckbox'),
    wheelEnabled: document.getElementById('wheelEnabledCheckbox'),
  };
  switches.forEach((key) => {
    switchControls[key].addEventListener('change', () => {
      apply({ [key]: switchControls[key].checked });
    });
  });

  const wheelAxisSelect = document.getElementById('wheelAxisSelect');
  wheelAxisSelect.addEventListener('change', () => {
    apply({ wheelAxis: wheelAxisSelect.value });
  });

  // Presets for the controls below - picking one sets every control to a
  // known-good combination, but each stays freely editable afterward.
  const PROFILES = {
    default: {
      ringSize: 1, loop: true, autoAdvance: 0,
      cardStep: 140, cardAngle: 34, minScale: 0.32, maxDepth: 0.92, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Low cardAngle: many cards crowd into the visible ring at once.
    dense: {
      ringSize: 1, loop: true, autoAdvance: 0,
      cardStep: 140, cardAngle: 20, minScale: 0.4, maxDepth: 0.95, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // High cardAngle: a wide, open fan, fewer neighbors visible at once.
    open: {
      ringSize: 1, loop: true, autoAdvance: 0,
      cardStep: 160, cardAngle: 52, minScale: 0.3, maxDepth: 0.85, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Background cards shrink almost to nothing, but a high maxDepth keeps
    // the whole ring populated regardless - a faint, distant halo.
    tiny: {
      ringSize: 1, loop: true, autoAdvance: 0,
      cardStep: 140, cardAngle: 34, minScale: 0.12, maxDepth: 0.98, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.8, snapStrength: 0.045, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Light and fast: a short card step and a hard, quick-settling spring.
    snappy: {
      ringSize: 1, loop: true, autoAdvance: 0,
      cardStep: 90, cardAngle: 34, minScale: 0.32, maxDepth: 0.92, wheelSensitivity: 1.4,
      maxVelocity: 0.6, friction: 0.7, snapStrength: 0.09, wheelIdleDelay: 100, dragThreshold: 4,
    },
    // Loop off, so the ring has a first and last card to stop against.
    // Distances no longer wrap, so a tight cardAngle and a shallow visible
    // depth leave a readable arc rather than a crowd piled up at the back.
    arc: {
      ringSize: 0.9, loop: false, autoAdvance: 0,
      cardStep: 150, cardAngle: 26, minScale: 0.34, maxDepth: 0.7, wheelSensitivity: 1,
      maxVelocity: 0.4, friction: 0.84, snapStrength: 0.05, wheelIdleDelay: 140, dragThreshold: 6,
    },
    // Turning itself, slowly, with a ring pushed out past the box's edges
    // and a lazy spring - a display piece rather than a control. Resting
    // the pointer on it holds it still to be read.
    turntable: {
      ringSize: 1.2, loop: true, autoAdvance: 2200,
      cardStep: 170, cardAngle: 30, minScale: 0.26, maxDepth: 0.96, wheelSensitivity: 1,
      maxVelocity: 0.3, friction: 0.9, snapStrength: 0.035, wheelIdleDelay: 180, dragThreshold: 6,
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    ringSize: document.getElementById('ringSizeRange'),
    autoAdvance: document.getElementById('autoAdvanceRange'),
    cardStep: document.getElementById('cardStepRange'),
    cardAngle: document.getElementById('cardAngleRange'),
    minScale: document.getElementById('minScaleRange'),
    maxDepth: document.getElementById('maxDepthRange'),
    wheelSensitivity: document.getElementById('wheelSensitivityRange'),
    maxVelocity: document.getElementById('maxVelocityRange'),
    friction: document.getElementById('frictionRange'),
    snapStrength: document.getElementById('snapStrengthRange'),
    wheelIdleDelay: document.getElementById('wheelIdleDelayRange'),
    dragThreshold: document.getElementById('dragThresholdRange'),
    loop: document.getElementById('loopCheckbox'),
  };

  function syncLabels() {
    // Reads the ring's effective radii back off the instance rather than
    // echoing the slider, since the multiplier only means anything
    // against the box it's measured from - a reel in a 640x520 box and
    // one on a phone are both "1.00x" at very different sizes.
    const ring = Number(controls.ringSize.value);
    document.getElementById('ringSizeVal').textContent = `${ring.toFixed(2)}× · `
      + `${Math.round(demo.radiusX)}×${Math.round(demo.radiusY)}px`;
    const auto = Number(controls.autoAdvance.value);
    document.getElementById('autoAdvanceVal').textContent = auto > 0 ? `${auto}ms` : 'Off';
    document.getElementById('cardStepVal').textContent = `${controls.cardStep.value}px`;
    document.getElementById('cardAngleVal').textContent = `${controls.cardAngle.value}°`;
    document.getElementById('minScaleVal').textContent = controls.minScale.value;
    document.getElementById('maxDepthVal').textContent = controls.maxDepth.value;
    document.getElementById('wheelSensitivityVal').textContent = `${Number(controls.wheelSensitivity.value).toFixed(1)}×`;
    document.getElementById('maxVelocityVal').textContent = controls.maxVelocity.value;
    document.getElementById('frictionVal').textContent = controls.friction.value;
    document.getElementById('snapStrengthVal').textContent = controls.snapStrength.value;
    document.getElementById('wheelIdleDelayVal').textContent = `${controls.wheelIdleDelay.value}ms`;
    document.getElementById('dragThresholdVal').textContent = `${controls.dragThreshold.value}px`;
  }

  // Every control maps one range input straight onto one option - worth a
  // table rather than a dozen near-identical listener bodies.
  const numeric = [
    ['ringSize', 'ringSize'],
    ['autoAdvance', 'autoAdvance'],
    ['cardStep', 'cardStep'],
    ['cardAngle', 'cardAngle'],
    ['minScale', 'minScale'],
    ['maxDepth', 'maxDepth'],
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

  controls.loop.addEventListener('change', () => {
    apply({ loop: controls.loop.checked });
  });

  // See shared/demo-shared.js: one pass over the same tables the
  // individual listeners use, so a profile can only ever set what a
  // control could have set by hand.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({
      profile, controls, numeric, toggles: ['loop'],
    });
    apply(options);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  // The box's size is what the ring is measured against, so a viewport
  // change moves the radii the Ring size label reports.
  window.addEventListener('resize', syncLabels);

  applyProfile('default');
  applyCardCount(Number(cardCountControl.value));
  syncLabels();
});
