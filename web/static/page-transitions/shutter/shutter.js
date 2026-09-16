/**
 * Shutter
 * -------
 * A full-screen black panel that rises from the bottom edge to cover the
 * viewport when you click away to another page, then recedes back down to
 * reveal that next page once it loads — one continuous vertical motion
 * split across the navigation boundary.
 *
 * Usage: drop `<script src="shutter.js"></script>` in `<head>` (a plain,
 * non-async/defer tag) on every page that should take part. No class or
 * markup is required — it listens for clicks on the whole document and
 * intercepts any same-origin link (opt a link out with
 * `data-no-transition`). The cover/reveal only ever plays across a
 * navigation it intercepted itself: a direct load, refresh, or bookmark
 * visit renders normally with no overlay at all, and a destination page
 * that doesn't also load this script just appears underneath once the
 * exit cover finishes, with no reveal animation of its own.
 *
 * Coexists with other page-transition effects on the same page (e.g. a
 * site demoing several): its public API lives at
 * `window.PageTransitions.shutter`, not a shared name, and its config
 * reads from `window.PageTransitionConfig.shutter`, not a shared object —
 * so a second effect's script can register alongside it without either
 * clobbering the other.
 *
 * A single link can override duration/easing/color for just its own
 * transition with `data-pt-duration`, `data-pt-easing`, `data-pt-color` —
 * every other link keeps using the page's default profile. The chosen
 * profile travels to the next page in the same one-shot sessionStorage
 * handoff already used to trigger the reveal, so a customized cover and
 * its matching reveal always agree, without persisting anything.
 */
(function (global, document) {
  var NAME = 'shutter';
  global.PageTransitions = global.PageTransitions || {};
  if (global.PageTransitions[NAME]) return;

  var STYLE_ID = 'pt-shutter-styles';
  var PENDING_KEY = 'pt-shutter-pending';
  var PENDING_TTL = 4000; // ms — ignore a stale flag from an old, unrelated navigation
  var root = document.documentElement;

  var DEFAULTS = {
    duration: 550, // ms for each half (cover or reveal) of the motion
    easing: 'cubic-bezier(.65,0,.35,1)',
    color: '#000',
    selector: 'a[href]', // which links this page intercepts
  };
  var pageConfig = (global.PageTransitionConfig && global.PageTransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);
  var activeProfile = options; // whichever profile is currently animating

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html.pt-shutter-active::before{content:"";position:fixed;inset:0;' +
      'background:var(--pt-shutter-color,#000);z-index:2147483647;pointer-events:auto;' +
      'transform:scaleY(1);transform-origin:bottom;}' +
      'html.pt-shutter-anim::before{transition:transform var(--pt-shutter-duration,550ms) ' +
      'var(--pt-shutter-easing,cubic-bezier(.65,0,.35,1));}' +
      'html.pt-shutter-open::before{transform:scaleY(0);}';
    document.head.appendChild(style);
  }

  function applyProfile(profile) {
    root.style.setProperty('--pt-shutter-duration', profile.duration + 'ms');
    root.style.setProperty('--pt-shutter-easing', profile.easing);
    root.style.setProperty('--pt-shutter-color', profile.color);
  }

  injectStyles();
  applyProfile(options);

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function readPending() {
    try {
      var raw = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.ts >= PENDING_TTL) return null;
      return data.profile;
    } catch (e) {
      return null;
    }
  }

  function setPending(profile) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now(), profile: profile }));
    } catch (e) {}
  }

  function cleanup() {
    root.classList.remove('pt-shutter-active', 'pt-shutter-anim', 'pt-shutter-open');
  }

  // --- Arrival: reveal, only when this load was itself the far side of an
  // intercepted click. Runs at parse time so the cover (if any) is on
  // screen before the rest of the page ever paints. Whatever profile the
  // departing page used travels along in the same handoff, so the reveal
  // matches the cover even if it was a customized one. Skipped entirely
  // under reduced motion — the departure side never showed a cover for
  // the same reason, so there's nothing here to reveal either; showing
  // the overlay just to immediately clean it up at DOMContentLoaded would
  // be a static color flash with no motion to justify it. ---
  // readPending() always runs (it also clears the flag) — reduced motion
  // just means we ignore what it found instead of acting on it.
  var pending = readPending();
  var arrivingProfile = prefersReducedMotion() ? null : pending;
  if (arrivingProfile) {
    activeProfile = arrivingProfile;
    applyProfile(activeProfile);
    root.classList.add('pt-shutter-active');
  }

  function reveal() {
    if (prefersReducedMotion()) {
      cleanup();
      return;
    }
    requestAnimationFrame(function () {
      root.classList.add('pt-shutter-anim');
      requestAnimationFrame(function () {
        root.classList.add('pt-shutter-open');
        setTimeout(cleanup, activeProfile.duration + 60);
      });
    });
  }

  function onReady() {
    if (arrivingProfile) reveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  global.addEventListener('pageshow', function (event) {
    // Returning via bfcache can restore the DOM mid-animation; snap back
    // to a clean, uncovered state instead of replaying anything.
    if (event.persisted) cleanup();
  });

  // --- Departure: cover, then hand off to the next page. ---
  function coverThenNavigate(url, profile) {
    activeProfile = profile;

    if (prefersReducedMotion()) {
      setPending(profile);
      global.location.href = url;
      return;
    }

    applyProfile(profile);
    root.classList.add('pt-shutter-active', 'pt-shutter-open'); // start hidden, no transition yet
    requestAnimationFrame(function () {
      root.classList.add('pt-shutter-anim');
      requestAnimationFrame(function () {
        root.classList.remove('pt-shutter-open'); // animates scaleY 0 -> 1: covers
      });
    });

    var navigated = false;
    function go() {
      if (navigated) return;
      navigated = true;
      setPending(profile);
      global.location.href = url;
    }
    root.addEventListener('transitionend', function handler(e) {
      // transitionend bubbles, so without the target check a transform
      // transition finishing on some unrelated descendant (e.g. the
      // controls panel opening/closing mid-cover) would fire this early.
      if (e.target !== root || e.propertyName !== 'transform') return;
      root.removeEventListener('transitionend', handler);
      go();
    });
    setTimeout(go, profile.duration + 150); // fallback if transitionend never fires
  }

  // A link's own data-pt-duration/-easing/-color win over the page's
  // default profile, but only for that one link — every other link keeps
  // using `options` untouched.
  function resolveProfile(a) {
    var ds = a.dataset;
    var duration = ds.ptDuration ? Number(ds.ptDuration) : NaN;
    return {
      duration: Number.isFinite(duration) ? duration : options.duration,
      easing: ds.ptEasing || options.easing,
      color: ds.ptColor || options.color,
    };
  }

  function eligible(a) {
    if (!a || !a.href) return false;
    if (a.hasAttribute('data-no-transition')) return false;
    if (a.hasAttribute('download')) return false;
    if (a.target && a.target !== '' && a.target !== '_self') return false;
    var url;
    try { url = new URL(a.href, global.location.href); } catch (e) { return false; }
    if (url.origin !== global.location.origin) return false;
    // same-page hash link: leave it to the browser
    if (url.hash && url.pathname === global.location.pathname && url.search === global.location.search) return false;
    return true;
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target.closest && event.target.closest(options.selector);
    if (!eligible(a)) return;
    event.preventDefault();
    coverThenNavigate(a.href, resolveProfile(a));
  });

  global.PageTransitions[NAME] = {
    configure: function (opts) {
      Object.assign(options, opts || {});
      // A page's own <head> fragment typically calls this just to widen
      // `selector` (see the demo pages) — it runs before DOMContentLoaded,
      // right after an arriving page has already applied the profile it's
      // mid-handoff with. Re-applying the page's default profile here
      // would stomp that arriving profile before its reveal ever plays, so
      // skip it while one is in flight; the reveal itself never touches
      // these properties again once it's running.
      if (!arrivingProfile) applyProfile(options);
    },
  };
})(window, document);
