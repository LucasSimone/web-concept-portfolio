/**
 * Spotlight
 * ---------
 * Built around two ideas:
 *
 * 1. The element is *cut out* of every overlay. The page dims, blurs and
 *    fills with light around the element's own silhouette, but nothing is
 *    ever painted on top of it - so no copy, no image, no border ever
 *    loses a shade of contrast to the effect. The beam is masked by the
 *    element's own rounded rect, which also gives the physically correct
 *    read: the element is a solid thing standing in a beam, blocking it,
 *    rather than a translucent card with light smeared over it.
 *
 * 2. One shared stage, not one overlay per element. Every instance on the
 *    page draws through a single set of three fixed layers, and only one
 *    element holds the light at a time. Moving the pointer between two
 *    spotlit elements *sweeps* the beam from one to the other instead of
 *    lighting two at once - which is both the nicer motion and the fix
 *    for the whole class of bugs you get from N independent full-page
 *    scrims stacking their darkness (and their backdrop filters) on top
 *    of each other.
 *
 * The beam geometry is a silhouette (shadow-volume) solve rather than a
 * fixed-width wedge: from the emitter, the two beam edges are the rays
 * that graze the element's angularly-extreme corners, so the cone always
 * lands squarely around the element no matter where it sits on screen or
 * what shape it is, and carries a little past it before fading. The
 * emitter itself rides the top edge of the window at a fixed angle off
 * vertical from whatever it's lighting, so every element gets the same
 * believable rake of light instead of a near-horizontal skim for anything
 * far from a hardcoded corner.
 *
 * Layer structure, and why it is three separate `position: fixed`
 * siblings on <body> rather than one overlay with three children:
 *
 *   .spotlight-layer--blur   backdrop-filter strips, nothing else
 *   .spotlight-layer--shade  the dark scrim, element cut out
 *   .spotlight-layer--light  the beam, screen-blended onto the page
 *
 * Chrome will silently drop a `backdrop-filter` when the element is
 * masked or clipped, and *also* when a sibling inside the same stacking
 * context carries a `mix-blend-mode` (both reproduced while building
 * this; the mask case is https://issues.chromium.org/issues/40778541).
 * Put all three jobs inside one overlay div - the obvious structure, and
 * the one an earlier draft of this used - and the blur silently never
 * renders at all. Keeping the blur panes alone in
 * their own top-level layer - each one itself unmasked and unclipped,
 * with no blended sibling to share a stacking context with - is what
 * makes the blur actually work here. The hole in it is cut by clipping
 * the panes' *wrappers*, which Chrome is perfectly happy with; see the
 * .spotlight-blur-clip rule for why all four panes are the same size.
 *
 * The light layer carries `mix-blend-mode: screen` on the layer itself
 * rather than on its children, for a related reason: `position: fixed`
 * always establishes a stacking context, so a blended *child* of a fixed
 * overlay only ever blends against its own transparent parent - i.e. does
 * nothing. Blending the whole layer is what puts the beam's light onto
 * the actual page beneath it.
 *
 * Usage: class="spotlight-el" on any sized element with content, then
 * load this file - it injects its own styles and builds the shared stage
 * on demand.
 */
(function (global) {
  const STYLE_ID = 'spotlight-styles';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const CSS = `
.spotlight-el {
  --sp-amount: 0;
  --sp-scale: 1;
  --sp-lift: 0px;
  --sp-shadow: none;

  position: relative;
  transform: translateY(var(--sp-lift)) scale(var(--sp-scale));
  box-shadow: var(--sp-shadow);
  will-change: transform;
}

.spotlight-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

/* Painted under the scrim so the sharp-to-blurred transition reads as
   part of the darkening rather than a separate ring on top of it. */
.spotlight-layer--blur { z-index: 498; }
.spotlight-layer--shade { z-index: 499; }

/* screen on the LAYER, not on its children - see the header comment. */
.spotlight-layer--light {
  z-index: 501;
  mix-blend-mode: screen;
}

/* The hole in the blur is cut by four clipping wrappers, each holding a
   pane that covers the *whole viewport* and is simply offset back into
   place. Sizing each pane to its own strip instead - the obvious way -
   leaves a visible seam along every join: a backdrop-filter samples only
   what is behind its own box, so four differently-sized panes blur four
   differently-cropped backdrops and disagree along their shared edges,
   drawing faint lines across the page. Identical panes sample identical
   backdrops and agree exactly. The wrapper does the clipping because
   clipping the filtered element itself silently kills the filter in
   Chrome - see the header comment. */
.spotlight-blur-clip {
  position: absolute;
  overflow: hidden;
}

.spotlight-blur-pane {
  position: absolute;
  backdrop-filter: blur(var(--sp-blur, 0px));
  -webkit-backdrop-filter: blur(var(--sp-blur, 0px));
}

.spotlight-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // --- small helpers ---------------------------------------------------

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 255, g: 255, b: 255 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // Mixes a color toward white. The rim lines and the emitter bloom are
  // the hottest part of the light and read wrong in the same flat tone as
  // the beam's own fill. Called from the beam's per-frame render path with
  // a color that's constant for the life of an options object, so results
  // are cached - the number of distinct colors used on a page is small and
  // fixed, so this cache never has reason to be evicted.
  const mixWithWhiteCache = new Map();
  function mixWithWhite(hex, amount) {
    const key = `${hex}|${amount}`;
    let mixed = mixWithWhiteCache.get(key);
    if (mixed === undefined) {
      const { r, g, b } = hexToRgb(hex);
      const mix = (c) => Math.round(c + (255 - c) * amount);
      mixed = `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
      mixWithWhiteCache.set(key, mixed);
    }
    return mixed;
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function setAttrs(node, attrs) {
    for (const k in attrs) node.setAttribute(k, attrs[k]);
  }

  // Border-radius so the cut-out hugs a pill button or a circular icon
  // instead of squaring it off. Percentages come back from
  // getComputedStyle as authored, so they're resolved here.
  function readRadius(el, w, h) {
    const raw = getComputedStyle(el).borderTopLeftRadius || '0';
    const value = parseFloat(raw) || 0;
    if (raw.indexOf('%') !== -1) return (Math.min(w, h) * value) / 100;
    return Math.min(value, Math.min(w, h) / 2);
  }

  let uid = 0;

  const MOTE_COUNT = 12;

  const DEFAULTS = {
    trigger: 'hover',      // 'hover' | 'click'
    smoothing: 170,        // ms time-constant easing `amount` toward its target
    sweep: 240,            // ms time-constant the beam retargets between elements over
    scale: 1.06,           // scale factor at full spotlight
    lift: 12,              // px the element rises toward the light at full spotlight
    // Beam, bloom, floor pool and element halo color. White is the neutral
    // default - it reads as a plain stage light on any page's palette,
    // where a tinted one (this was a warm amber for a while) quietly
    // recolors whatever it lands next to. The demo page's Stage Warm
    // profile is that amber, kept as one option among several.
    color: '#ffffff',
    angle: 18,             // degrees off vertical; positive = light from the upper right
    beamOpacity: 0.72,     // beam brightness where it lands, at full spotlight
    sourceWidth: 40,       // px width of the emitter along the window's top edge
    clearance: 16,         // px the beam's edges clear the element's own corners by
    overshoot: 1.3,        // how far past the element the beam carries before fading
    edgeGlow: true,        // bright rim lines along the beam's two long edges
    haloGlow: true,        // warm rim of light hugging the element's own silhouette
    floorGlow: true,       // pool of light on the floor beneath the element
    dustMotes: true,       // drifting light particles inside the beam
    darkOpacity: 0.74,     // strength (0-1) of the scrim over the rest of the page
    blurAmount: 0,         // px backdrop blur over the rest of the page (0 = off)
    autoBind: true,        // auto-bind the host's own trigger listeners
  };

  // ---------------------------------------------------------------------
  // Stage: the one set of layers every instance on the page draws through.
  // ---------------------------------------------------------------------

  class Stage {
    constructor() {
      injectStyles();

      this.instances = new Set();
      this.active = null;    // instance currently holding the light
      this.last = null;      // who held it most recently, for the fade-out
      this.amount = 0;       // 0-1 overall light level
      this.target = 0;
      this.focus = null;     // eased {cx, cy, hw, hh, r} the beam is aimed at
      this._snap = true;     // next focus update jumps instead of sweeping
      this._lastT = performance.now();
      this._raf = null;
      this._tick = this._tick.bind(this);

      this._build();
      this._visible = true;
      this._setVisible(false);
    }

    _build() {
      const id = ++uid;
      this._id = id;

      // --- blur layer: four clipped panes framing the element ---
      this.blurLayer = document.createElement('div');
      this.blurLayer.className = 'spotlight-layer spotlight-layer--blur';
      this.blurPanes = [];
      for (let i = 0; i < 4; i++) {
        const clip = document.createElement('div');
        clip.className = 'spotlight-blur-clip';
        const pane = document.createElement('div');
        pane.className = 'spotlight-blur-pane';
        clip.append(pane);
        this.blurLayer.append(clip);
        this.blurPanes.push({ clip, pane });
      }

      // --- shade layer: one dark rect, masked by the element ---
      this.shadeLayer = document.createElement('div');
      this.shadeLayer.className = 'spotlight-layer spotlight-layer--shade';
      const shadeSvg = svg('svg', { class: 'spotlight-svg' });
      const shadeDefs = svg('defs');
      // The cut-out is the element's own outline and nothing wider. An
      // earlier pass feathered the scrim out over a big soft ellipse
      // around it, and it was a mistake: it cleared the page exactly where
      // the beam lands, so the light had nothing dark left to read
      // against and the whole thing came out as a pale fog blob. The only
      // softening here is a few px of blur on the hole itself.
      this._shadeMask = svg('mask', { id: `sp-shade-mask-${id}`, maskUnits: 'userSpaceOnUse' });
      this._shadeBase = svg('rect', { fill: '#fff' });
      this._shadeFeather = svg('rect', { fill: '#000' });
      this._shadeCore = svg('rect', { fill: '#000' });
      this._shadeMask.append(this._shadeBase, this._shadeFeather, this._shadeCore);
      shadeDefs.append(this._shadeMask);
      this._shadeFill = svg('rect', { mask: `url(#sp-shade-mask-${id})` });
      shadeSvg.append(shadeDefs, this._shadeFill);
      this.shadeLayer.append(shadeSvg);

      // --- light layer: beam, bloom, halo, floor pool, motes ---
      this.lightLayer = document.createElement('div');
      this.lightLayer.className = 'spotlight-layer spotlight-layer--light';
      const lightSvg = svg('svg', { class: 'spotlight-svg' });
      const lightDefs = svg('defs');

      // Beam brightness along its own axis: near-dark at the emitter,
      // peaking exactly where it lands, dropping off through the stretch
      // that carries past the element.
      this._beamGrad = svg('linearGradient', {
        id: `sp-beam-${id}`,
        gradientUnits: 'userSpaceOnUse',
      });
      this._beamStops = [0, 1, 2, 3, 4].map(() => svg('stop'));
      this._beamGrad.append(...this._beamStops);

      // The rim lines get their own copy of that profile rather than a
      // flat stroke: a solid line all the way down reads as a drawn edge
      // - two lasers pinned to the corners of the screen - where a rim
      // that dims out past what it's lighting reads as the edge of a
      // shaft of light.
      this._rimGrad = svg('linearGradient', {
        id: `sp-rim-${id}`,
        gradientUnits: 'userSpaceOnUse',
      });
      this._rimStops = [0, 1, 2, 3, 4].map(() => svg('stop'));
      this._rimGrad.append(...this._rimStops);

      this._poolGrad = svg('radialGradient', { id: `sp-pool-${id}` });
      this._poolStops = [svg('stop', { offset: '0%' }), svg('stop', { offset: '55%' }), svg('stop', { offset: '100%' })];
      this._poolGrad.append(...this._poolStops);

      this._bloomGrad = svg('radialGradient', { id: `sp-bloom-${id}` });
      this._bloomStops = [svg('stop', { offset: '0%' }), svg('stop', { offset: '45%' }), svg('stop', { offset: '100%' })];
      this._bloomGrad.append(...this._bloomStops);

      // Everything the element is allowed to block shares one mask. The
      // emitter bloom sits outside it: it lives at the window's top edge,
      // nowhere near what's being lit, and cutting it would only risk
      // clipping it against an element that happens to sit up there.
      this._lightMask = svg('mask', { id: `sp-light-mask-${id}`, maskUnits: 'userSpaceOnUse' });
      this._lightMaskBase = svg('rect', { fill: '#fff' });
      this._lightFeather = svg('rect', { fill: '#000' });
      this._lightCore = svg('rect', { fill: '#000' });
      this._lightMask.append(this._lightMaskBase, this._lightFeather, this._lightCore);

      lightDefs.append(this._beamGrad, this._rimGrad, this._poolGrad, this._bloomGrad, this._lightMask);

      this._occluded = svg('g', { mask: `url(#sp-light-mask-${id})` });
      // Wide, heavily blurred copy of the beam sitting behind the beam
      // itself - the haze around a real shaft of light, which a single
      // hard-edged polygon never gives you however soft its gradient is.
      this._beamHaze = svg('polygon', { fill: `url(#sp-beam-${id})`, style: 'filter: blur(26px)' });
      this._beamFill = svg('polygon', { fill: `url(#sp-beam-${id})`, style: 'filter: blur(7px)' });
      this._rimGlowA = svg('line', { style: 'filter: blur(4px)' });
      this._rimGlowB = svg('line', { style: 'filter: blur(4px)' });
      this._rimCoreA = svg('line');
      this._rimCoreB = svg('line');
      this._pool = svg('ellipse', { fill: `url(#sp-pool-${id})`, style: 'filter: blur(6px)' });
      this._halo = svg('rect', { fill: 'none' });
      // One blur on the group rather than one per mote: a dozen separate
      // filter regions re-resolved every frame is real cost for an effect
      // nobody can tell apart from a single softened layer.
      this._moteGroup = svg('g', { style: 'filter: blur(0.7px)' });
      this._motes = [];
      for (let i = 0; i < MOTE_COUNT; i++) {
        const circle = svg('circle');
        this._moteGroup.append(circle);
        this._motes.push({
          node: circle,
          t: Math.random(),
          off: Math.random(),
          r: 0.9 + Math.random() * 1.6,
          speed: 0.035 + Math.random() * 0.07,
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.7 + Math.random() * 1.4,
        });
      }
      this._occluded.append(
        this._beamHaze, this._beamFill,
        this._rimGlowA, this._rimGlowB, this._rimCoreA, this._rimCoreB,
        this._pool, this._halo, this._moteGroup,
      );

      this._bloom = svg('ellipse', { fill: `url(#sp-bloom-${id})`, style: 'filter: blur(6px)' });

      lightSvg.append(lightDefs, this._occluded, this._bloom);
      this.lightLayer.append(lightSvg);

      document.body.append(this.blurLayer, this.shadeLayer, this.lightLayer);
    }

    // Keeping the layers out of the render tree while nothing is lit isn't
    // just a paint saving: an idle backdrop-filter element is enough on
    // its own to disturb compositing elsewhere on the page in Chrome, even
    // at blur(0px) with no background of its own.
    _setVisible(visible) {
      if (visible === this._visible) return;
      this._visible = visible;
      const display = visible ? '' : 'none';
      this.blurLayer.style.display = display;
      this.shadeLayer.style.display = display;
      this.lightLayer.style.display = display;
    }

    register(instance) {
      this.instances.add(instance);
    }

    // Both loops here park themselves when there is nothing left to
    // animate and are restarted on trigger, rather than spinning at frame
    // rate over a resting page for the whole life of the document.
    _wake() {
      if (this._raf) return;
      this._lastT = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    unregister(instance) {
      this.instances.delete(instance);
      if (this.active === instance) this.active = null;
      if (this.last === instance) this.last = null;
      if (!this.instances.size) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
        this.blurLayer.remove();
        this.shadeLayer.remove();
        this.lightLayer.remove();
        if (stage === this) stage = null;
      }
    }

    // Called by an instance entering. The beam sweeps from wherever it is
    // to the new element if it's already lit, and jumps straight to it if
    // it isn't - a sweep in from nowhere would just be the beam skating
    // across the page from the last element the visitor happened to touch.
    claim(instance) {
      this.active = instance;
      this.last = instance;
      if (this.amount <= 0.002) this._snap = true;
      this._wake();
    }

    // `target` is deliberately not touched here or in claim(): _tick
    // derives it from `active` every frame instead. Another instance may
    // claim in the same frame this releases (moving between two adjacent
    // elements fires leave before enter), and letting the frame decide is
    // what keeps that handover from flickering through a fade-out.
    release(instance) {
      if (this.active !== instance) return;
      this.active = null;

      // A click-latched element still wants the light. Hovering something
      // else borrows the beam; ending that hover has to hand it back
      // rather than fading the page up and leaving the latched element
      // sitting popped in the dark - where its next click reads as doing
      // nothing at all, since all that click does is un-latch it. Only
      // `latched` instances qualify: a hover instance that happens to
      // still be easing in isn't asking to hold anything.
      for (const other of this.instances) {
        if (other !== instance && other.latched) {
          this.claim(other);
          return;
        }
      }
      this._wake();
    }

    _tick(now) {
      const dt = Math.min(64, now - this._lastT);
      this._lastT = now;

      const holder = this.active || this.last;
      const options = holder ? holder.options : DEFAULTS;

      this.target = this.active ? 1 : 0;
      this.amount += (this.target - this.amount) * (1 - Math.exp(-dt / options.smoothing));
      if (Math.abs(this.target - this.amount) < 0.0008) this.amount = this.target;

      if (this.amount <= 0.0005 && !this.active) {
        this.amount = 0;
        this._snap = true;
        this._sig = null;
        this._setVisible(false);
        this._raf = null;
        return;
      }
      this._setVisible(true);

      if (holder) this._aim(holder, dt, options);
      this._raf = requestAnimationFrame(this._tick);
    }

    // Eases the focus rect toward the holder's live on-screen box. Reading
    // it every frame (one rect, one element) is what lets the beam track
    // scrolling, resizing and the element's own pop-scale with no scroll
    // listener, no resize listener and no polling timer at all.
    _aim(holder, dt, options) {
      const rect = holder.el.getBoundingClientRect();
      const want = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        hw: rect.width / 2,
        hh: rect.height / 2,
        r: holder.radius,
      };

      if (!this.focus || this._snap) {
        this.focus = { ...want };
        this._snap = false;
      } else {
        const k = 1 - Math.exp(-dt / Math.max(1, options.sweep));
        const f = this.focus;
        f.cx += (want.cx - f.cx) * k;
        f.cy += (want.cy - f.cy) * k;
        f.hw += (want.hw - f.hw) * k;
        f.hh += (want.hh - f.hh) * k;
        f.r += (want.r - f.r) * k;
      }

      // Two rects, deliberately: the beam is aimed at the eased one so it
      // swings across between elements, while the cut-out, halo and floor
      // pool use the real one. Easing the cut-out too was the first cut
      // and it looked wrong for a specific reason - mid-sweep the clear
      // window belongs to neither element, so the one being handed the
      // light spends the whole sweep partly scrimmed. Snapping it means
      // the target is legible from the first frame and the light arrives
      // afterwards, which is also just what a swinging spotlight does.
      this._draw(this.focus, want, options, dt);
    }

    // `f` is the eased aim rect (drives the beam); `h` is the holder's
    // real rect (drives the cut-out and everything attached to the
    // element itself). They're the same rect except during a sweep.
    _draw(f, h, o, dt) {
      const vw = global.innerWidth;
      const vh = global.innerHeight;
      const a = this.amount;

      // Everything below the motes is a pure function of the focus rect,
      // the options and the light level - so once the pointer settles on
      // an element, none of it changes and none of it needs rewriting.
      // Worth the bookkeeping: the beam carries two large blurred
      // polygons and two masks, and re-touching their attributes every
      // frame keeps Chrome re-rasterizing filters for a picture that
      // isn't moving. The motes are deliberately outside the guard - they
      // drift whether or not anything else does.
      const sig = `${a.toFixed(4)}|${f.cx.toFixed(1)}|${f.cy.toFixed(1)}|${f.hw.toFixed(1)}|${f.hh.toFixed(1)}|${f.r.toFixed(1)}|`
        + `${h.cx.toFixed(1)}|${h.cy.toFixed(1)}|${h.hw.toFixed(1)}|${h.hh.toFixed(1)}|${h.r.toFixed(1)}|${vw}|${vh}|`
        + `${o.angle}|${o.beamOpacity}|${o.sourceWidth}|${o.clearance}|${o.overshoot}|${o.color}|`
        + `${o.edgeGlow}|${o.haloGlow}|${o.floorGlow}|${o.darkOpacity}|${o.blurAmount}`;
      if (sig === this._sig) {
        this._driftMotes(o, dt, a);
        return;
      }
      this._sig = sig;

      // --- emitter: rides the top edge of the window at a fixed rake off
      // vertical from whatever it's lighting, rather than sitting at a
      // hardcoded corner (which skims anything far from it almost
      // horizontally). Clamped into the window so its bloom is always
      // actually on screen. An element sitting right against the top of
      // the window is aimed at from 60px lower than its real center: the
      // emitter would otherwise be almost on top of it, and the cone
      // degenerates. ---
      const aimY = Math.max(f.cy, 60);
      const rake = Math.tan((o.angle * Math.PI) / 180);
      const sx = clamp(f.cx + rake * aimY, vw * 0.05, vw * 0.95);
      const sy = 0;

      let axisX = f.cx - sx;
      let axisY = aimY - sy;
      const throwLen = Math.hypot(axisX, axisY) || 1;
      axisX /= throwLen;
      axisY /= throwLen;
      const perpX = -axisY;
      const perpY = axisX;

      // --- beam edges: the two rays from the emitter that graze the
      // element's angularly-extreme corners. Solving the silhouette
      // rather than picking a fixed spread is what makes the cone land
      // squarely around the element from any direction, at any aspect
      // ratio, instead of slicing across it on the diagonal. ---
      const hw = f.hw + o.clearance;
      const hh = f.hh + o.clearance;
      let loSlope = Infinity;
      let hiSlope = -Infinity;
      for (let i = 0; i < 4; i++) {
        const px = f.cx + (i === 0 || i === 3 ? -hw : hw);
        const py = aimY + (i < 2 ? -hh : hh);
        const vx = px - sx;
        const vy = py - sy;
        const along = vx * axisX + vy * axisY;
        if (along < 1) continue;
        const slope = (vx * perpX + vy * perpY) / along;
        if (slope < loSlope) loSlope = slope;
        if (slope > hiSlope) hiSlope = slope;
      }
      if (!isFinite(loSlope)) { loSlope = -0.2; hiSlope = 0.2; }

      const halfSrc = o.sourceWidth / 2;
      const reach = throwLen * Math.max(1.02, o.overshoot);
      // Perpendicular offset of each edge at axial distance d:
      //   edge(d) = ±halfSrc + slope * d
      const offAt = (slope, sign, d) => sign * halfSrc + slope * d;
      const pt = (d, offset) => `${(sx + axisX * d + perpX * offset).toFixed(1)},${(sy + axisY * d + perpY * offset).toFixed(1)}`;

      const loNear = offAt(loSlope, -1, 0);
      const hiNear = offAt(hiSlope, 1, 0);
      const loFar = offAt(loSlope, -1, reach);
      const hiFar = offAt(hiSlope, 1, reach);

      this._beamFill.setAttribute('points',
        `${pt(0, loNear)} ${pt(0, hiNear)} ${pt(reach, hiFar)} ${pt(reach, loFar)}`);
      // The haze copy flares wider than the beam so its blur reads as
      // light scattering off the air around the shaft rather than a
      // second, fuzzier shaft sitting exactly on top of the first.
      const flare = 1.45;
      this._beamHaze.setAttribute('points',
        `${pt(0, loNear * flare)} ${pt(0, hiNear * flare)} ${pt(reach, hiFar * flare)} ${pt(reach, loFar * flare)}`);

      const setLine = (line, slope, sign) => setAttrs(line, {
        x1: (sx + perpX * offAt(slope, sign, 0)).toFixed(1),
        y1: (sy + perpY * offAt(slope, sign, 0)).toFixed(1),
        x2: (sx + axisX * reach + perpX * offAt(slope, sign, reach)).toFixed(1),
        y2: (sy + axisY * reach + perpY * offAt(slope, sign, reach)).toFixed(1),
      });
      setLine(this._rimGlowA, loSlope, -1);
      setLine(this._rimCoreA, loSlope, -1);
      setLine(this._rimGlowB, hiSlope, 1);
      setLine(this._rimCoreB, hiSlope, 1);

      // --- brightness along the beam ---
      const hot = mixWithWhite(o.color, 0.6);
      const land = throwLen / reach;   // where along the beam the element sits
      setAttrs(this._beamGrad, { x1: sx, y1: sy, x2: sx + axisX * reach, y2: sy + axisY * reach });
      const stops = [
        [0, 0.06],
        [land * 0.6, 0.42],
        [land, 1],
        [Math.min(1, land + 0.05), 0.55],
        [1, 0],
      ];
      const beamA = o.beamOpacity * a;
      stops.forEach(([offset, k], i) => setAttrs(this._beamStops[i], {
        offset: `${(offset * 100).toFixed(2)}%`,
        'stop-color': o.color,
        'stop-opacity': (k * beamA).toFixed(4),
      }));

      setAttrs(this._rimGrad, { x1: sx, y1: sy, x2: sx + axisX * reach, y2: sy + axisY * reach });
      [
        [0, 0.12],
        [land * 0.5, 0.6],
        [land, 1],
        [Math.min(1, land + 0.07), 0.3],
        [1, 0],
      ].forEach(([offset, k], i) => setAttrs(this._rimStops[i], {
        offset: `${(offset * 100).toFixed(2)}%`,
        'stop-color': hot,
        'stop-opacity': k.toFixed(4),
      }));

      const rimA = (o.edgeGlow ? 0.85 : 0) * a;
      const rimStroke = `url(#sp-rim-${this._id})`;
      [this._rimGlowA, this._rimGlowB].forEach((l) => setAttrs(l, {
        stroke: rimStroke, 'stroke-width': 7, 'stroke-opacity': (rimA * 0.6).toFixed(4),
      }));
      [this._rimCoreA, this._rimCoreB].forEach((l) => setAttrs(l, {
        stroke: rimStroke, 'stroke-width': 1.25, 'stroke-opacity': (rimA * 0.95).toFixed(4),
      }));

      // --- emitter bloom at the window's top edge ---
      const bloomR = Math.max(70, o.sourceWidth * 2.6);
      setAttrs(this._bloom, { cx: sx.toFixed(1), cy: 0, rx: bloomR.toFixed(1), ry: (bloomR * 0.85).toFixed(1) });
      setAttrs(this._bloomStops[0], { 'stop-color': hot, 'stop-opacity': (0.95 * a).toFixed(4) });
      setAttrs(this._bloomStops[1], { 'stop-color': o.color, 'stop-opacity': (0.4 * a).toFixed(4) });
      setAttrs(this._bloomStops[2], { 'stop-color': o.color, 'stop-opacity': 0 });

      // --- halo: the light wrapping the element's own silhouette. Half
      // the stroke falls inside the element and is cut away by the mask,
      // leaving a rim that hugs the outside edge exactly - the same light
      // as the beam, because it is the beam. Deliberately tight and hot
      // rather than wide and soft: a wide, dim version sat inside the
      // beam's own landing glow and toggling it off changed almost
      // nothing on screen. ---
      const haloW = clamp(Math.min(h.hw, h.hh) * 0.2, 7, 24);
      setAttrs(this._halo, {
        x: (h.cx - h.hw).toFixed(1),
        y: (h.cy - h.hh).toFixed(1),
        width: (h.hw * 2).toFixed(1),
        height: (h.hh * 2).toFixed(1),
        rx: h.r.toFixed(1),
        stroke: hot,
        'stroke-width': haloW.toFixed(1),
        'stroke-opacity': ((o.haloGlow ? 0.85 : 0) * a).toFixed(4),
        style: `filter: blur(${(haloW * 0.38).toFixed(1)}px)`,
      });

      // --- floor pool: the beam landing on the surface the element
      // stands on, pushed a little downlight so it reads as cast rather
      // than as a second glow stuck to the element's underside. ---
      const poolW = Math.max(40, h.hw * 2.1);
      setAttrs(this._pool, {
        cx: (h.cx + axisX * h.hh * 0.5).toFixed(1),
        cy: (h.cy + h.hh + Math.max(8, h.hh * 0.18)).toFixed(1),
        rx: poolW.toFixed(1),
        ry: (poolW * 0.26).toFixed(1),
      });
      const poolA = (o.floorGlow ? 0.55 : 0) * a;
      setAttrs(this._poolStops[0], { 'stop-color': o.color, 'stop-opacity': poolA.toFixed(4) });
      setAttrs(this._poolStops[1], { 'stop-color': o.color, 'stop-opacity': (poolA * 0.45).toFixed(4) });
      setAttrs(this._poolStops[2], { 'stop-color': o.color, 'stop-opacity': 0 });

      // --- cut-out, shared by the light mask and the scrim mask ---
      const hole = {
        x: h.cx - h.hw, y: h.cy - h.hh,
        width: h.hw * 2, height: h.hh * 2,
        rx: h.r,
      };
      // Each cut-out is two rects, not one. A single blurred hole sized to
      // the element puts half its softness *inside* the element - a haze
      // of scrim over its own outer pixels, the one thing this effect
      // promises never to do. Growing the blurred hole to push that
      // outside was the first fix and it traded one artifact for a worse
      // one: a fully undimmed ring of page hugging the element, which on
      // a light page reads as a hard white outline drawn around it (and
      // which, being brighter than the actual rim light, made toggling
      // `haloGlow` look like it did nothing). So: a crisp rect at the
      // element's exact bounds guarantees the interior is fully clear,
      // and a blurred rect underneath it, also at the exact bounds,
      // contributes only the half of its falloff that lands outside.
      const holeRect = (extra) => ({
        x: hole.x.toFixed(1),
        y: hole.y.toFixed(1),
        width: hole.width.toFixed(1),
        height: hole.height.toFixed(1),
        rx: hole.rx.toFixed(1),
        ...extra,
      });
      // A mask's own region both clips what it masks and sizes the buffer
      // the mask is rasterized into, so it's pinned to exactly the
      // viewport. Oversizing it "to be safe" is what it sounds like:
      // free. It is not - at 3x the viewport on each axis Chrome quietly
      // gave up on the mask altogether and dropped the masked element,
      // which cost an afternoon of staring at a scrim that was measurably
      // present in the DOM and entirely absent on screen. Nothing outside
      // the viewport is visible anyway.
      const region = { x: 0, y: 0, width: vw, height: vh };
      setAttrs(this._lightMask, region);
      setAttrs(this._shadeMask, region);
      setAttrs(this._lightMaskBase, region);
      setAttrs(this._lightFeather, holeRect({ style: 'filter: blur(2.5px)' }));
      setAttrs(this._lightCore, holeRect());

      // --- scrim ---
      const darkA = o.darkOpacity * a;
      const holeFeather = clamp(Math.min(h.hw, h.hh) * 0.07, 3, 9);
      setAttrs(this._shadeBase, region);
      setAttrs(this._shadeFeather, holeRect({ style: `filter: blur(${holeFeather.toFixed(1)}px)` }));
      setAttrs(this._shadeCore, holeRect());
      setAttrs(this._shadeFill, {
        x: 0, y: 0, width: vw, height: vh,
        fill: '#05060a',
        'fill-opacity': darkA.toFixed(4),
      });

      // --- backdrop blur ---
      // One uniform blur, not a ladder of feathered rings. Rings at
      // decreasing radii were the first attempt at softening the
      // sharp-to-blurred transition, and each step boundary just read as
      // another line across the page. The single hard edge is instead
      // hidden by placing it a little outside the element, under the
      // scrim's own feather and the halo.
      const blur = o.blurAmount * a;
      if (blur > 0.05) {
        this.blurLayer.style.display = '';
        this.blurLayer.style.setProperty('--sp-blur', `${blur.toFixed(2)}px`);
        layoutBlurFrame(this.blurPanes, expand(hole, Math.max(3, holeFeather)), vw, vh);
      } else {
        this.blurLayer.style.display = 'none';
      }

      // Kept for the motes, which need the beam's frame every frame even
      // when the beam itself is standing still.
      this._beamFrame = { sx, sy, axisX, axisY, perpX, perpY, reach, loSlope, hiSlope, halfSrc, hot };
      this._driftMotes(o, dt, a);
    }

    _driftMotes(o, dt, a) {
      const frame = this._beamFrame;
      const moteA = (o.dustMotes ? 1 : 0) * a;
      this._moteGroup.setAttribute('opacity', moteA.toFixed(4));
      if (!frame || moteA <= 0.01) return;

      const { sx, sy, axisX, axisY, perpX, perpY, reach, loSlope, hiSlope, halfSrc, hot } = frame;
      const seconds = dt / 1000;
      for (const mote of this._motes) {
        mote.t += mote.speed * seconds;
        if (mote.t > 1) mote.t -= 1;
        mote.phase += mote.twinkle * seconds;
        const d = mote.t * reach;
        const lo = -halfSrc + loSlope * d;
        const hi = halfSrc + hiSlope * d;
        const offset = lo + (hi - lo) * mote.off;
        // Fade in off the emitter and out at the far end so they appear
        // and vanish inside the haze instead of popping at either end.
        const fade = Math.min(1, mote.t / 0.18) * Math.min(1, (1 - mote.t) / 0.25);
        setAttrs(mote.node, {
          cx: (sx + axisX * d + perpX * offset).toFixed(1),
          cy: (sy + axisY * d + perpY * offset).toFixed(1),
          r: mote.r.toFixed(2),
          fill: hot,
          'fill-opacity': (fade * (0.35 + 0.45 * (Math.sin(mote.phase) * 0.5 + 0.5))).toFixed(3),
        });
      }
    }
  }

  // Grows a hole rect by `margin` on every side, as an edge-keyed rect.
  function expand(hole, margin) {
    return {
      left: hole.x - margin,
      top: hole.y - margin,
      right: hole.x + hole.width + margin,
      bottom: hole.y + hole.height + margin,
    };
  }

  // Frames `hole` with four clipped panes covering the rest of the
  // viewport. Edges are rounded to whole pixels so the four wrappers tile
  // exactly - a fractional coordinate leaves either a hairline gap of
  // unblurred page or a sliver of doubled blur along the join, both of
  // which show.
  function layoutBlurFrame(panes, hole, vw, vh) {
    const l = Math.round(clamp(hole.left, 0, vw));
    const t = Math.round(clamp(hole.top, 0, vh));
    const r = Math.round(clamp(hole.right, l, vw));
    const b = Math.round(clamp(hole.bottom, t, vh));
    const rects = [
      [0, 0, vw, t],
      [0, b, vw, vh - b],
      [0, t, l, b - t],
      [r, t, vw - r, b - t],
    ];
    rects.forEach(([x, y, w, h], i) => {
      const { clip, pane } = panes[i];
      setRect(clip, x, y, w, h);
      // Every pane is the same full-viewport box, shifted back up into
      // place against its wrapper's offset - see the CSS comment.
      setRect(pane, -x, -y, vw, vh);
    });
  }

  function setRect(el, x, y, w, h) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${Math.max(0, w)}px`;
    el.style.height = `${Math.max(0, h)}px`;
  }

  let stage = null;
  function getStage() {
    if (!stage) stage = new Stage();
    return stage;
  }

  // ---------------------------------------------------------------------
  // SpotlightEl: one per element. Owns its own pop (scale/lift/shadow)
  // and its own trigger listeners; the light itself belongs to the stage.
  // ---------------------------------------------------------------------

  class SpotlightEl {
    constructor(el, options) {
      this.el = el;
      this.options = { ...DEFAULTS, ...options };
      this.amount = 0;
      this.target = 0;
      this.radius = 0;
      // Set only by the click trigger's toggle, and read by the stage:
      // it's what separates "this element is holding the light until
      // clicked again" from "the pointer happens to be over it".
      this.latched = false;
      this._lastT = performance.now();
      // Current --sp-lift offset in px, written every frame by _render()
      // and read back by _restRect() to undo it (see _onPointerLeave()).
      this._offsetY = 0;
      this._watching = false;

      this.stage = getStage();
      this.stage.register(this);

      this._onPointerEnter = this._onPointerEnter.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this._onWatchMove = this._onWatchMove.bind(this);
      this._onWindowLeave = this._onWindowLeave.bind(this);
      this._onClick = this._onClick.bind(this);
      this._tick = this._tick.bind(this);

      this._bindTrigger();
      this._wake();
    }

    _wake() {
      if (this._raf) return;
      this._lastT = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }

    _bindTrigger() {
      if (!this.options.autoBind) return;
      if (this.options.trigger === 'click') {
        this.el.addEventListener('click', this._onClick);
      } else {
        this.el.addEventListener('pointerenter', this._onPointerEnter);
        this.el.addEventListener('pointerleave', this._onPointerLeave);
        this.el.addEventListener('focusin', this._onPointerEnter);
        this.el.addEventListener('focusout', this._onPointerLeave);
      }
    }

    _unbindTrigger() {
      this.el.removeEventListener('click', this._onClick);
      this.el.removeEventListener('pointerenter', this._onPointerEnter);
      this.el.removeEventListener('pointerleave', this._onPointerLeave);
      this.el.removeEventListener('focusin', this._onPointerEnter);
      this.el.removeEventListener('focusout', this._onPointerLeave);
    }

    enter() {
      this.target = 1;
      // Measured on the way in rather than every frame: it's the one piece
      // of the element's geometry a style recalc has to be forced for, and
      // it doesn't change while the pointer sits on it.
      const rect = this.el.getBoundingClientRect();
      this.radius = readRadius(this.el, rect.width, rect.height);
      this.stage.claim(this);
      this._wake();
    }

    leave() {
      this.target = 0;
      this._unwatchRestRect();
      this.stage.release(this);
      this._wake();
    }

    toggle() {
      this.latched = !this.latched;
      if (this.latched) this.enter(); else this.leave();
    }

    _onPointerEnter(event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      this._unwatchRestRect();
      this.enter();
    }

    // A lifted/scaled element translates out from under a stationary
    // pointer, which fires a native `pointerleave` even though the
    // pointer never moved - see liftoff.js's identical comment on its own
    // _onPointerLeave() for the full oscillation story. So a `pointerleave`
    // only counts once the pointer has actually left the element's
    // *resting* footprint (no --sp-lift/--sp-scale applied); inside that
    // footprint _watchRestRect() takes over until the pointer genuinely
    // leaves it.
    _onPointerLeave(event) {
      // focusout has no pointer coordinates; it's always a real leave.
      if (event && typeof event.clientX === 'number' && this._pointerInRestRect(event)) {
        this._watchRestRect();
        return;
      }
      this.leave();
    }

    // The element's layout box in viewport coordinates with its --sp-lift
    // translation undone (--sp-scale doesn't move the center, since it
    // scales about it). Recomputed per event rather than cached so
    // scrolling and reflow stay accounted for.
    _restRect() {
      const rect = this.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2 - this._offsetY;
      const halfW = this.el.offsetWidth / 2;
      const halfH = this.el.offsetHeight / 2;
      return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH };
    }

    _pointerInRestRect(event) {
      const r = this._restRect();
      return event.clientX >= r.left && event.clientX <= r.right
        && event.clientY >= r.top && event.clientY <= r.bottom;
    }

    // Pointer tracking for the window of time where the element has moved
    // off the pointer but the pointer is still over where it started.
    // Capture phase so it still sees moves consumed by whatever element
    // the card vacated.
    _watchRestRect() {
      if (this._watching) return;
      this._watching = true;
      global.addEventListener('pointermove', this._onWatchMove, true);
      document.addEventListener('pointerleave', this._onWindowLeave);
    }

    _unwatchRestRect() {
      if (!this._watching) return;
      this._watching = false;
      global.removeEventListener('pointermove', this._onWatchMove, true);
      document.removeEventListener('pointerleave', this._onWindowLeave);
    }

    _onWatchMove(event) {
      if (this._pointerInRestRect(event)) return;
      this.leave();
    }

    // The pointer left the window entirely, so no further pointermove is
    // coming to tell us it left the resting footprint.
    _onWindowLeave() {
      this.leave();
    }

    _onClick() { this.toggle(); }

    _tick(now) {
      const dt = Math.min(64, now - this._lastT);
      this._lastT = now;
      const k = 1 - Math.exp(-dt / this.options.smoothing);
      this.amount += (this.target - this.amount) * k;
      if (Math.abs(this.target - this.amount) < 0.0008) this.amount = this.target;
      this._render();
      // Parked once it has settled at either end; enter()/leave() restart
      // it. The host's pop is the only thing this loop drives, and a
      // settled pop has nothing left to write.
      this._raf = this.amount === this.target
        ? null
        : requestAnimationFrame(this._tick);
    }

    _render() {
      const o = this.options;
      const a = this.amount;
      const style = this.el.style;

      // Kept for _restRect(), which subtracts it back off the live
      // bounding rect to recover where the element sits untransformed.
      this._offsetY = -o.lift * a;

      style.setProperty('--sp-amount', a.toFixed(4));
      style.setProperty('--sp-scale', (1 + (o.scale - 1) * a).toFixed(4));
      style.setProperty('--sp-lift', `${this._offsetY.toFixed(2)}px`);

      if (a < 0.004) {
        style.setProperty('--sp-shadow', 'none');
        return;
      }
      // Cast away from the light rather than straight down, so the
      // element's own shadow agrees with the direction the beam arrives
      // from. Paired with a soft glow in the beam's own color - gated on
      // haloGlow along with the stage's rim, since two separately-owned
      // pieces of rim light meant turning the option off still left one
      // of them burning.
      const rad = (o.angle * Math.PI) / 180;
      const dx = -Math.sin(rad) * 26 * a;
      const dy = Math.cos(rad) * 26 * a;
      const shadow = `${dx.toFixed(1)}px ${dy.toFixed(1)}px ${(46 * a).toFixed(1)}px rgba(0, 0, 0, ${(0.4 * a).toFixed(3)})`;
      style.setProperty('--sp-shadow', o.haloGlow
        ? `${shadow}, 0 0 ${(30 * a).toFixed(1)}px ${rgba(o.color, (0.28 * a).toFixed(3))}`
        : shadow);
    }

    update(options = {}) {
      const prevTrigger = this.options.trigger;
      const prevAutoBind = this.options.autoBind;
      Object.assign(this.options, options);
      if (this.options.trigger !== prevTrigger || this.options.autoBind !== prevAutoBind) {
        this._unbindTrigger();
        this._bindTrigger();
      }
      // A settled instance has parked its loop, so a live option change
      // (the demo page's controls, say) needs one frame to land in.
      this._wake();
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this._unwatchRestRect();
      this._unbindTrigger();
      this.stage.unregister(this);
      this.el.style.removeProperty('--sp-scale');
      this.el.style.removeProperty('--sp-lift');
      this.el.style.removeProperty('--sp-shadow');
    }
  }

  function initAll(selector, options) {
    injectStyles();
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.__spotlightInstance)
      .map((el) => {
        // A `data-sp-trigger` attribute overrides `trigger` per element -
        // the only way to claim one for 'click' when a blanket auto-init
        // is also covering it, since auto-init's own DOMContentLoaded
        // listener always wins the race against a later initAll call.
        const perEl = el.dataset.spTrigger ? { trigger: el.dataset.spTrigger } : {};
        const instance = new SpotlightEl(el, { ...options, ...perEl });
        el.__spotlightInstance = instance;
        return instance;
      });
  }

  function get(elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    return el ? el.__spotlightInstance || null : null;
  }

  global.Spotlight = { initAll, get, SpotlightEl, DEFAULTS };

  if (!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    document.addEventListener('DOMContentLoaded', () => initAll('.spotlight-el'));
  }
})(window);
