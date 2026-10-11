document.addEventListener('DOMContentLoaded', () => {
  // Shared between both demo pages. The controls set the page-wide
  // profile through configure(), so every link on the page (the big
  // button, the links in the text, the nav) flies with them.
  const profile = document.getElementById('ptProfile');
  const keepNav = document.getElementById('ptKeepNav');
  const color = document.getElementById('ptColor');

  // Every control that maps straight onto one option: [element id, the
  // key it's saved and preset under, how to label its value (sliders
  // only)].
  const FIELDS = [
    ['ptMotion', 'tMotion'],
    ['ptDirection', 'tDirection'],
    ['ptOrder', 'tOrder'],
    ['ptGrouping', 'tGrouping'],
    ['ptBackground', 'tBackground'],
    ['ptDuration', 'tDuration', (v) => `${v}ms`],
    ['ptEasing', 'tEasing'],
    ['ptStagger', 'tStagger', (v) => `${Math.round(v * 100)}%`],
    ['ptSpin', 'tSpin', (v) => `${Math.round(v * 100)}%`],
    ['ptFade', 'tFade', (v) => `${Math.round(v * 100)}%`],
    ['ptScale', 'tScale', (v) => `${Number(v).toFixed(2)}×`],
  ].map(([id, key, label]) => ({
    input: document.getElementById(id),
    valueEl: document.getElementById(`${id}Val`),
    key,
    label,
  }));

  // Presets for the controls above. Picking one sets them to known-good
  // values, but each stays a normal editable control afterward. Keep nav
  // bar isn't in any of them: what stays put is the site's call, not part
  // of a look.
  const PROFILES = {
    default: {
      tMotion: 'tumble', tDirection: 'origin', tOrder: 'origin', tGrouping: 'cards', tBackground: 'fly',
      tDuration: 1400, tEasing: 'ease-in', tStagger: 0.6, tSpin: 0.5, tFade: 0, tScale: 1, color: '#ffffff',
    },
    gravity: {
      tMotion: 'throw', tDirection: 'origin', tOrder: 'random', tGrouping: 'pieces', tBackground: 'fly',
      tDuration: 1600, tEasing: 'linear', tStagger: 0.7, tSpin: 0.6, tFade: 0, tScale: 1, color: '#ffffff',
    },
    whirlpool: {
      tMotion: 'spiral', tDirection: 'center', tOrder: 'origin', tGrouping: 'pieces', tBackground: 'fade',
      tDuration: 1600, tEasing: 'ease-in-out', tStagger: 0.5, tSpin: 0.5, tFade: 0.3, tScale: 0.4, color: '#ffffff',
    },
    gust: {
      tMotion: 'tumble', tDirection: 'right', tOrder: 'random', tGrouping: 'words', tBackground: 'fly',
      tDuration: 1800, tEasing: 'ease-in', tStagger: 0.8, tSpin: 0.3, tFade: 0.2, tScale: 1, color: '#ffffff',
    },
    tidy: {
      tMotion: 'slide', tDirection: 'edge', tOrder: 'reading', tGrouping: 'sections', tBackground: 'stay',
      tDuration: 1000, tEasing: 'ease-in-out', tStagger: 0.4, tSpin: 0, tFade: 0, tScale: 1, color: '#ffffff',
    },
    rubber: {
      tMotion: 'slide', tDirection: 'center', tOrder: 'origin', tGrouping: 'cards', tBackground: 'fly',
      tDuration: 1200, tEasing: 'cubic-bezier(.6,-.28,.735,.045)', tStagger: 0.3, tSpin: 0, tFade: 0, tScale: 1, color: '#ffffff',
    },
  };

  const value = (key) => FIELDS.find((f) => f.key === key).input.value;

  // The current settings as an options object: what every link on the
  // page flies with (via configure()), and what the element demo plays.
  function currentOptions() {
    return {
      motion: value('tMotion'),
      direction: value('tDirection'),
      order: value('tOrder'),
      grouping: value('tGrouping'),
      background: value('tBackground'),
      duration: Number(value('tDuration')),
      easing: value('tEasing'),
      stagger: Number(value('tStagger')),
      spin: Number(value('tSpin')),
      fade: Number(value('tFade')),
      scale: Number(value('tScale')),
      color: color.value,
      // The nav bar is the same on both demo pages, so it's this page's
      // to keep, the way any site would: as a `keep` selector.
      keep: keepNav.checked ? '.site-nav' : null,
    };
  }

  // The "Click me" box below the main content — a small live example of
  // Teardown transitioning an element in place rather than a whole page.
  // Toggles its own text back and forth, replaying the effect each time.
  // `from` is the event itself, so Away from click starts where the box
  // was clicked.
  const elementDemo = document.getElementById('elementDemo');
  let elementDemoShowingAlt = false;
  function toggleElementDemo(event) {
    const nextText = elementDemoShowingAlt ? 'Click me' : 'I can transition too';
    elementDemoShowingAlt = !elementDemoShowingAlt;
    Transitions.teardown.play(elementDemo, {
      ...currentOptions(),
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
  // defaults. Separate from teardown.js's own pending-transition handoff —
  // that one is a single-use signal cleared the instant it's read; this
  // one just persists for the session, like any other UI preference.
  const STORAGE_KEY = 't-teardown-demo-controls';

  function save() {
    const state = { profile: profile.value, keepNav: keepNav.checked, color: color.value };
    FIELDS.forEach((f) => { state[f.key] = f.input.value; });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function syncField(f) {
    if (f.valueEl && f.label) f.valueEl.textContent = f.label(f.input.value);
  }

  function apply() {
    Transitions.teardown.configure(currentOptions());
    save();
  }

  function syncAll() {
    FIELDS.forEach(syncField);
    apply();
  }

  function applyProfile(name) {
    const p = PROFILES[name] || PROFILES.default;
    FIELDS.forEach((f) => { f.input.value = p[f.key]; });
    setColorInputValue(color, p.color);
    syncAll();
  }

  profile.addEventListener('change', () => applyProfile(profile.value));
  FIELDS.forEach((f) => {
    const event = f.input.tagName === 'SELECT' ? 'change' : 'input';
    f.input.addEventListener(event, () => { syncField(f); apply(); });
  });
  keepNav.addEventListener('change', apply);
  color.addEventListener('input', apply);

  const saved = loadSessionJSON(STORAGE_KEY);
  if (saved) {
    profile.value = PROFILES[saved.profile] ? saved.profile : 'default';
    const base = PROFILES[profile.value];
    FIELDS.forEach((f) => {
      f.input.value = saved[f.key] === undefined ? base[f.key] : saved[f.key];
    });
    keepNav.checked = !!saved.keepNav;
    setColorInputValue(color, saved.color);
    syncAll();
  } else {
    applyProfile(profile.value);
  }
});
