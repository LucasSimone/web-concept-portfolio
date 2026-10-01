document.addEventListener('DOMContentLoaded', () => {
  // dial.js's own auto-init already claimed every dial on the page by the
  // time this runs (its DOMContentLoaded listener is registered first,
  // since this file loads after it) - this is just a defensive fallback,
  // same as the other carousel demos.
  Dial.initAll();

  // The three discs below the hero all take wheelAxis: 'horizontal'
  // rather than the default 'both', and the reason is the default's own
  // trade-off showing up in practice: they're large elements sitting in
  // the middle of a long page, so capturing the vertical axis would stop
  // the page scrolling every time the pointer crossed one on the way
  // down. The hero disc keeps the default - it's the one with the
  // controls attached, and its Wheel axis select switches between all
  // three settings live.

  // The second disc: hub lifted to the middle of a square box, so the
  // whole reel is in view at once, and the horizon pushed out of the way
  // so nothing fades on the far side. 12 cards at 30 degrees closes it
  // exactly.
  const full = Dial.get('#dialFull');
  if (full) {
    full.update({
      wheelAxis: 'horizontal',
      pivot: 0.5,
      cardAngle: 30,
      rimInset: 0.064,
      horizon: 180,
      fadeRange: 1,
      selectedScale: 1.2,
    });
  }

  // The content disc: 200x230 cards need a wider cardAngle than the
  // default to keep a clear chord between neighbors, and a little more
  // rim margin so the bigger boxes aren't crowding the edge. The horizon
  // is pushed past the default so the pair flanking the visible three
  // still ghosts in at the bottom corners rather than vanishing.
  const content = Dial.get('#dialContent');
  if (content) {
    content.update({
      wheelAxis: 'horizontal',
      cardAngle: 40,
      // A fraction, not pixels: these cards are sized in cqw, so the rim
      // margin has to scale with the disc too or it eats the clearance
      // between neighbors as the dial narrows.
      rimInset: 0.053,
      selectedScale: 1.1,
      horizon: 92,
      fadeRange: 40,
    });
  }

  // The mismatched disc. Nothing here is per-card configuration - each
  // card's distance from the hub comes from its own measured height, so
  // this is the same single set of options as any other disc.
  const mixed = Dial.get('#dialMixed');
  if (mixed) {
    mixed.update({
      wheelAxis: 'horizontal',
      cardAngle: 40,
      rimInset: 0.047,
      selectedScale: 1.08,
      horizon: 88,
      fadeRange: 40,
    });
  }

  const demo = Dial.get('#dialDemo');
  if (!demo) return;

  function apply(options) {
    demo.update(options);
  }

  // --- The plate under the disc ---------------------------------------
  // Driven by the bubbling dial-settle event rather than by polling: it
  // fires once a card has actually come to rest at the gate, not for
  // every card turned past on the way there. (The live counterpart is the
  // is-selected class, which this page uses in CSS to fade in each card's
  // own title as it reaches the top.)
  const dial = document.getElementById('dialDemo');
  const countEl = document.getElementById('dialCount');
  const titleEl = document.getElementById('dialTitle');

  function visibleCards() {
    return Array.from(dial.querySelectorAll('.dial-card')).filter((el) => !el.hidden);
  }

  function writePlate(index, total) {
    countEl.textContent = `${pad(index + 1)} / ${pad(total)}`;
    const card = visibleCards()[index];
    const title = card && card.querySelector('.dl-card__title');
    titleEl.textContent = title ? title.textContent : `Card ${index + 1}`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  dial.addEventListener('dial-settle', (event) => {
    const cards = visibleCards();
    writePlate(cards.indexOf(event.target), cards.length);
  });

  // --- Card count ------------------------------------------------------
  // Cards 1-14 are the curated ones authored in index.body.html. Past
  // that, extras reuse the same artwork and are created lazily the first
  // time the slider asks for more than have existed so far, never
  // destroyed afterward - same recipe as Sweep's, Reel's and Deck's
  // demo.js.
  const cardCountControl = document.getElementById('cardCountRange');
  const cardCountVal = document.getElementById('cardCountVal');
  const face = document.getElementById('dialDemoFace');
  const curatedCards = Array.from(face.children);
  const extraCards = [];
  const ART = ['a', 'b', 'c', 'd', 'e', 'f'];

  function applyCardCount(count) {
    curatedCards.forEach((card, i) => { card.hidden = i >= count; });

    const neededExtras = Math.max(0, count - curatedCards.length);
    while (extraCards.length < neededExtras) {
      const num = curatedCards.length + extraCards.length + 1;
      const card = document.createElement('div');
      card.className = 'dial-card dl-card';
      card.innerHTML = `<span class="dl-card__num">${pad(num)}</span>`
        + `<span class="dl-card__art dl-art--${ART[num % ART.length]}"></span>`
        + `<span class="dl-card__title">Card ${num}</span>`;
      face.appendChild(card);
      extraCards.push(card);
    }
    extraCards.forEach((card, i) => { card.hidden = i >= neededExtras; });

    demo.refresh();
    cardCountVal.textContent = String(count);
    writePlate(Math.max(0, demo.index), count);
  }

  // --- Controls --------------------------------------------------------
  const toggles = ['clickToSelect', 'wheelEnabled', 'rim', 'hub', 'gate'];
  const controls = {
    profile: document.getElementById('profileSelect'),
    cardAngle: document.getElementById('cardAngleRange'),
    pivot: document.getElementById('pivotRange'),
    radius: document.getElementById('radiusRange'),
    wheelAxis: document.getElementById('wheelAxisSelect'),
    rimInset: document.getElementById('rimInsetRange'),
    selectedScale: document.getElementById('selectedScaleRange'),
    horizon: document.getElementById('horizonRange'),
    fadeRange: document.getElementById('fadeRangeRange'),
    cardStep: document.getElementById('cardStepRange'),
    wheelSensitivity: document.getElementById('wheelSensitivityRange'),
    friction: document.getElementById('frictionRange'),
    snapStrength: document.getElementById('snapStrengthRange'),
    dragThreshold: document.getElementById('dragThresholdRange'),
    clickToSelect: document.getElementById('clickToSelectCheckbox'),
    wheelEnabled: document.getElementById('wheelEnabledCheckbox'),
    rim: document.getElementById('rimCheckbox'),
    hub: document.getElementById('hubCheckbox'),
    gate: document.getElementById('gateCheckbox'),
  };

  toggles.forEach((key) => {
    controls[key].addEventListener('change', () => {
      apply({ [key]: controls[key].checked });
    });
  });

  controls.wheelAxis.addEventListener('change', () => {
    apply({ wheelAxis: controls.wheelAxis.value });
  });

  // The largest radius that keeps the gate on screen is however far the
  // hub sits below the top of the box, so the Disc size ceiling has to
  // move with Hub position (and with the box, on a resize). Pinning it to
  // a fixed number instead would leave the top half of the slider doing
  // nothing at the default hub position, which reads as a broken control
  // rather than as a real constraint.
  function syncRadiusBounds() {
    const max = Math.max(40, Math.round(demo.maxRadius));
    if (String(max) === controls.radius.max) return;
    controls.radius.max = String(max);
    // A range input clamps its own value when max drops below it, so read
    // it back rather than trusting what was there a moment ago.
    const value = Number(controls.radius.value);
    apply({ radius: value > 0 ? value : null });
  }

  // Presets for the controls below - picking one sets every control to a
  // known-good combination, but each stays freely editable afterward.
  const PROFILES = {
    default: {
      cardAngle: 26, pivot: 1, radius: 0, wheelAxis: 'both', rimInset: 20, selectedScale: 1.14, horizon: 84, fadeRange: 36,
      cardStep: 120, wheelSensitivity: 1, friction: 0.86, snapStrength: 0.055, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: true, hub: true, gate: true,
    },
    // 360/14: set the card count to 14 and the disc closes exactly, with
    // seven cards above the horizon - the real reel's geometry.
    reel: {
      cardAngle: 25.7, pivot: 1, radius: 0, wheelAxis: 'both', rimInset: 22, selectedScale: 1.18, horizon: 90, fadeRange: 16,
      cardStep: 120, wheelSensitivity: 1, friction: 0.88, snapStrength: 0.05, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: true, hub: true, gate: true,
    },
    // A card angle tighter than the cards are wide, so they shingle into
    // a fanned deck instead of sitting apart. The z-order stacks outward
    // from the gate, which is what keeps that readable rather than messy.
    dense: {
      cardAngle: 11, pivot: 1, radius: 0, wheelAxis: 'both', rimInset: 16, selectedScale: 1.22, horizon: 80, fadeRange: 34,
      cardStep: 80, wheelSensitivity: 1.2, friction: 0.9, snapStrength: 0.06, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: true, hub: true, gate: true,
    },
    // Hub dropped below the box: a shallow slice of a much bigger disc,
    // so cards barely tilt on their way through.
    shallow: {
      cardAngle: 15, pivot: 1.55, radius: 0, wheelAxis: 'both', rimInset: 20, selectedScale: 1.12, horizon: 60, fadeRange: 26,
      cardStep: 120, wheelSensitivity: 1, friction: 0.86, snapStrength: 0.055, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: true, hub: true, gate: true,
    },
    // Hub lifted part way up and the horizon pushed out, for about three
    // quarters of the disc. Not all of it: lifting the hub shrinks the
    // disc to fit the box, and these cards would then be most of its
    // radius and pile over the hub. The gallery section below shows the
    // whole face properly, in a square box with cards scaled for it -
    // which is the actual rule, that card size has to come down with the
    // disc.
    threeQuarter: {
      cardAngle: 34, pivot: 0.75, radius: 0, wheelAxis: 'both', rimInset: 18, selectedScale: 1.18, horizon: 150, fadeRange: 44,
      cardStep: 120, wheelSensitivity: 1, friction: 0.88, snapStrength: 0.05, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: true, hub: true, gate: true,
    },
    // Nothing drawn but the cards - the mechanism with the object removed.
    bare: {
      cardAngle: 26, pivot: 1, radius: 0, wheelAxis: 'both', rimInset: 20, selectedScale: 1, horizon: 84, fadeRange: 44,
      cardStep: 120, wheelSensitivity: 1, friction: 0.86, snapStrength: 0.055, dragThreshold: 6,
      clickToSelect: true, wheelEnabled: true, rim: false, hub: false, gate: false,
    },
  };

  function syncLabels() {
    document.getElementById('cardAngleVal').textContent = `${Number(controls.cardAngle.value).toFixed(1)}°`;
    document.getElementById('pivotVal').textContent = Number(controls.pivot.value).toFixed(2);
    // Reads the effective radius back off the instance rather than
    // echoing the slider, so the vertical clamp (see _measure) shows up
    // as the number not moving instead of as the control going quietly
    // dead above it.
    const asked = Number(controls.radius.value);
    const actual = Math.round(demo.radius);
    document.getElementById('radiusVal').textContent = asked > 0
      ? `${actual}px`
      : `Fit · ${actual}px`;
    document.getElementById('rimInsetVal').textContent = `${controls.rimInset.value}px`;
    document.getElementById('selectedScaleVal').textContent = `${Number(controls.selectedScale.value).toFixed(2)}×`;
    document.getElementById('horizonVal').textContent = `${controls.horizon.value}°`;
    document.getElementById('fadeRangeVal').textContent = `${controls.fadeRange.value}°`;
    document.getElementById('cardStepVal').textContent = `${controls.cardStep.value}px`;
    document.getElementById('wheelSensitivityVal').textContent = `${Number(controls.wheelSensitivity.value).toFixed(1)}×`;
    document.getElementById('frictionVal').textContent = controls.friction.value;
    document.getElementById('snapStrengthVal').textContent = controls.snapStrength.value;
    document.getElementById('dragThresholdVal').textContent = `${controls.dragThreshold.value}px`;
  }

  // Every control maps one range input straight onto one option - worth a
  // table rather than eleven near-identical listener bodies.
  const numeric = [
    ['cardAngle', 'cardAngle'],
    ['pivot', 'pivot'],
    ['radius', 'radius', (v) => (v > 0 ? v : null)],
    ['rimInset', 'rimInset'],
    ['selectedScale', 'selectedScale'],
    ['horizon', 'horizon'],
    ['fadeRange', 'fadeRange'],
    ['cardStep', 'cardStep'],
    ['wheelSensitivity', 'wheelSensitivity'],
    ['friction', 'friction'],
    ['snapStrength', 'snapStrength'],
    ['dragThreshold', 'dragThreshold'],
  ];

  numeric.forEach(([key, option, transform]) => {
    controls[key].addEventListener('input', () => {
      const value = Number(controls[key].value);
      apply({ [option]: transform ? transform(value) : value });
      syncRadiusBounds();
      syncLabels();
    });
  });

  // See shared/demo-shared.js: one pass over the same tables the
  // individual listeners use, so a profile can only ever set what a
  // control could have set by hand.
  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;
    const options = applyProfileFromTable({
      profile, controls, numeric, toggles, directs: ['wheelAxis'],
    });
    apply(options);
    syncRadiusBounds();
    syncLabels();
  }

  cardCountControl.addEventListener('input', () => {
    applyCardCount(Number(cardCountControl.value));
  });

  controls.profile.addEventListener('change', () => applyProfile(controls.profile.value));

  // The box's height feeds maxRadius, so a viewport change moves the
  // ceiling too.
  window.addEventListener('resize', () => {
    syncRadiusBounds();
    syncLabels();
  });

  applyProfile('default');
  applyCardCount(Number(cardCountControl.value));
});
