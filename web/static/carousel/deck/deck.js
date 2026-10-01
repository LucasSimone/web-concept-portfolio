/**
 * Deck
 * ----
 * A frame changer. One box, a stack of frames inside it, and a transition that
 * decides what the move from one to the next looks like - a slide, a crossfade,
 * a cube face turning, a card dealt off the top, or the arc of a View-Master
 * reel. Everything else - position, input, controls, accessibility - is the
 * same whichever one you pick.
 *
 * The whole engine runs on a single number. `_pos` is the position in frames,
 * an integer at rest and a float while moving, and every frame's appearance is
 * a function of `delta` - its signed, wrapped distance from that position
 * (0 is in view, +1 is one ahead, -0.5 is halfway out backward). A transition
 * is therefore just that function:
 *
 *   Deck.transitions.myFade = {
 *     scrub: true,                 // can a drag track it 1:1?
 *     cull: 1,                     // hide frames further out than this
 *     defaults: { softness: 1 },   // options this transition owns
 *     measure(ctx, frames) {},     // optional: re-derive on resize
 *     style(frame, delta, ctx) {   // required: paint one frame
 *       frame.style.opacity = String(1 - Math.abs(delta));
 *     },
 *     setup(ctx) {}, teardown(ctx) {},   // optional: per-instance DOM/CSS
 *   };
 *
 * Six are built in: `slide`, `fade`, `zoom`, `stack`, `cube` and
 * `stereoscope`. They are not special - they use exactly the interface above,
 * and a transition of your own registered on `Deck.transitions` (or passed
 * inline as an object) is a first-class citizen.
 *
 * The core has already set a sensible `z-index` on the frame before calling
 * `style`, and a transition is free to overwrite it - but it must stay below
 * 200. The port is not a stacking context of its own (positioned, z-index
 * auto), so a frame's z-index competes with the glare overlay at 200 and the
 * arrows and dots at 250 rather than only with its sibling frames.
 *
 * Two behaviours follow from the transition rather than from the component,
 * and both matter:
 *
 * **Scrub or ratchet.** A slide can track a finger 1:1 and settle wherever it
 * lands; an arc cannot, because a frame parked at 13deg just looks broken. So
 * a transition declares `scrub`, and a drag either scrubs the position
 * directly and settles with a flick, or gives by a fraction of a step and then
 * commits a whole frame. Everything else - click, wheel, keys, dots - moves in
 * whole frames either way.
 *
 * **What shows between frames.** Transitions that separate frames (slide, the
 * arc) reveal the box behind them, which is `--dk-body`. Transitions that
 * cross-fade in place never show it. That is why `gap` belongs to the
 * transition and not to the core.
 *
 * Usage - this is a complete, working carousel:
 *
 *   <div class="deck" data-transition="slide">
 *     <div class="deck-port">
 *       <div class="deck-frame">...</div>
 *       <div class="deck-frame">...</div>
 *     </div>
 *   </div>
 *   <script src="deck.js"></script>
 *
 * It injects its own structural CSS and auto-initializes against every
 * `.deck:not(.is-empty)` on the page. Sizing is zero-config and responsive:
 * the root is `width: 100%` with `aspect-ratio: var(--dk-aspect, 3 / 2)`, so a
 * ratio and a `max-width` are the only two sizing decisions, and an explicit
 * `height` overrides the ratio. Frames fill the box by definition; anything
 * can go inside one, and `.deck` is a container-query context so `cqw` units
 * there track the deck rather than the viewport.
 *
 * Any element can drive a deck without a line of JS, which is how the built-in
 * arrows and dots drive it too: `data-deck-next`, `data-deck-prev` and
 * `data-deck-to="N"` are handled by one delegated listener, scoped to the
 * enclosing `.deck` or to whatever `data-deck-for="#id"` points at.
 * `data-deck-lever` turns an element of your own into a pull lever.
 */
(function (global) {
  // See shared/carousel-kit.js - the arithmetic, the per-tab memory of
  // which frame was parked, and the initAll/get/getAll surface that all
  // four carousels here share. Already bundled into the file this URL
  // serves, so there is nothing extra to load.
  const {
    clamp, mod, wrapDelta, ownsArrowKeys, createIndexMemory, registerEffect,
  } = global.CarouselKit;

  const STYLE_ID = 'deck-styles';

  const CSS = `
.deck {
  /* A container-query context, so frame content can be sized in cqw units and
     track the deck's own width rather than the viewport's. The injected
     controls use it too, to shrink their hit targets on a small deck. */
  container-type: inline-size;
  position: relative;
  z-index: 0;
  /* The whole sizing story: fill the available width at a given ratio. A host
     that sets an explicit height overrides the ratio (both dimensions
     definite), and --dk-aspect covers every other case. */
  width: 100%;
  aspect-ratio: var(--dk-aspect, 3 / 2);
  border-radius: var(--dk-radius, 0px);
  /* What shows behind the frames - between them for the transitions that
     separate them, and what a soft-edged mask fades into. */
  background: var(--dk-body, #111);
  touch-action: pan-y;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.deck-port {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: var(--dk-radius, 0px);
  background: var(--dk-body, #111);
  -webkit-mask-image: var(--dk-mask, none);
  mask-image: var(--dk-mask, none);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}
/* With clip off the port stops being a window and the frames are simply laid
   out on the page. Only worth it for a transition that keeps its frames inside
   the box and fades them out before they leave it (stack does; slide and the
   arc emphatically do not, which is why clipping is the default). */
.deck.is-unclipped .deck-port { overflow: visible; }
.deck.is-clickable .deck-port { cursor: pointer; }
.deck.is-dragging .deck-port { cursor: grabbing; }
.deck.is-empty .deck-port,
.deck.is-single .deck-port { cursor: default; }

.deck-frame {
  position: absolute;
  inset: 0;
  overflow: hidden;
  will-change: transform, opacity;
  /* For the 3D transitions: without this the reverse of a turning face shows
     through, mirrored. Harmless to the flat ones. */
  backface-visibility: hidden;
}
.deck-frame[hidden] { display: none; }
/* So that the most common frame content - one image or one video - fills the
   frame without the host writing any CSS. Override freely. */
.deck-frame > img,
.deck-frame > video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Optional masks. 'vignette' suits any shape; 'binocular' is two overlapping
   ellipses unioned (mask-composite's initial value is already 'add', so
   listing both layers is the whole trick) and only reads as a pair of
   eyepieces on a roughly 2:1 deck. */
.deck.is-mask-vignette {
  --dk-mask: radial-gradient(ellipse 74% 74% at 50% 50%, #000 62%, transparent 100%);
}
.deck.is-mask-porthole {
  --dk-mask: radial-gradient(ellipse 60% 60% at 50% 50%, #000 78%, transparent 100%);
}
.deck.is-mask-binocular {
  --dk-mask:
    radial-gradient(ellipse 30% 48% at 30% 50%, #000 78%, transparent 100%),
    radial-gradient(ellipse 30% 48% at 70% 50%, #000 78%, transparent 100%);
}

/* Above every frame but below the controls. The port doesn't create a stacking
   context of its own (positioned, z-index auto), so this number is competing
   with the arrows' and the dots' rather than only with the frames'. */
.deck-glare {
  position: absolute;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  background:
    linear-gradient(118deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.04) 24%, transparent 42%),
    radial-gradient(ellipse 74% 74% at 50% 48%, transparent 50%, rgba(0, 0, 0, 0.5) 100%);
}

/* --- Injected controls -------------------------------------------------
   All of it lives on the root rather than inside the port, so a mask never
   clips a control and a press on one never reads as a press on a frame. */
.deck-arrow,
.deck-dot {
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.deck-arrow {
  position: absolute;
  top: 50%;
  z-index: 250;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--dk-arrow-size, 42px);
  height: var(--dk-arrow-size, 42px);
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--dk-control, rgba(14, 14, 14, 0.5));
  color: var(--dk-control-fg, #fff);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  transition: background 140ms ease, opacity 140ms ease;
}
/* Pushes the touch target out past the visible circle without growing it. */
.deck-arrow::before {
  content: '';
  position: absolute;
  inset: -7px;
}
.deck-arrow:hover,
.deck-arrow:focus-visible {
  background: var(--dk-control-active, rgba(14, 14, 14, 0.78));
}
.deck-arrow:focus-visible {
  outline: 2px solid var(--dk-control-fg, #fff);
  outline-offset: 2px;
}
.deck-arrow svg {
  width: 52%;
  height: 52%;
}
.deck-arrow[data-deck-prev] { left: var(--dk-control-inset, 12px); }
.deck-arrow[data-deck-next] { right: var(--dk-control-inset, 12px); }
.deck-arrow[data-deck-next] svg { transform: scaleX(-1); }

.deck-dots {
  position: absolute;
  left: 50%;
  bottom: var(--dk-control-inset, 12px);
  z-index: 250;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px 5px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--dk-control, rgba(14, 14, 14, 0.5));
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.deck-dots[hidden] { display: none; }
.deck-dot {
  position: relative;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  background: none;
}
/* Same trick as the arrows: a dot is small because a big one looks wrong, but
   a thumb is a thumb, so the hit area reaches past the pill. */
.deck-dot::before {
  content: '';
  position: absolute;
  inset: -9px -1px;
}
.deck-dot::after {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dk-control-fg, #fff);
  opacity: 0.4;
  transition: opacity 140ms ease, transform 140ms ease;
}
.deck-dot:hover::after { opacity: 0.75; }
.deck-dot.is-active::after {
  opacity: 1;
  transform: scale(1.3);
}
.deck-dot:focus-visible {
  outline: 2px solid var(--dk-control-fg, #fff);
  outline-offset: -2px;
  border-radius: 50%;
}

/* A deck with nothing to advance to shows no controls at all. */
.deck.is-single .deck-arrow,
.deck.is-single .deck-dots,
.deck.is-single .deck-lever--own { display: none; }

@container (max-width: 400px) {
  .deck-arrow { --dk-arrow-size: 34px; }
  .deck-dot { width: 16px; height: 16px; }
  .deck-arrow,
  .deck-dots { --dk-control-inset: 8px; }
}

/* --- The optional lever ------------------------------------------------
   Drawn in the bottom-right corner, over the picture rather than in a gutter
   of its own, so turning it on never changes the deck's geometry. Pull it
   down or just tap it. A host-supplied [data-deck-lever] gets the same gesture
   and none of this styling - while a pull is live the element carries
   --dk-pull (0 to 34deg) and .is-pulling, which is everything a lever of your
   own needs to animate itself. */
.deck-lever--own {
  position: absolute;
  right: var(--dk-control-inset, 12px);
  bottom: var(--dk-control-inset, 12px);
  z-index: 250;
  width: 34px;
  height: 74px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.deck-lever--own:focus-visible {
  outline: 2px solid var(--dk-lever, #e8e8e8);
  outline-offset: 0;
  border-radius: 4px;
}
.deck-lever-arm {
  position: absolute;
  left: 50%;
  bottom: 8%;
  width: 7px;
  height: 72%;
  margin-left: -3.5px;
  border-radius: 4px;
  background: var(--dk-lever, #e8e8e8);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
  transform-origin: 50% 100%;
  transform: rotate(var(--dk-pull, 0deg));
  transition: transform 220ms cubic-bezier(0.22, 1.4, 0.4, 1);
}
.deck-lever--own.is-pulling .deck-lever-arm { transition: none; }
.deck-lever-arm::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -8px;
  width: 17px;
  height: 13px;
  margin-left: -8.5px;
  border-radius: 3px;
  background: inherit;
}
.deck-lever-arm::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: inherit;
  opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
  .deck-lever-arm,
  .deck-arrow,
  .deck-dot::after { transition: none; }
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Pixels of wheel delta that advance one frame.
  const WHEEL_STEP = 90;
  // A press that moves less than this is a click, not a drag.
  const CLICK_SLOP = 6;
  // Ratchet transitions only: the fraction of a step a drag may move things
  // before it commits - the play a real mechanism has - and how fast that play
  // decays back to zero per frame when the drag stops short.
  const DRAG_PLAY = 0.2;
  const SLACK_DECAY = 0.82;
  // Drag distance that commits one step on a ratchet transition: a fraction of
  // the deck's width, floored so a narrow deck still needs a deliberate swipe.
  const SWIPE_FRACTION = 0.08;
  const SWIPE_FLOOR = 36;
  // Scrub transitions: frames per millisecond of release velocity past which a
  // flick carries to the next frame rather than settling on the nearest, and
  // how long a sample stays in the velocity window.
  const FLICK_VELOCITY = 0.0012;
  const VELOCITY_WINDOW = 90;
  // Shortest sample window that counts as a measurement rather than noise.
  const VELOCITY_FLOOR = 8;
  // How far a flick may carry beyond the frame it was released on.
  const FLICK_MAX = 2;
  // Default for a transition that doesn't declare one.
  const CULL_DISTANCE = 1.6;
  // Past this many frames, dots stop being an index and become confetti.
  const DOTS_MAX = 12;
  // Degrees the lever arm swings through, and pixels of drag that pull it.
  const LEVER_SWING = 34;
  const LEVER_TRAVEL = 48;
  // A multi-frame jump (a dot, or `to()`) takes longer than one step, but
  // nothing like proportionally longer - it spins rather than trudges. Under
  // one frame - a scrub settling - it takes proportionally less, with a floor.
  const JUMP_GROWTH = 0.35;
  const JUMP_CAP = 2.4;
  const SETTLE_FLOOR = 0.4;

  const CORE_DEFAULTS = {
    // Which transition to run: a key on Deck.transitions, or a transition
    // object of your own.
    transition: 'slide',

    // --- Motion ---
    // Milliseconds for one step.
    duration: 320,
    // How hard a step rebounds as it lands, 0 to 1. 0 arrives dead.
    bounce: 0.2,

    // --- Controls ---
    // Prev/next buttons, overlaid at the sides.
    arrows: true,
    // The row of dots, which both shows the position and jumps to a frame.
    // Suppressed automatically past 12 frames.
    dots: true,
    // The pull lever, in the bottom-right corner. Off by default; an element
    // of your own carrying `data-deck-lever` is used instead when present.
    lever: false,

    // --- Input ---
    // Click or tap the frame to advance. Backwards is the left arrow button, a
    // swipe, shift-click, or the left/up arrow keys.
    click: true,
    // Drag the frames. On a scrub transition this tracks the pointer 1:1 and
    // settles where it lands; on a ratchet one it gives a little and then
    // commits a whole frame.
    drag: true,
    // 'x' takes horizontal wheel/trackpad deltas only, so a vertical scroll
    // always passes through to the page. 'any' also takes vertical ones, which
    // is what a plain mouse wheel produces - at the cost of capturing page
    // scroll while the pointer is over the deck. false takes neither.
    wheel: 'x',

    // --- Behavior ---
    // Milliseconds between automatic advances; 0 is off. Pauses while off
    // screen, on a hidden tab, while hovered or focused, and under
    // prefers-reduced-motion.
    autoplay: 0,

    // --- Appearance ---
    // Whether the box clips its frames. false lets a transition's frames spill
    // onto the page, which (with --dk-body: transparent) is what turns a stack
    // into loose cards lying on the page rather than cards in a window. Only
    // sensible for a transition that keeps its frames near the box and fades
    // them out before they leave it.
    clip: true,
    // 'none', 'vignette' (soft-edged all round), 'porthole' (one oval), or
    // 'binocular' (two eyepieces; wants a roughly 2:1 deck).
    mask: 'none',
    // Lens sheen and vignette laid over the frames.
    glare: false,
  };

  const MASKS = ['none', 'vignette', 'porthole', 'binocular'];

  // ----- transitions -----
  //
  // Each one is a plain object implementing the interface in the header. The
  // core has already decided *where* every frame is in the sequence; all a
  // transition does is turn that into appearance.

  const TRANSITIONS = {
    // Frames side by side on a line. The one everything else is measured
    // against, and the only one where `gap` is literally empty space.
    slide: {
      scrub: true,
      cull: 1.2,
      defaults: { gap: 0.04 },
      style(frame, delta, ctx) {
        const step = 100 + Math.max(0, ctx.options.gap) * 100;
        frame.style.transform = `translate3d(${(delta * step).toFixed(3)}%, 0, 0)`;
      },
    },

    // A crossfade that never dips. The incoming frame fades in *over* an
    // outgoing one left at full opacity, rather than both meeting at 50% -
    // two half-transparent layers would let the body color show through the
    // middle of the transition and read as a flash.
    fade: {
      scrub: true,
      cull: 1,
      style(frame, delta, ctx) {
        const away = Math.abs(delta);
        frame.style.transform = '';
        if (!ctx.dir) {
          frame.style.opacity = away < 0.001 ? '1' : '0';
          frame.style.zIndex = away < 0.001 ? '190' : '100';
          return;
        }
        const incoming = Math.sign(delta) === ctx.dir;
        frame.style.opacity = incoming
          ? String(clamp(1 - away, 0, 1))
          : (away >= 0.999 ? '0' : '1');
        frame.style.zIndex = incoming ? '190' : '100';
      },
    },

    // The same crossfade with scale on it: the arriving frame grows into
    // place while the leaving one pushes past the lens.
    zoom: {
      scrub: true,
      cull: 1,
      defaults: { zoomScale: 0.14 },
      style(frame, delta, ctx) {
        const away = Math.abs(delta);
        const amount = Math.max(0, ctx.options.zoomScale);
        if (!ctx.dir) {
          frame.style.transform = 'scale(1)';
          frame.style.opacity = away < 0.001 ? '1' : '0';
          frame.style.zIndex = away < 0.001 ? '190' : '100';
          return;
        }
        // Scale is read off the *side* a frame is on, not off which way the
        // deck is travelling: a frame ahead is small and grows into place, one
        // behind is large and pushes past. Opacity is the direction-dependent
        // half, and it stays visually continuous if the direction flips
        // mid-move (a scrub released backward), which scale would not.
        const incoming = Math.sign(delta) === ctx.dir;
        const scale = delta >= 0 ? 1 - amount * away : 1 + amount * 0.6 * away;
        frame.style.transform = `scale(${scale.toFixed(4)})`;
        frame.style.opacity = incoming
          ? String(clamp(1 - away, 0, 1))
          : (away >= 0.999 ? '0' : '1');
        frame.style.zIndex = incoming ? '190' : '100';
      },
    },

    // A dealt deck: the top card is thrown off to the left and the ones behind
    // it rise and grow into its place. The only built-in that shows more than
    // two frames at once, which is why it culls so much later - and the only
    // one where the card in view does *not* fill the box. It can't: a card that
    // covers every pixel leaves nothing for the pile behind it to peek out of,
    // so the whole stack is inset by `stackInset` and the deck's own background
    // becomes the table they're dealt onto.
    stack: {
      scrub: true,
      cull: 3.4,
      defaults: {
        stackInset: 0.12, stackOffset: 9, stackScale: 0.075, stackFade: 0.2, stackTilt: 5,
      },
      style(frame, delta, ctx) {
        const o = ctx.options;
        const base = 1 - clamp(o.stackInset, 0, 0.6);
        if (delta <= 0) {
          // On its way out: off to the left, tilting, fading as it goes. The
          // fade is quadratic so the card stays solid through most of the throw
          // and still reaches zero exactly one frame out - which is what lets
          // this transition run with `clip: false`, where a card that merely
          // got faint would carry on across the page.
          const gone = -delta;
          frame.style.transform =
            `translate3d(${(delta * 108).toFixed(2)}%, 0, 0)`
            + ` rotate(${(delta * o.stackTilt).toFixed(2)}deg) scale(${base.toFixed(4)})`;
          frame.style.opacity = String(clamp(1 - gone * gone, 0, 1));
          frame.style.zIndex = '190';
          return;
        }
        // Waiting behind, peeking out below the one on top.
        const back = Math.min(delta, 3);
        frame.style.transform =
          `translate3d(0, ${(back * o.stackOffset).toFixed(2)}%, 0)`
          + ` scale(${(base - back * o.stackScale).toFixed(4)})`;
        frame.style.opacity = String(clamp(1 - back * o.stackFade, 0, 1));
        frame.style.zIndex = String(150 - Math.round(back * 10));
      },
    },

    // Faces of a box turning about its vertical axis. The only built-in that
    // needs per-instance setup: perspective has to go on the port, and each
    // frame's transform-origin has to sit half a width *behind* it, which is
    // where the box's axis is. Note the port can't use transform-style:
    // preserve-3d - `overflow: hidden` flattens it - so the faces are sorted by
    // z-index rather than by the compositor, which is fine for a convex shape.
    cube: {
      scrub: true,
      cull: 1.05,
      measure(ctx, frames) {
        ctx.port.style.perspective = `${Math.round(ctx.w * 1.8)}px`;
        const axis = (ctx.w / 2).toFixed(1);
        frames.forEach((frame) => {
          frame.style.transformOrigin = `50% 50% -${axis}px`;
        });
      },
      teardown(ctx) {
        ctx.port.style.perspective = '';
      },
      style(frame, delta, ctx) {
        frame.style.transform = `rotateY(${(delta * 90).toFixed(3)}deg)`;
        frame.style.zIndex = String(100 - Math.round(Math.abs(delta) * 20));
      },
    },

    // The View-Master: frames mounted radially on a disc whose pivot is off
    // screen below the deck, so the only transform any of them gets is
    // rotate() about one shared origin. The angular pitch isn't configurable -
    // it falls out of the measured width and the disc radius, as the angle
    // whose *chord* spans one frame width plus `gap`. (The chord rather than
    // the arc, because the chord is how far apart the frame centers actually
    // sit on screen, which is what has to clear a frame width for one to leave
    // as the next arrives.) At arc 0.5 the radius is 2.4 widths and that pitch
    // lands near 26deg, which is a real reel's 360/14.
    //
    // It is the one built-in that does not scrub: a frame parked halfway
    // through an arc is not a pose anything can rest in, and the real thing
    // can't be scrubbed either - a pull of the lever either advances a frame
    // or it doesn't.
    stereoscope: {
      scrub: false,
      cull: 1.6,
      defaults: { arc: 0.5, gap: 0.1 },
      measure(ctx, frames) {
        const o = ctx.options;
        // Clamped at both ends: too small a radius and the chord can't fit on
        // the circle at all, too large and transform-origin starts losing
        // precision at distances no one can see the curvature of anyway.
        const widths = clamp(1.2 / Math.max(0.0001, o.arc), 1, 40);
        const radius = ctx.w * widths;
        const chord = ctx.w * (1 + Math.max(0, o.gap));
        ctx.state.pitch = 2 * Math.asin(clamp(chord / (2 * radius), 0, 1)) * (180 / Math.PI);
        const pivot = (ctx.h / 2 + radius).toFixed(1);
        frames.forEach((frame) => {
          frame.style.transformOrigin = `50% ${pivot}px`;
        });
      },
      style(frame, delta, ctx) {
        frame.style.transform = `rotate(${(delta * (ctx.state.pitch || 0)).toFixed(3)}deg)`;
      },
    },
  };

  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

  class Deck {
    constructor(root, options = {}) {
      if (!root) throw new Error('Deck: root element is required');
      injectStyles();
      installHooks();
      this.root = root;
      this.port = root.querySelector('.deck-port');
      if (!this.port) throw new Error('Deck: root must contain a .deck-port');

      // What the host actually asked for, kept apart from the resolved option
      // set: a transition brings defaults of its own, and switching transitions
      // has to re-seed those without forgetting the host's own choices.
      this._userOptions = { ...options };
      this.options = { ...CORE_DEFAULTS };
      this._ctx = { root, port: this.port, w: 0, h: 0, options: this.options, state: {}, dir: 0 };

      // Position in frames. An integer whenever the deck is at rest.
      this._pos = 0;
      // Ratchet drag play, added to _pos at render time only, so _pos stays the
      // honest "which frame are we parked on" number.
      this._nudge = 0;
      // Target of the move in flight, or null when nothing is moving.
      this._stepTo = null;
      this._stepFrom = 0;
      this._stepStart = null;
      this._stepMs = 0;
      // Direction of travel, which the crossfade transitions need in order to
      // know which frame is arriving and which is leaving.
      this._dir = 0;
      this._frames = [];
      this._dotEls = [];
      this._levers = [];
      this._dragging = false;
      this._scrubbing = false;
      this._dragStartX = 0;
      this._dragStartPos = 0;
      this._dragDx = 0;
      this._samples = [];
      // Wheel deltas accumulate here until they add up to a whole frame -
      // a trackpad delivers a flick as dozens of tiny events.
      this._wheelAccum = 0;
      this._pulling = null;
      this._pullStartY = 0;
      this._pullFired = false;
      this._hovering = false;
      this._autoTimer = null;
      this._activeDot = -1;
      // -1 so the very first settle (including frame 0) always fires.
      this._settledIndex = -1;
      // Remembers the parked frame across page loads within the same tab.
      this._memory = createIndexMemory(root, 'deck');
      this._restored = false;

      this._reduced = global.matchMedia
        ? global.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
      // A move re-reads the query every frame so it tracks a live change on its
      // own. autoplay can't - it's a timer that was either created or not -
      // hence this listener, so the setting takes effect without a reload.
      this._onReducedChange = () => this._syncAuto();
      if (this._reduced && this._reduced.addEventListener) {
        this._reduced.addEventListener('change', this._onReducedChange);
      }

      this._onWheel = this._onWheel.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onPullMove = this._onPullMove.bind(this);
      this._onPullUp = this._onPullUp.bind(this);
      this._onLeverDown = this._onLeverDown.bind(this);
      this._onLeverKey = this._onLeverKey.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onEnter = this._onEnter.bind(this);
      this._onLeave = this._onLeave.bind(this);
      this._onVisibility = this._onVisibility.bind(this);
      this._tick = this._tick.bind(this);

      this.port.addEventListener('wheel', this._onWheel, { passive: false });
      this.port.addEventListener('pointerdown', this._onPointerDown);
      this.root.addEventListener('keydown', this._onKeyDown);
      this.root.addEventListener('pointerenter', this._onEnter);
      this.root.addEventListener('pointerleave', this._onLeave);
      document.addEventListener('visibilitychange', this._onVisibility);
      // A ResizeObserver rather than a window resize listener: the element's
      // size doesn't only change when the viewport does - a sidebar opening, a
      // container query, a font finally loading - and a transition's measured
      // geometry would silently go stale.
      this._resizeObserver = new ResizeObserver(() => {
        this._measure();
        this._render();
      });
      this._resizeObserver.observe(this.root);

      if (!this.root.hasAttribute('tabindex')) this.root.tabIndex = 0;
      if (!this.root.hasAttribute('role')) this.root.setAttribute('role', 'group');

      this._onScreen = true;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        const on = entries[entries.length - 1].isIntersecting;
        if (on === this._onScreen) return;
        this._onScreen = on;
        if (!on) this._stop();
        else if (this._needsLoop()) this._start();
        this._syncAuto();
      }, { rootMargin: '200px' });
      this._intersectionObserver.observe(this.root);

      // An unset transition option falls back to the markup, so a deck can pick
      // its transition without any JS at all.
      this._setTransition(this._userOptions.transition
        || root.getAttribute('data-transition')
        || CORE_DEFAULTS.transition);
      this._buildChrome();
      this.refresh();
    }

    // Re-reads which frames are present (anything .deck-frame and not
    // `hidden`), rebuilds the dots to match and parks on frame 0. The first
    // call - from the constructor - instead restores whatever frame was last
    // parked, if one was persisted.
    refresh() {
      this._frames = Array.from(this.port.children)
        .filter((el) => el.classList.contains('deck-frame') && !el.hidden);

      let startIndex = 0;
      if (!this._restored) {
        this._restored = true;
        const stored = this._memory.read();
        if (stored !== null && this._frames.length > 0) {
          startIndex = mod(stored, this._frames.length);
        }
      }

      this._pos = startIndex;
      this._nudge = 0;
      this._stepTo = null;
      this._stepStart = null;
      this._dir = 0;
      this._settledIndex = -1;
      this.root.classList.toggle('is-single', this._frames.length < 2);
      this._syncDots();
      this._measure();
      if (this._frames.length > 0) this._setSettledIndex(startIndex);
      this._render();
      this._syncAuto();
    }

    // Merges new option values in, then rebuilds whatever they touched. Passing
    // `transition` here switches transitions, which is safe at any time -
    // including mid-move.
    update(options = {}) {
      const { transition, ...rest } = options;
      Object.assign(this._userOptions, rest);
      if (transition !== undefined) this._setTransition(transition);
      else this._resolveOptions();
      this._buildChrome();
      this._syncDots();
      this._measure();
      this._render();
      this._syncAuto();
    }

    // The frame currently in view, or -1 when there are none.
    get index() {
      if (this._frames.length === 0) return -1;
      return mod(Math.round(this._pos), this._frames.length);
    }

    // How many frames are in the deck.
    get length() {
      return this._frames.length;
    }

    // The current transition's name, or 'custom' for one passed as an object.
    get transition() {
      return this._transitionName;
    }

    // Advances `count` frames in `direction`. Accumulates onto a move already
    // in flight, so three quick clicks advance three frames rather than
    // restarting the same one.
    step(direction = 1, count = 1) {
      if (this._frames.length < 2 || !count) return;
      const delta = Math.sign(direction) * Math.abs(count);
      const from = this._stepTo === null ? Math.round(this._pos) : this._stepTo;
      this._beginStep(from + delta);
    }

    next(count = 1) {
      this.step(1, count);
    }

    prev(count = 1) {
      this.step(-1, count);
    }

    // Goes to `index` by the shortest way around, in a single move rather than
    // one step at a time - a dot five frames away should sweep, not play five
    // separate steps.
    to(index) {
      const n = this._frames.length;
      if (n < 2) return;
      const delta = wrapDelta(mod(index, n) - this._pos, n);
      if (Math.abs(delta) < 0.001) return;
      this._beginStep(this._pos + delta);
    }

    _beginStep(target) {
      this._stepFrom = this._pos;
      this._stepTo = target;
      this._dir = Math.sign(target - this._pos) || this._dir;
      // Stamped on the next tick, off the rAF clock rather than Date.now, so
      // the first frame of the move is measured against the same timebase as
      // every frame after it.
      this._stepStart = null;
      this._nudge = 0;
      this._start();
    }

    // ----- transitions -----

    _setTransition(nameOrObject) {
      const next = typeof nameOrObject === 'object' && nameOrObject
        ? nameOrObject
        : TRANSITIONS[nameOrObject];
      if (!next) {
        if (this._transition) return;
        throw new Error(`Deck: unknown transition "${nameOrObject}"`);
      }

      if (this._transition) {
        if (this._transition.teardown) this._transition.teardown(this._ctx);
        // The outgoing transition's own option names go with it: `arc` means
        // nothing to a cube, and leaving the host's old value in place would
        // make switching back and forth behave differently the second time.
        //
        // Names the *incoming* transition also declares are kept, though.
        // `gap` means the same thing to slide and to stereoscope, so
        // dropping it on the way between them would silently discard a
        // choice the host made explicitly and substitute a default.
        const incoming = next.defaults || {};
        Object.keys(this._transition.defaults || {})
          .filter((key) => !(key in incoming))
          .forEach((key) => { delete this._userOptions[key]; });
        this._resetFrameStyles();
      }

      this._transition = next;
      this._transitionName = typeof nameOrObject === 'string' ? nameOrObject : 'custom';
      this._ctx.state = {};
      this._resolveOptions();
      this.root.setAttribute('data-transition', this._transitionName);
      if (next.setup) next.setup(this._ctx);
      this._measure();
      this._render();
    }

    // Core defaults, then the transition's, then whatever the host set - so a
    // transition can propose but never override an explicit choice.
    _resolveOptions() {
      const merged = {
        ...CORE_DEFAULTS,
        ...(this._transition.defaults || {}),
        ...this._userOptions,
      };
      merged.transition = this._transitionName;
      // Mutated in place rather than replaced, because _ctx.options is a live
      // reference a transition may have closed over.
      Object.keys(this.options).forEach((key) => {
        if (!(key in merged)) delete this.options[key];
      });
      Object.assign(this.options, merged);
    }

    // Everything a transition might have written on a frame, cleared - so the
    // next one starts from a blank element rather than inheriting an opacity or
    // a transform-origin it never set.
    _resetFrameStyles() {
      this._frames.forEach((frame) => {
        frame.style.transform = '';
        frame.style.transformOrigin = '';
        frame.style.opacity = '';
        frame.style.zIndex = '';
        frame.style.visibility = '';
      });
    }

    // ----- chrome -----

    // Creates or removes the injected parts to match the current options, and
    // picks up any lever the host supplied. Idempotent: update() just calls it
    // again.
    _buildChrome() {
      const o = this.options;

      const maskName = MASKS.includes(o.mask) ? o.mask : 'none';
      MASKS.forEach((name) => {
        this.root.classList.toggle(`is-mask-${name}`, name === maskName);
      });
      this.root.classList.toggle('is-masked', maskName !== 'none');
      this.root.classList.toggle('is-clickable', !!o.click);
      this.root.classList.toggle('is-unclipped', o.clip === false);

      // The arrows and dots drive the instance through the same data-deck-*
      // hooks a host would use, so there is not one click listener in here.
      this._arrows = this._arrows || {};
      [['prev', 'Previous frame'], ['next', 'Next frame']].forEach(([dir, label]) => {
        if (o.arrows && !this._arrows[dir]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'deck-arrow';
          button.setAttribute(`data-deck-${dir}`, '');
          button.setAttribute('aria-label', label);
          button.innerHTML = CHEVRON;
          this.root.appendChild(button);
          this._arrows[dir] = button;
        } else if (!o.arrows && this._arrows[dir]) {
          this._arrows[dir].remove();
          this._arrows[dir] = null;
        }
      });

      if (o.dots && !this._dots) {
        this._dots = document.createElement('div');
        this._dots.className = 'deck-dots';
        this.root.appendChild(this._dots);
        this._dotEls = [];
      } else if (!o.dots && this._dots) {
        this._dots.remove();
        this._dots = null;
        this._dotEls = [];
      }

      // A lever the host wrote wins over the built-in one: they asked for that
      // element to be the lever, so drawing a second one over the picture would
      // just be in the way.
      const hostLevers = findHooks(this.root, '[data-deck-lever]');
      hostLevers.forEach((el) => this._bindLever(el));
      if (o.lever && !hostLevers.length && !this._ownLever) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'deck-lever--own';
        button.setAttribute('aria-label', 'Advance one frame');
        const arm = document.createElement('span');
        arm.className = 'deck-lever-arm';
        button.appendChild(arm);
        this.root.appendChild(button);
        this._bindLever(button);
        this._ownLever = button;
      } else if ((!o.lever || hostLevers.length) && this._ownLever) {
        this._unbindLever(this._ownLever);
        this._ownLever.remove();
        this._ownLever = null;
      }

      if (o.glare && !this._glare) {
        this._glare = document.createElement('div');
        this._glare.className = 'deck-glare';
        this._glare.setAttribute('aria-hidden', 'true');
        this.port.appendChild(this._glare);
      } else if (!o.glare && this._glare) {
        this._glare.remove();
        this._glare = null;
      }
    }

    // Takes back everything _buildChrome added - the elements and the classes
    // alike - so destroy() leaves the host's own markup as it found it.
    // Without this the arrows and dots outlive the instance that drives them,
    // and a destroy()/re-init cycle stacks a second set on the first.
    _removeChrome() {
      Object.keys(this._arrows || {}).forEach((dir) => {
        if (this._arrows[dir]) this._arrows[dir].remove();
      });
      this._arrows = {};
      if (this._dots) {
        this._dots.remove();
        this._dots = null;
        this._dotEls = [];
      }
      if (this._ownLever) {
        this._unbindLever(this._ownLever);
        this._ownLever.remove();
        this._ownLever = null;
      }
      if (this._glare) {
        this._glare.remove();
        this._glare = null;
      }
      MASKS.forEach((name) => this.root.classList.remove(`is-mask-${name}`));
      ['is-masked', 'is-clickable', 'is-unclipped', 'is-single', 'is-dragging']
        .forEach((name) => this.root.classList.remove(name));
      this.root.style.removeProperty('--dk-pull');
    }

    // One dot per frame, up to DOTS_MAX. Each is just a `data-deck-to` hook.
    _syncDots() {
      if (!this._dots) return;
      const n = this._frames.length;
      const want = n >= 2 && n <= DOTS_MAX ? n : 0;
      while (this._dotEls.length > want) this._dotEls.pop().remove();
      while (this._dotEls.length < want) {
        const i = this._dotEls.length;
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'deck-dot';
        dot.setAttribute('data-deck-to', String(i));
        dot.setAttribute('aria-label', `Frame ${i + 1}`);
        this._dots.appendChild(dot);
        this._dotEls.push(dot);
      }
      this._dots.hidden = want === 0;
      this._activeDot = -1;
      this._syncActiveDot(this.index);
    }

    _syncActiveDot(index) {
      if (!this._dotEls.length || index === this._activeDot) return;
      this._activeDot = index;
      this._dotEls.forEach((dot, i) => {
        const active = i === index;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    }

    // ----- geometry -----

    _measure() {
      const w = this.port.clientWidth;
      const h = this.port.clientHeight;
      if (w === 0 || h === 0) return;
      this._ctx.w = w;
      this._ctx.h = h;
      if (this._transition.measure) this._transition.measure(this._ctx, this._frames);
    }

    _scrubbable() {
      return this.options.drag && this._transition.scrub !== false;
    }

    // ----- input -----

    _onWheel(event) {
      const mode = this.options.wheel;
      // Anything that isn't one of the two live modes - false, undefined, a
      // typo - is off, rather than half-on.
      if ((mode !== 'x' && mode !== 'any') || this._frames.length < 2) return;
      const horizontal = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
      // In 'x' mode a vertical-dominant scroll is never taken: a deck is a
      // closed loop with no end at which to hand capture back to the page, so a
      // visitor scrolling straight down past it must never find their scroll
      // trapped. 'any' is the deliberate opt-in to that trade.
      if (!horizontal && mode !== 'any') return;
      event.preventDefault();

      const delta = horizontal ? event.deltaX : event.deltaY;
      this._wheelAccum += delta;
      const steps = Math.trunc(this._wheelAccum / WHEEL_STEP);
      if (steps !== 0) {
        this._wheelAccum -= steps * WHEEL_STEP;
        this.step(Math.sign(steps), Math.abs(steps));
      }
    }

    _onPointerDown(event) {
      // Primary button only. A press here is classified as a click on
      // release (see _onPointerUp), so without this a right-click would
      // advance the deck as well as opening the context menu, and a
      // middle-click would advance it instead of doing nothing.
      if (event.button !== 0) return;
      // Let a press that starts on a link or a button inside a frame be a press
      // on that link, not the start of a drag.
      if (event.target.closest('a, button, input, select, textarea, [data-deck-lever]')) return;
      if (this._frames.length < 2) return;
      // The press is tracked even with `drag` off, because a click is just a
      // press that went nowhere - it's the movement that's ignored.
      this._dragging = true;
      this._scrubbing = this._scrubbable();
      this._dragStartX = event.clientX;
      this._dragDx = 0;
      // A press takes over from whatever was in flight: on a scrub the frames
      // have to follow the finger from where they actually are, not from where
      // the move was headed.
      if (this._scrubbing) {
        this._stepTo = null;
        this._stepStart = null;
      }
      this._dragStartPos = this._pos;
      this._samples = [{ t: event.timeStamp, pos: this._pos }];
      global.addEventListener('pointermove', this._onPointerMove);
      global.addEventListener('pointerup', this._onPointerUp);
      global.addEventListener('pointercancel', this._onPointerUp);
      this._start();
    }

    _onPointerMove(event) {
      if (!this._dragging) return;
      this._dragDx = event.clientX - this._dragStartX;
      if (!this.options.drag) return;
      if (Math.abs(this._dragDx) > CLICK_SLOP) this.root.classList.add('is-dragging');
      const width = Math.max(1, this.port.clientWidth);
      // Dragging left advances, so the sign flips.
      const travelled = -this._dragDx / width;

      if (this._scrubbing) {
        const before = this._pos;
        this._pos = this._dragStartPos + travelled;
        if (this._pos !== before) this._dir = Math.sign(this._pos - before);
        this._samples.push({ t: event.timeStamp, pos: this._pos });
        while (this._samples.length > 2
          && event.timeStamp - this._samples[0].t > VELOCITY_WINDOW) {
          this._samples.shift();
        }
      } else {
        // Play, never a scrub: a ratchet transition gives by at most DRAG_PLAY
        // of a step no matter how far the pointer travels.
        this._nudge = clamp(travelled, -DRAG_PLAY, DRAG_PLAY);
      }
      this._start();
    }

    _onPointerUp(event) {
      if (!this._dragging) return;
      const scrubbing = this._scrubbing;
      this._dragging = false;
      this._scrubbing = false;
      this.root.classList.remove('is-dragging');
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);

      const travel = Math.abs(this._dragDx);
      const isClick = travel <= CLICK_SLOP && event.type === 'pointerup';

      if (isClick && this.options.click) {
        // A press that went nowhere is a click. Forward, because that is what a
        // tap on a carousel means everywhere; backward is the left arrow, a
        // swipe, the arrow keys, or shift-click.
        this._nudge = 0;
        if (scrubbing) this._pos = Math.round(this._pos);
        this.step(event.shiftKey ? -1 : 1);
      } else if (scrubbing) {
        this._beginStep(this._settleTarget(event.timeStamp));
      } else if (this.options.drag
        && travel >= Math.max(SWIPE_FLOOR, this.port.clientWidth * SWIPE_FRACTION)) {
        this.step(this._dragDx < 0 ? 1 : -1);
      }
      // Otherwise a ratchet's leftover play is left to decay back in _tick.
      this._start();
    }

    // Where a scrub should come to rest: the nearest frame, unless the release
    // was fast enough to read as a flick, in which case it carries on in the
    // direction it was already going.
    _settleTarget(now) {
      const first = this._samples[0];
      const last = this._samples[this._samples.length - 1];
      const elapsed = (last ? last.t : now) - (first ? first.t : now);
      // Under a frame's worth of samples isn't a measurement, it's noise - two
      // moves delivered in the same millisecond would otherwise read as an
      // enormous velocity and throw the deck across several frames.
      const velocity = elapsed >= VELOCITY_FLOOR ? (last.pos - first.pos) / elapsed : 0;
      if (Math.abs(velocity) < FLICK_VELOCITY) return Math.round(this._pos);
      const direction = Math.sign(velocity);
      const edge = direction > 0 ? Math.ceil(this._pos) : Math.floor(this._pos);
      // A hard flick may carry past the next frame, but only so far - a deck
      // should never spin away from under the finger that threw it.
      const extra = clamp(
        Math.trunc(Math.abs(velocity) / (FLICK_VELOCITY * 6)), 0, FLICK_MAX - 1,
      );
      return edge + direction * extra;
    }

    // ----- the lever -----

    // Wires the pull gesture onto an element, ours or the host's. Safe to call
    // repeatedly on the same element.
    _bindLever(el) {
      if (this._levers.includes(el)) return;
      this._levers.push(el);
      el.addEventListener('pointerdown', this._onLeverDown);
      el.addEventListener('keydown', this._onLeverKey);
      // A host lever is often a div, which gets neither a role nor a tab stop
      // for free.
      if (!el.matches('button, a[href], [role="button"]')) {
        el.setAttribute('role', 'button');
        if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      }
      if (!el.hasAttribute('aria-label') && !el.textContent.trim()) {
        el.setAttribute('aria-label', 'Advance one frame');
      }
    }

    _unbindLever(el) {
      const at = this._levers.indexOf(el);
      if (at !== -1) this._levers.splice(at, 1);
      el.removeEventListener('pointerdown', this._onLeverDown);
      el.removeEventListener('keydown', this._onLeverKey);
      el.style.removeProperty('--dk-pull');
    }

    _onLeverDown(event) {
      if (this._frames.length < 2) return;
      const el = event.currentTarget;
      this._pulling = el;
      this._pullFired = false;
      this._pullStartY = event.clientY;
      el.classList.add('is-pulling');
      try {
        // Keeps the pull alive if the pointer slides off the lever mid-drag.
        // Guarded because a pointer that has already ended - or a synthetic
        // event - throws here, and a throw would leave the lever marked as
        // pulling with none of the listeners below attached to end it.
        el.setPointerCapture(event.pointerId);
      } catch (e) {
        // Not capturable; the pull still works as long as the pointer stays on.
      }
      el.addEventListener('pointermove', this._onPullMove);
      el.addEventListener('pointerup', this._onPullUp);
      el.addEventListener('pointercancel', this._onPullUp);
    }

    _onPullMove(event) {
      if (!this._pulling) return;
      const pull = clamp((event.clientY - this._pullStartY) / LEVER_TRAVEL, 0, 1);
      this._setPull(pull);
      if (pull >= 1 && !this._pullFired) {
        this._pullFired = true;
        this.step(event.shiftKey ? -1 : 1);
      }
    }

    _onPullUp() {
      const el = this._pulling;
      if (!el) return;
      this._pulling = null;
      el.classList.remove('is-pulling');
      el.removeEventListener('pointermove', this._onPullMove);
      el.removeEventListener('pointerup', this._onPullUp);
      el.removeEventListener('pointercancel', this._onPullUp);
      this._setPull(0);
      // `_pullFired` is deliberately left standing: the browser dispatches a
      // click after this pointerup, and _flickLever is what consumes the
      // flag so that click doesn't advance a second frame. It can't go stale
      // either - _onLeverDown clears it at the start of every gesture, so a
      // pull that fired without producing a click (released off the lever,
      // or cancelled) is reset by the next press rather than swallowing it.
    }

    // The click path. A tap on the lever (rather than a pull) advances, and
    // swings the arm, so the deck never moves without the lever appearing to
    // move it - but the trailing click of a pull that already fired is
    // swallowed here instead.
    _flickLever(backward = false) {
      if (this._pullFired) {
        this._pullFired = false;
        return;
      }
      this._advanceLever(backward);
    }

    // Advance plus the arm's return swing, with no click suppression. Shared
    // by the tap and keyboard paths.
    _advanceLever(backward) {
      this.step(backward ? -1 : 1);
      if (!this._levers.length) return;
      this._setPull(1);
      clearTimeout(this._pullReturnTimer);
      this._pullReturnTimer = setTimeout(() => this._setPull(0), 110);
    }

    _onLeverKey(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      // Straight to _advanceLever, skipping the click suppression: a key
      // press can never be the trailing click of a pointer pull, so there is
      // nothing to swallow and consulting the flag could only drop a real
      // activation.
      this._advanceLever(event.shiftKey);
    }

    // Published on the root *and* on each lever element, because a lever of
    // your own is often a sibling of the deck rather than a child of it, and
    // would inherit nothing from the root.
    _setPull(pull) {
      const value = `${(pull * LEVER_SWING).toFixed(2)}deg`;
      this.root.style.setProperty('--dk-pull', value);
      this._levers.forEach((el) => el.style.setProperty('--dk-pull', value));
    }

    _onKeyDown(event) {
      if (event.target.closest('[data-deck-lever], .deck-lever--own')) return;
      // A frame can hold anything, text fields included, and moving the
      // deck out from under a caret is not what the arrow keys (or Home
      // and End) mean there.
      if (ownsArrowKeys(event.target)) return;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          this.step(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          this.step(-1);
          break;
        case 'Home':
          event.preventDefault();
          this.to(0);
          break;
        case 'End':
          event.preventDefault();
          this.to(this._frames.length - 1);
          break;
        default:
      }
    }

    _onEnter() {
      this._hovering = true;
    }

    _onLeave() {
      this._hovering = false;
    }

    _onVisibility() {
      this._syncAuto();
    }

    _syncAuto() {
      clearInterval(this._autoTimer);
      this._autoTimer = null;
      const every = this.options.autoplay;
      if (!every || every <= 0 || this._frames.length < 2 || this._prefersReduced()) return;
      this._autoTimer = setInterval(() => {
        // Skipping a beat rather than tearing the timer down keeps the cadence
        // steady across a hover that starts and ends mid-interval.
        if (!this._onScreen || this._hovering || document.hidden) return;
        if (this.root.contains(document.activeElement)) return;
        if (this._stepTo !== null || this._dragging) return;
        this.step(1);
      }, Math.max(200, every));
    }

    // ----- loop -----

    _prefersReduced() {
      return !!(this._reduced && this._reduced.matches);
    }

    _needsLoop() {
      return this._stepTo !== null
        || this._dragging
        || Math.abs(this._nudge) > 0.0005;
    }

    _start() {
      if (this._raf || !this._onScreen || !this._needsLoop()) return;
      this._raf = requestAnimationFrame(this._tick);
    }

    _stop() {
      if (!this._raf) return;
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    _tick(now) {
      const reduced = this._prefersReduced();

      if (this._stepTo !== null) {
        if (this._stepStart === null) {
          this._stepStart = now;
          this._stepMs = reduced ? 1 : this._durationFor(Math.abs(this._stepTo - this._stepFrom));
        }
        const t = clamp((now - this._stepStart) / this._stepMs, 0, 1);
        const eased = reduced ? t : easeOutBack(t, Math.max(0, this.options.bounce) * 2.2);
        this._pos = this._stepFrom + (this._stepTo - this._stepFrom) * eased;
        if (t >= 1) this._endStep();
      } else if (!this._dragging && this._nudge !== 0) {
        this._nudge *= SLACK_DECAY;
        if (Math.abs(this._nudge) < 0.0005) this._nudge = 0;
      }

      this._render();

      this._raf = this._needsLoop() ? requestAnimationFrame(this._tick) : null;
    }

    // One frame of travel takes `duration`; a sweep across several takes more
    // but not proportionally more; a scrub settling a fraction of a frame takes
    // proportionally less, with a floor so it never reads as a jump cut.
    _durationFor(frames) {
      const base = Math.max(1, this.options.duration);
      if (frames <= 1) return base * Math.max(SETTLE_FLOOR, frames);
      return base * Math.min(JUMP_CAP, 1 + JUMP_GROWTH * (frames - 1));
    }

    _endStep() {
      const n = this._frames.length;
      this._pos = n > 0 ? mod(this._stepTo, n) : 0;
      this._stepTo = null;
      this._stepStart = null;
      this._dir = 0;
      if (n > 0) this._setSettledIndex(mod(Math.round(this._pos), n));
    }

    _render() {
      const n = this._frames.length;
      if (n === 0) return;
      const pos = this._pos + this._nudge;
      const cull = this._transition.cull || CULL_DISTANCE;
      const style = this._transition.style;

      this._ctx.dir = this._dir;

      // Nothing inside a frame is interactive unless the deck is at rest on it:
      // a link half way out isn't a link anyone meant to click, and the ones
      // fully out are off screen, so leaving them focusable would put several
      // invisible copies of the same tab stop in the page.
      const atRest = this._stepTo === null
        && !this._dragging
        && Math.abs(this._nudge) < 0.02;
      const rounded = mod(Math.round(pos), n);
      const activeIndex = atRest ? rounded : -1;

      this._frames.forEach((frame, i) => {
        const delta = wrapDelta(i - pos, n);
        const hidden = Math.abs(delta) > cull;
        frame.style.visibility = hidden ? 'hidden' : '';
        if (!hidden) {
          // Reset the two properties a transition may or may not set, so that
          // switching between them mid-flight can't leave a stale value behind.
          frame.style.opacity = '';
          frame.style.zIndex = String(100 - Math.round(Math.abs(delta) * 20));
          style(frame, delta, this._ctx);
        }
        const inert = i !== activeIndex;
        if (frame.__dkInert !== inert) {
          frame.__dkInert = inert;
          frame.inert = inert;
          frame.style.pointerEvents = inert ? 'none' : '';
        }
      });

      this._syncActiveDot(rounded);
    }

    // ----- settle / persistence -----

    _setSettledIndex(index) {
      if (index === this._settledIndex) return;
      this._settledIndex = index;
      this._memory.write(index);
      const frame = this._frames[index];
      if (frame) frame.dispatchEvent(new CustomEvent('deck-settle', { bubbles: true }));
    }

    destroy() {
      this._stop();
      if (this._transition && this._transition.teardown) this._transition.teardown(this._ctx);
      this._intersectionObserver.disconnect();
      this._resizeObserver.disconnect();
      clearInterval(this._autoTimer);
      clearTimeout(this._pullReturnTimer);
      if (this._reduced && this._reduced.removeEventListener) {
        this._reduced.removeEventListener('change', this._onReducedChange);
      }
      this.port.removeEventListener('wheel', this._onWheel);
      this.port.removeEventListener('pointerdown', this._onPointerDown);
      this.root.removeEventListener('keydown', this._onKeyDown);
      this.root.removeEventListener('pointerenter', this._onEnter);
      this.root.removeEventListener('pointerleave', this._onLeave);
      document.removeEventListener('visibilitychange', this._onVisibility);
      global.removeEventListener('pointermove', this._onPointerMove);
      global.removeEventListener('pointerup', this._onPointerUp);
      global.removeEventListener('pointercancel', this._onPointerUp);
      this._levers.slice().forEach((el) => this._unbindLever(el));
      this._removeChrome();
      // _resetFrameStyles covers transform/origin/opacity/z-index/visibility;
      // the inert flag and its bookkeeping are the core's own, not a
      // transition's, so they're cleared here.
      this._resetFrameStyles();
      this._frames.forEach((frame) => {
        frame.inert = false;
        frame.style.pointerEvents = '';
        delete frame.__dkInert;
      });
    }
  }

  // Standard easeOutBack. Its derivative at t = 0 is 3 + c, so a move leaves at
  // several times its own average speed and decelerates into the stop.
  function easeOutBack(t, c) {
    if (t >= 1) return 1;
    const p = t - 1;
    return 1 + (c + 1) * p * p * p + c * p * p;
  }

  // ----- declarative hooks -----

  // Which deck an element drives: whatever `data-deck-for` on it or an ancestor
  // points at, else the deck it sits inside.
  function resolveRoot(el) {
    const scoped = el.closest('[data-deck-for]');
    if (scoped) {
      const selector = scoped.getAttribute('data-deck-for');
      return selector ? document.querySelector(selector) : null;
    }
    return el.closest('.deck');
  }

  function findHooks(root, selector) {
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => resolveRoot(el) === root);
  }

  let hooksInstalled = false;

  // One delegated listener for every `data-deck-next` / `data-deck-prev` /
  // `data-deck-to` on the page, however many decks there are and whenever the
  // elements appear - which is also how the injected arrows and dots work, so
  // the built-in controls use exactly the API a host does.
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    document.addEventListener('click', (event) => {
      const hook = event.target.closest('[data-deck-next], [data-deck-prev], [data-deck-to]');
      if (!hook) return;
      const instance = Deck.get(resolveRoot(hook));
      if (!instance) return;
      if (hook.tagName === 'A') event.preventDefault();
      if (hook.hasAttribute('data-deck-to')) {
        const index = parseInt(hook.getAttribute('data-deck-to'), 10);
        instance.to(Number.isFinite(index) ? index : 0);
      } else if (hook.hasAttribute('data-deck-prev')) {
        instance.prev();
      } else {
        instance.next();
      }
    });
    // A lever is a gesture, not a click, so it binds per element rather than by
    // delegation - but a click on one still has to advance the deck.
    document.addEventListener('click', (event) => {
      const lever = event.target.closest('[data-deck-lever], .deck-lever--own');
      if (!lever) return;
      const instance = Deck.get(resolveRoot(lever));
      if (!instance) return;
      instance._flickLever(event.shiftKey);
    });
  }

  Deck.transitions = TRANSITIONS;
  Deck.DEFAULTS = CORE_DEFAULTS;

  global.Deck = Deck;

  registerEffect(Deck, {
    slug: 'deck',
    selector: '.deck:not(.is-empty)',
    prepare: () => {
      injectStyles();
      installHooks();
    },
  });
})(window);
