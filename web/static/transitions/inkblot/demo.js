document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages — whichever one loaded this script
  // owns the one link tagged with this id (Enter Page Two on Page One,
  // Back to Page One on Page Two).
  const link = document.getElementById('ptTransitionLink');
  const profile = document.getElementById('ptProfile');
  const style = document.getElementById('ptStyle');
  const origin = document.getElementById('ptOrigin');
  const duration = document.getElementById('ptDuration');
  const durationVal = document.getElementById('ptDurationVal');
  const easing = document.getElementById('ptEasing');
  const drops = document.getElementById('ptDrops');
  const dropsVal = document.getElementById('ptDropsVal');
  const splatter = document.getElementById('ptSplatter');
  const splatterVal = document.getElementById('ptSplatterVal');
  const bleed = document.getElementById('ptBleed');
  const bleedVal = document.getElementById('ptBleedVal');
  const color = document.getElementById('ptColor');

  // Presets for the controls below. Picking one sets them to known-good
  // values, but each stays a normal editable control afterward. Origin
  // isn't in any of them: where a click starts the ink is the visitor's
  // call, not part of a look.
  const PROFILES = {
    default: {
      style: 'splatter', duration: 1200, easing: 'ease-in-out', drops: 4, splatter: 0.5, bleed: 0.5, color: '#000000',
    },
    fountain: {
      style: 'splatter', duration: 1400, easing: 'ease-in-out', drops: 3, splatter: 0.25, bleed: 0.9, color: '#1b2f8f',
    },
    downpour: {
      style: 'rain', duration: 1500, easing: 'linear', drops: 6, splatter: 0.4, bleed: 0.35, color: '#000000',
    },
    spill: {
      style: 'pool', duration: 1300, easing: 'cubic-bezier(.65,0,.35,1)', drops: 6, splatter: 0.6, bleed: 0.6, color: '#7a0d12',
    },
    squid: {
      style: 'splatter', duration: 900, easing: 'cubic-bezier(.2,1,.1,1)', drops: 8, splatter: 1, bleed: 0.2, color: '#14121c',
    },
  };

  // The current settings as a play()/cover() options object, read back
  // off the link's own data-t-* attributes so the element demo always
  // plays exactly what the link would.
  function currentOverrides() {
    return {
      duration: Number(link.dataset.tDuration),
      easing: link.dataset.tEasing,
      color: link.dataset.tColor,
      style: link.dataset.tStyle,
      drops: Number(link.dataset.tDrops),
      splatter: Number(link.dataset.tSplatter),
      bleed: Number(link.dataset.tBleed),
      origin: link.dataset.tOrigin,
    };
  }

  // The "Click me" box below the main link — a small live example of
  // Inkblot transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  // `from` is the event itself, so Cursor starts where the box was
  // clicked. The box is also what's being covered, so Clicked element has
  // no separate outline to burst from here and behaves like Cursor; the
  // link above is where that one shows.
  function toggleElementDemo(event) {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    Transitions.inkblot.play(elementDemo, {
      ...currentOverrides(),
      from: event,
      swap: (el) => { el.textContent = nextText; },
    });
  }
  elementDemo.addEventListener('click', toggleElementDemo);
  elementDemo.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleElementDemo(event);
  });

  // Remembers the last values chosen on EITHER demo page, so arriving on
  // the other one shows the same settings instead of resetting to
  // defaults. Separate from inkblot.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-inkblot-demo-controls';

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        profile: profile.value,
        style: style.value,
        origin: origin.value,
        duration: duration.value,
        easing: easing.value,
        drops: drops.value,
        splatter: splatter.value,
        bleed: bleed.value,
        color: link.dataset.tColor,
      }));
    } catch (e) {}
  }

  function syncStyle() {
    link.dataset.tStyle = style.value;
    save();
  }

  function syncOrigin() {
    link.dataset.tOrigin = origin.value;
    save();
  }

  function syncDuration() {
    link.dataset.tDuration = duration.value;
    durationVal.textContent = `${duration.value}ms`;
    save();
  }

  function syncEasing() {
    link.dataset.tEasing = easing.value;
    save();
  }

  function syncDrops() {
    link.dataset.tDrops = drops.value;
    dropsVal.textContent = drops.value;
    save();
  }

  function syncSplatter() {
    link.dataset.tSplatter = splatter.value;
    splatterVal.textContent = `${Math.round(splatter.value * 100)}%`;
    save();
  }

  function syncBleed() {
    link.dataset.tBleed = bleed.value;
    bleedVal.textContent = `${Math.round(bleed.value * 100)}%`;
    save();
  }

  function syncColor() {
    link.dataset.tColor = color.value;
    save();
  }

  function syncAll() {
    syncStyle();
    syncOrigin();
    syncDuration();
    syncEasing();
    syncDrops();
    syncSplatter();
    syncBleed();
    syncColor();
  }

  function applyProfile(name) {
    const p = PROFILES[name] || PROFILES.default;
    style.value = p.style;
    duration.value = p.duration;
    easing.value = p.easing;
    drops.value = p.drops;
    splatter.value = p.splatter;
    bleed.value = p.bleed;
    setColorInputValue(color, p.color);
    syncAll();
  }

  profile.addEventListener('change', () => applyProfile(profile.value));
  style.addEventListener('change', syncStyle);
  origin.addEventListener('change', syncOrigin);
  duration.addEventListener('input', syncDuration);
  easing.addEventListener('change', syncEasing);
  drops.addEventListener('input', syncDrops);
  splatter.addEventListener('input', syncSplatter);
  bleed.addEventListener('input', syncBleed);
  color.addEventListener('input', syncColor);

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    profile.value = PROFILES[saved.profile] ? saved.profile : 'default';
    style.value = saved.style || 'splatter';
    origin.value = saved.origin || 'element';
    duration.value = saved.duration;
    easing.value = saved.easing;
    drops.value = saved.drops || 4;
    splatter.value = saved.splatter === undefined ? 0.5 : saved.splatter;
    bleed.value = saved.bleed === undefined ? 0.5 : saved.bleed;
    setColorInputValue(color, saved.color);
    syncAll();
  } else {
    applyProfile(profile.value);
  }
});
