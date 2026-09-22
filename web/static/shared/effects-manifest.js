/**
 * Effects manifest
 * -----------------
 * Single source of truth for every reusable effect in the lab: where its
 * demo page lives, where its standalone script lives, and where its docs
 * live. nav.js (download/docs buttons) and docs-nav.js (sidebar) both read
 * this instead of hand-maintained link lists, so adding an effect is a
 * one-entry change instead of an N-file one. If this site ever grows a
 * backend, this is the one file that would become an API response instead
 * of a static script.
 */
(function (global) {
  global.EFFECTS_MANIFEST = [
    {
      slug: 'double-speak',
      name: 'Double Speak',
      category: 'text-effects',
      demoPath: '/text-effects/double-speak/index.html',
      jsPath: '/text-effects/double-speak/double-speak.js',
      docsPath: '/docs/text-effects/double-speak.html',
    },
    {
      slug: 'wave-form',
      name: 'Wave Form',
      category: 'text-effects',
      demoPath: '/text-effects/wave-form/index.html',
      jsPath: '/text-effects/wave-form/wave-form.js',
      docsPath: '/docs/text-effects/wave-form.html',
    },
    {
      slug: 'paint-drag',
      name: 'Paint Drag',
      category: 'text-effects',
      demoPath: '/text-effects/paint-drag/index.html',
      jsPath: '/text-effects/paint-drag/paint-drag.js',
      docsPath: '/docs/text-effects/paint-drag.html',
    },
    {
      slug: 'in-flight-out',
      name: 'In Flight Out',
      category: 'text-effects',
      demoPath: '/text-effects/in-flight-out/index.html',
      jsPath: '/text-effects/in-flight-out/in-flight-out.js',
      docsPath: '/docs/text-effects/in-flight-out.html',
    },
    {
      slug: 'triple-vision',
      name: 'Triple Vision',
      category: 'text-effects',
      demoPath: '/text-effects/triple-vision/index.html',
      jsPath: '/text-effects/triple-vision/triple-vision.js',
      docsPath: '/docs/text-effects/triple-vision.html',
    },
    {
      slug: 'type-pan',
      name: 'Type Pan',
      category: 'text-effects',
      demoPath: '/text-effects/type-pan/index.html',
      jsPath: '/text-effects/type-pan/type-pan.js',
      docsPath: '/docs/text-effects/type-pan.html',
    },
    {
      slug: 'rolodex',
      name: 'Rolodex',
      category: 'text-effects',
      demoPath: '/text-effects/rolodex/index.html',
      jsPath: '/text-effects/rolodex/rolodex.js',
      docsPath: '/docs/text-effects/rolodex.html',
    },
    {
      slug: 'circuit-board',
      name: 'Circuit Board',
      category: 'background',
      demoPath: '/background/circuit-board/index.html',
      jsPath: '/background/circuit-board/circuit-board.js',
      docsPath: '/docs/background/circuit-board.html',
    },
    {
      slug: 'gravity-well',
      name: 'Gravity Well',
      category: 'background',
      demoPath: '/background/gravity-well/index.html',
      jsPath: '/background/gravity-well/gravity-well.js',
      docsPath: '/docs/background/gravity-well.html',
    },
    {
      slug: 'vacuum',
      name: 'Vacuum',
      category: 'background',
      demoPath: '/background/vacuum/index.html',
      jsPath: '/background/vacuum/vacuum.js',
      docsPath: '/docs/background/vacuum.html',
    },
    {
      slug: 'shutter',
      name: 'Shutter',
      category: 'transitions',
      demoPath: '/transitions/shutter/index.html',
      jsPath: '/transitions/shutter/shutter.js',
      docsPath: '/docs/transitions/shutter.html',
    },
    {
      slug: 'aperture',
      name: 'Aperture',
      category: 'transitions',
      demoPath: '/transitions/aperture/index.html',
      jsPath: '/transitions/aperture/aperture.js',
      docsPath: '/docs/transitions/aperture.html',
    },
    {
      slug: 'static',
      name: 'Static',
      category: 'transitions',
      demoPath: '/transitions/static/index.html',
      jsPath: '/transitions/static/static.js',
      docsPath: '/docs/transitions/static.html',
    },
  ];
})(window);
