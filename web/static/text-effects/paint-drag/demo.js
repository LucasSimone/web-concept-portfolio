document.addEventListener('DOMContentLoaded', () => {
  const primary = PaintDrag.get('#demoText');

  // Sits below the sitewide nav (z-index: 20, shared/site.css) so the
  // trail's fixed, page-level overlay canvas doesn't paint over it as the
  // hero text scrolls past the top of the page (same fix as the home
  // page's carousel-card usage - see home.js).
  primary.update({ zIndex: 10 });

  // Presets for the sliders/toggles below. "size" is in vw, matching the
  // font-size range input; everything else maps straight onto PaintDrag
  // options.
  const PROFILES = {
    default: {
      size: 12, smearLength: 0, spread: 0, fadeTime: 0.5, density: 0, blur: 10, skew: true,
    },
    minimal: {
      size: 12, smearLength: 0, spread: 0, fadeTime: 0.1, density: 0, blur: 10, skew: true,
    },
    pain: {
      size: 12, smearLength: 0, spread: 80, fadeTime: 0, density: 0, blur: 10, skew: true,
    },
    // Matches the tuned options passed to PaintDrag on the home page's
    // small carousel-card preview (h2.paint-drag, 28px) - smearLength and
    // spread are absolute pixel values, not proportional to font size, so
    // the "Default" profile's numbers (meant for large headline text)
    // balloon far past the letters themselves at card scale. Keep this in
    // sync with index.html's PaintDrag.initAll('.variation-card h2.paint-drag', ...) call.
    small: {
      size: 2, smearLength: 8, spread: 1, fadeTime: 0.4, density: 3, blur: 2, skew: true,
    },
  };

  const controls = {
    profile: document.getElementById('profileSelect'),
    font: document.getElementById('fontSelect'),
    text: document.getElementById('textInput'),
    size: document.getElementById('sizeRange'),
    smearLength: document.getElementById('smearLengthRange'),
    spread: document.getElementById('spreadRange'),
    fadeTime: document.getElementById('fadeTimeRange'),
    density: document.getElementById('densityRange'),
    blur: document.getElementById('blurRange'),
    skew: document.getElementById('skewButton'),
  };

  const labels = {
    size: document.getElementById('sizeVal'),
    smearLength: document.getElementById('smearLengthVal'),
    spread: document.getElementById('spreadVal'),
    fadeTime: document.getElementById('fadeTimeVal'),
    density: document.getElementById('densityVal'),
    blur: document.getElementById('blurVal'),
  };

  function syncLabels() {
    labels.size.textContent = `${controls.size.value}vw`;
    labels.smearLength.textContent = `${controls.smearLength.value}px`;
    labels.spread.textContent = `${controls.spread.value}px`;
    labels.fadeTime.textContent = `${controls.fadeTime.value}s`;
    labels.density.textContent = controls.density.value;
    labels.blur.textContent = `${controls.blur.value}px`;
  }

  function setSkew(skew) {
    controls.skew.setAttribute('aria-pressed', String(skew));
    controls.skew.textContent = skew ? 'Skew on' : 'Skew off';
    primary.update({ skew });
  }

  function applyProfile(name) {
    const profile = PROFILES[name];
    if (!profile) return;

    controls.size.value = profile.size;
    document.documentElement.style.setProperty('--font-size', `${profile.size}vw`);

    ['smearLength', 'spread', 'fadeTime', 'density', 'blur'].forEach((key) => {
      controls[key].value = profile[key];
    });

    primary.update({
      smearLength: profile.smearLength,
      spread: profile.spread,
      fadeTime: profile.fadeTime,
      density: profile.density,
      blur: profile.blur,
    });

    setSkew(profile.skew);
    syncLabels();
  }

  controls.profile.addEventListener('change', () => {
    applyProfile(controls.profile.value);
  });

  controls.font.addEventListener('input', () => {
    document.getElementById('demoText').style.fontFamily = controls.font.value;
  });

  controls.text.addEventListener('input', () => {
    primary.setText(controls.text.value);
  });

  controls.size.addEventListener('input', () => {
    document.documentElement.style.setProperty('--font-size', `${controls.size.value}vw`);
    syncLabels();
  });

  ['smearLength', 'spread', 'fadeTime', 'density', 'blur'].forEach((key) => {
    controls[key].addEventListener('input', () => {
      primary.update({ [key]: Number(controls[key].value) });
      syncLabels();
    });
  });

  controls.skew.addEventListener('click', () => {
    const skew = controls.skew.getAttribute('aria-pressed') !== 'true';
    setSkew(skew);
  });

  applyProfile('default');
});
