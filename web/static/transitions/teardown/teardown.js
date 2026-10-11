/**
 * Teardown
 * --------
 * The page takes itself apart: every element flies off the screen, the
 * background goes last, and what's left is a blank page. Once whatever
 * it's covering is ready, the reveal runs it the other way: the next page
 * starts blank with all of its own pieces waiting off-screen, and they fly
 * in and land, so the page builds itself. One continuous cover/reveal
 * motion split across the cover/reveal boundary, same shape as Shutter,
 * Aperture, Static, Inkblot and Power Off.
 *
 * Unlike those, nothing is drawn over the page. The pieces are the page's
 * own elements, moved with the individual `translate`/`rotate`/`scale`
 * properties, added on top of any the element already has (and any
 * `transform` still applies too). Nothing is written to a piece until it
 * starts to move, and everything is put back exactly as it was once a
 * reveal lands. The blank page is the only thing a cover leaves on
 * screen, so the fully covered frame is always just `color`, and the next
 * page picks up from it exactly with nothing but the profile (and where
 * the click was) in the handoff.
 *
 * Splitting the page into pieces is a walk down from the target, choosing
 * at every element whether it flies as one piece or gets split into its
 * children. `grouping` sets how far down that goes ('sections', 'cards',
 * 'pieces', 'words'), and any element can overrule it with
 * `data-teardown="group"` (always one piece), `"split"` (always break it
 * apart, down to words for text) or `"keep"` (never moves). A container
 * that gets split still has its own background, border and shadow, which
 * can't move without its children, so a stand-in for just that chrome (a
 * "ghost") is put behind the content and flies on its own, leaving after
 * the last of its contents and landing before the first.
 *
 * Two ways to use it:
 *
 * 1. Navigation — drop `<script src="teardown.js"></script>` in `<head>`
 *    (a plain, non-async/defer tag) on every page that should take part.
 *    Off by default: nothing is intercepted until you set `selector` (see
 *    Options in the docs). Once enabled, it listens for clicks on the
 *    whole document and intercepts any matching same-origin link (opt a
 *    link out with `data-no-transition`). The cover/reveal only ever plays
 *    across a navigation it intercepted itself: a direct load, refresh, or
 *    bookmark visit renders normally, and a destination page that doesn't
 *    also load this script just appears once the exit cover finishes, with
 *    no build-in of its own. If the page is still here a few seconds
 *    later (a download, a 204, a cancelled "leave this page?"), it builds
 *    itself back.
 *
 * 2. Elements — mark any element `class="t-el"` and call
 *    `Transitions.teardown.play(el, { swap })` to fly its contents out,
 *    run `swap(el)` once it's empty, then fly the new contents in.
 *    `cover(el)`/`reveal(el)` are also public on their own. The element
 *    itself stays put as the stage, and its contents are clipped to it.
 *
 * Coexists with other transition effects on the same page: its public API
 * lives at `window.Transitions.teardown` and its config reads from
 * `window.TransitionConfig.teardown`, so neither clobbers another effect's.
 *
 * A single call can override any option for just that one transition: a
 * link's `data-t-*` attributes for navigation (see datasetToOverrides), or
 * the same fields passed straight into `cover`/`reveal`/`play` for
 * elements, plus `from` (the click event, or an element) to say where
 * 'origin' is; a clicked link supplies that itself.
 */
(function (global, document) {
  var NAME = 'teardown';
  global.Transitions = global.Transitions || {};
  if (global.Transitions[NAME]) return;

  var STYLE_ID = 't-teardown-styles';
  var ARRIVE_STYLE_ID = 't-teardown-arriving';
  var PENDING_KEY = 't-teardown-pending';
  // ms. A handoff only counts if the next page's navigation started within
  // this long of the cover finishing, however long the server then takes
  // to answer; anything older is from an old, unrelated navigation.
  var PENDING_TTL = 10000;
  // ms. If the page is still here this long after it set off, the link
  // didn't replace it (a download, a 204, a cancelled "leave this page?").
  var STAY_WAIT = 4000;
  // Marks this script puts on the page's own elements: one that stays put
  // inside an element target, and one added by the page mid-transition.
  var KEPT_ATTR = 'data-t-teardown-kept';
  var LATE_ATTR = 'data-t-teardown-late';
  var root = document.documentElement;

  // How far past the edge every piece travels, so a drop shadow or a
  // rotated corner is fully gone too, not resting on the edge.
  var MARGIN = 32;
  // With grouping 'sections', anything smaller than this share of the
  // target's area flies as one piece; anything bigger is split.
  var SECTION_AREA = 0.35;
  // With grouping 'cards', a surface bigger than this share of the target
  // is a page wrapper (an app shell with a background, a white <main>),
  // not a card, and is split like any other wrapper.
  var CARD_AREA = 0.5;
  // 'words' wraps every word in its own span. Past this many, the rest of
  // the text blocks fly whole, so a long page doesn't stall on the wrap.
  var MAX_WORDS = 800;
  // The longest stagger allowed: past this, the last piece would get too
  // little of the duration to fly anywhere.
  var MAX_STAGGER = 0.9;
  // An arriving page waits up to this long for the images and fonts it
  // shows first, so they land with everything else instead of popping in
  // (or shoving the layout around) partway through.
  var ASSET_WAIT = 1000;
  // ...and up to this long for a `ready` hook of its own.
  var READY_WAIT = 5000;
  // If an arriving page still hasn't started building by now, something
  // went wrong; show it as it is rather than leave it blank.
  var ARRIVAL_FAILSAFE = 10000;

  var MOTIONS = ['slide', 'tumble', 'throw', 'spiral'];
  var DIRECTIONS = ['origin', 'center', 'edge', 'up', 'down', 'left', 'right', 'random'];
  var ORDERS = ['origin', 'reading', 'reverse', 'random'];
  var GROUPINGS = ['sections', 'cards', 'pieces', 'words'];
  var BACKGROUNDS = ['fly', 'fade', 'stay'];

  var DEFAULTS = {
    duration: 1400, // ms for each half (tear down or build up) of the motion
    easing: 'ease-in', // the shape of each piece's flight (see easingFn)
    motion: 'tumble', // how each piece flies: 'slide', 'tumble', 'throw', 'spiral'
    direction: 'origin', // which way: 'origin', 'center', 'edge', 'up', 'down', 'left', 'right', 'random'
    order: 'origin', // which pieces go first: 'origin', 'reading', 'reverse', 'random'
    stagger: 0.6, // 0–0.9: how much of the duration the start times are spread over (0 = all at once)
    grouping: 'cards', // how finely the page breaks apart: 'sections', 'cards', 'pieces', 'words'
    background: 'fly', // the page background: 'fly' (last piece out), 'fade', or 'stay'
    color: '#fff', // the blank page left behind
    spin: 0.5, // 0–1: how much the pieces rotate in flight
    fade: 0, // 0–1: how much the pieces fade out as they go
    scale: 1, // how big the pieces are by the time they're gone (1 = unchanged)
    keep: null, // a selector for anything that stays put (same as marking it data-teardown="keep")
    selector: null, // which links this page intercepts — off until set
    ready: null, // optional function returning a promise: an arriving page waits for it before building
  };
  var pageConfig = (global.TransitionConfig && global.TransitionConfig[NAME]) || {};
  var options = Object.assign({}, DEFAULTS, pageConfig);

  // Never pieces: nothing to see, or not ours to move.
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1, HEAD: 1, BASE: 1 };
  // Replaced elements: their insides aren't elements that could fly on
  // their own, so they're always one piece. They can take a transform even
  // while inline, so one sitting in a line of text doesn't stop it being
  // split into words around it.
  var REPLACED_TAGS = {
    IMG: 1, SVG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1,
    BUTTON: 1, OBJECT: 1, EMBED: 1, METER: 1, PROGRESS: 1,
  };
  // One piece unless marked data-teardown="split": splitting them would
  // break their layout.
  var WHOLE_TAGS = { TABLE: 1, PICTURE: 1, HR: 1 };

  // Whitespace that CSS can wrap at. Not \s: a no-break space has to stay
  // inside its word, or 'words' would add a line break the page didn't
  // have.
  var WRAP_SPACE = /([ \t\n\r\f]+)/;
  // Scripts written without spaces between words. 'words' breaks these up
  // with Intl.Segmenter, so they still wrap mid-line (without it, each run
  // stays whole).
  var UNSPACED = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u0E00-\u0E7F]/;
  // Right-to-left scripts. Each word made into its own box loses its place
  // in the bidi ordering, so text with these flies as whole blocks.
  var RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

  // --- Easing. Each piece's flight is shaped by it in space, not time:
  // the curve maps how far through its flight a piece is to how far along
  // its path it's got. So the same curve that has a piece pull away slowly
  // and accelerate off the edge (ease-in) has a piece arriving on the next
  // page decelerate into its place, with no mirroring needed. Keywords plus
  // any cubic-bezier(), including ones that overshoot. ---
  var EASING_KEYWORDS = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  function cubicBezier(x1, y1, x2, y2) {
    function at(a, b, t) {
      return 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
    }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      // x(t) is monotonic for valid control points, so bisection always
      // converges; 20 steps is well past what a frame can show.
      var lo = 0;
      var hi = 1;
      for (var i = 0; i < 20; i++) {
        var mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < x) lo = mid; else hi = mid;
      }
      return at(y1, y2, (lo + hi) / 2);
    };
  }
  var easingCache = {};
  function easingFn(easing) {
    var key = String(easing || '').trim();
    if (easingCache[key]) return easingCache[key];
    var points = EASING_KEYWORDS[key];
    var m = /^cubic-bezier\(\s*([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(key);
    if (m) {
      var parsed = m.slice(1).map(Number);
      // x outside 0–1 isn't a valid curve (time can't run backward).
      if (parsed.every(isFinite)) points = [clamp(parsed[0], 0, 1), parsed[1], clamp(parsed[2], 0, 1), parsed[3]];
    }
    if (!points) points = EASING_KEYWORDS['ease-in'];
    easingCache[key] = cubicBezier(points[0], points[1], points[2], points[3]);
    return easingCache[key];
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      // Required host class for any element target: gives the ghost layer
      // a positioning context.
      '.t-el{position:relative;}' +
      // An element target is the stage. `isolation` makes it its own
      // stacking context, so the ghost layer's negative z-index sits above
      // the stage's own background instead of sinking behind the page's,
      // and below anything inside with a negative z-index of its own.
      '.t-teardown-stage{isolation:isolate;}' +
      // Ghosts and the background sheet: behind every piece of content.
      '.t-teardown-layer{position:absolute;left:0;top:0;z-index:-2147483647;pointer-events:none;}' +
      '.t-teardown-layer--root{position:fixed;}' +
      '.t-teardown-ghost{position:absolute;box-sizing:border-box;margin:0;visibility:visible;}' +
      '.t-teardown-frame{overflow:hidden;}' +
      '.t-teardown-frame>div{position:absolute;}' +
      // A stage that's been emptied and is holding there. Hides anything a
      // swap() puts in before the reveal collects it, so new content never
      // shows at rest before it's flown in, but not what's being kept.
      // `:where` keeps the kept rule from beating the page's own: anything
      // the page itself hides stays hidden.
      '.t-teardown-covered :not(.t-teardown-layer,.t-teardown-layer *,[' + KEPT_ATTR + '],[' + KEPT_ATTR + '] *)' +
      '{visibility:hidden!important;}' +
      ':where(.t-teardown-covered [' + KEPT_ATTR + ']){visibility:visible;}' +
      // Anything the page adds mid-transition (see watchAdditions).
      '[' + LATE_ATTR + ']{visibility:hidden!important;}' +
      // Takes the pointer during a page-level transition: the pieces were
      // measured where they sat, so nothing can be hovered or clicked.
      '.t-teardown-shield{position:fixed;inset:0;z-index:2147483647;}' +
      // Text inside a target, and words for grouping 'words', get wrapped
      // so there's a box to move. Inline boxes can't take a transform;
      // inline-block ones can.
      '.t-teardown-text{display:inline-block;}' +
      // ::before/::after of a split container can't be moved or copied, so
      // they fade out with its ghost instead, from their own opacity.
      '.t-teardown-bare::before{opacity:var(--t-teardown-before)!important;transition:none!important;}' +
      '.t-teardown-bare::after{opacity:var(--t-teardown-after)!important;transition:none!important;}' +
      // A modal dialog or popover that's flown off takes its backdrop with
      // it.
      '.t-teardown-gone::backdrop{opacity:0!important;}';
    document.head.appendChild(style);
  }

  // --- Saving and restoring inline styles. Everything this script writes
  // onto the page's own elements goes through here first, so cleanup puts
  // back exactly what was there before, including an inline style the page
  // had set itself. Only longhands are ever written, so nothing the page
  // set inline is lost by writing a shorthand over it. A store maps each
  // element to the values it had before this script first wrote them, and
  // what it last wrote: anything the page itself has changed since (a
  // fade-in finishing mid-flight) is left as the page set it. ---
  function stash(store, el, props) {
    var saved = store.get(el);
    if (!saved) {
      // Whether it had a style attribute at all, so one isn't left behind
      // empty.
      saved = { '': [el.hasAttribute('style')] };
      store.set(el, saved);
    }
    props.forEach(function (p) {
      if (!(p in saved)) saved[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    });
  }
  function setStyle(store, el, prop, value, normal) {
    var saved = store.get(el);
    var v = saved && saved[prop];
    // Written by the page since this script last wrote it: that's now the
    // value to go back to.
    if (v && v.length > 2 && el.style.getPropertyValue(prop) !== v[2]) {
      v[0] = el.style.getPropertyValue(prop);
      v[1] = el.style.getPropertyPriority(prop);
    }
    stash(store, el, [prop]);
    el.style.setProperty(prop, value, normal ? '' : 'important');
    store.get(el)[prop][2] = el.style.getPropertyValue(prop);
  }
  function putBack(el, prop, v) {
    if (v.length > 2 && el.style.getPropertyValue(prop) !== v[2]) return;
    if (v[0]) el.style.setProperty(prop, v[0], v[1]);
    else el.style.removeProperty(prop);
  }
  function unstashProps(store, el, props) {
    var saved = store.get(el);
    if (!saved) return;
    props.forEach(function (p) {
      if (p in saved) putBack(el, p, saved[p]);
    });
  }
  function tidy(el, saved) {
    if (!saved[''][0] && el.getAttribute('style') === '') el.removeAttribute('style');
  }
  // Puts everything back. The page's own transitions are restored last,
  // after a style flush, or every background, border and position going
  // back in the same change would animate there instead of just being
  // there. `then` runs after that flush too.
  function unstash(store, then) {
    var late = [];
    store.forEach(function (saved, el) {
      Object.keys(saved).forEach(function (p) {
        if (p === 'transition-property') late.push([el, saved]);
        else if (p) putBack(el, p, saved[p]);
      });
      if (!('transition-property' in saved)) tidy(el, saved);
    });
    store.clear();
    if (!late.length && !then) return;
    void root.offsetWidth;
    if (then) then();
    late.forEach(function (entry) {
      putBack(entry[0], 'transition-property', entry[1]['transition-property']);
      tidy(entry[0], entry[1]);
    });
  }

  // --- Reading the page. ---

  // True when a computed color has zero alpha. Only the alpha channel
  // counts: rgba(0, 0, 0, 0) or color(... / 0) is transparent, but plain
  // rgb(0, 0, 0) — black — must not be read as one.
  function isTransparent(color) {
    if (!color || color === 'transparent') return true;
    var slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
    if (slash) return parseFloat(slash[1]) === 0;
    var rgba = /^rgba\(([^)]*)\)$/.exec(color);
    if (rgba) {
      var parts = rgba[1].split(',');
      return parts.length === 4 && parseFloat(parts[3]) === 0;
    }
    return false;
  }

  function isSet(value) {
    return !!value && value !== 'none';
  }

  function visibleBorder(cs) {
    return ['Top', 'Right', 'Bottom', 'Left'].some(function (side) {
      var style = cs['border' + side + 'Style'];
      return parseFloat(cs['border' + side + 'Width']) > 0 && style !== 'none' && style !== 'hidden' &&
        !isTransparent(cs['border' + side + 'Color']);
    });
  }

  function paintsBackground(cs) {
    return cs.backgroundImage !== 'none' || !isTransparent(cs.backgroundColor);
  }

  // A box's own chrome, apart from its background and pseudo-elements.
  function hasFrame(cs) {
    return cs.boxShadow !== 'none' || visibleBorder(cs) || isSet(cs.borderImageSource) ||
      (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !isTransparent(cs.outlineColor)) ||
      isSet(cs.backdropFilter) || isSet(cs.webkitBackdropFilter);
  }

  function pseudoStyle(el, which) {
    var ps = getComputedStyle(el, which);
    return ps.content && ps.content !== 'none' && ps.content !== 'normal' && ps.display !== 'none' ? ps : null;
  }

  // Anything of an element's own that would be left floating on the page
  // if only its children flew: a background, a border, a shadow, an
  // outline, a frosted backdrop, or a ::before/::after.
  function hasChrome(el, cs) {
    return paintsBackground(cs) || hasFrame(cs) || !!pseudoStyle(el, '::before') || !!pseudoStyle(el, '::after');
  }

  // 'cards' keeps these whole: anything with chrome, plus links and
  // buttons, which read as one thing even when they're bare.
  function isSurface(el, cs) {
    if (el.tagName === 'A' && el.hasAttribute('href')) return true;
    if (el.getAttribute('role') === 'button') return true;
    return hasChrome(el, cs);
  }

  // Text straight inside a flex or grid container is one anonymous item;
  // split into words, every word would become an item of its own, losing
  // the spaces between them and picking up the container's gap.
  function laysOutItems(cs) {
    return /flex|grid/.test(cs.display);
  }

  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    }
    return false;
  }

  function isReplaced(el) {
    return !!REPLACED_TAGS[el.tagName.toUpperCase()] || el.isContentEditable;
  }

  // Ours: never a piece, and never hidden as something the page added.
  function isOurs(el) {
    return /(^|\s)t-teardown-(layer|shield|text)/.test(el.getAttribute('class') || '');
  }

  // A block of text: it holds text of its own, or inline elements, which
  // can't take a transform without changing how the text wraps. It flies
  // whole, unless it's split into words.
  function holdsInline(el) {
    if (hasOwnText(el)) return true;
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (SKIP_TAGS[child.tagName.toUpperCase()] || isReplaced(child)) continue;
      if (getComputedStyle(child).display === 'inline') return true;
    }
    return false;
  }

  // Any rotation or skew of the element's own: its ghost would be drawn
  // straight.
  function isTurned(cs) {
    if (isSet(cs.rotate) && !/^0(deg|rad|turn|grad)?$/.test(cs.rotate)) return true;
    var t = cs.transform;
    if (!isSet(t)) return false;
    var m = /^matrix\(([^)]+)\)$/.exec(t);
    if (!m) return true;
    var v = m[1].split(',').map(parseFloat);
    return Math.abs(v[1]) > 1e-6 || Math.abs(v[2]) > 1e-6;
  }

  // Containers that fly whole unless marked data-teardown="split": their
  // look can't be rebuilt from a ghost, or their contents aren't ours to
  // reach. A shadow root's contents can't be walked (and a registered
  // custom element may have a closed one), a clip, mask or text-clipped
  // gradient would be lost, a rotated box's ghost would be straight, an
  // overlay's ghost would sink behind what it overlays, and list bullets
  // and column rules have no box to move.
  function isUnsplittable(el, cs) {
    if (WHOLE_TAGS[el.tagName.toUpperCase()]) return true;
    if (el.shadowRoot) return true;
    if (el.localName.indexOf('-') !== -1 && global.customElements && global.customElements.get(el.localName)) return true;
    if (isSet(cs.clipPath) || isSet(cs.maskImage) || isSet(cs.webkitMaskImage)) return true;
    if (/text/.test(cs.backgroundClip) || /text/.test(cs.webkitBackgroundClip || '')) return true;
    if (isTurned(cs)) return true;
    // Fixed, sticky or absolutely positioned with a z-index: it sits over
    // other content, and its ghost would drop behind that.
    if (cs.position !== 'static' && cs.position !== 'relative' && cs.zIndex !== 'auto') return true;
    if (hasMarker(cs)) return true;
    if (cs.columnRuleStyle !== 'none' && parseFloat(cs.columnRuleWidth) > 0 &&
      (cs.columnCount !== 'auto' || cs.columnWidth !== 'auto')) return true;
    return false;
  }

  // Clips its own contents: anything flying out of it would vanish at its
  // edge instead of crossing the screen.
  function clips(cs) {
    return cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  }

  // Text cut short with an ellipsis or a line clamp: split into words, the
  // ellipsis would go and the hidden lines could show.
  function isTruncated(cs) {
    return (isSet(cs.webkitLineClamp) && cs.webkitLineClamp !== 'none') ||
      (!!cs.textOverflow && cs.textOverflow !== 'clip');
  }

  // A background fixed to the viewport (parallax). An element can't move
  // and keep it fixed, so it's never flown whole: its ghost carries the
  // background instead (see makeGhost).
  function hasFixedBackground(cs) {
    return cs.backgroundImage !== 'none' && /fixed/.test(cs.backgroundAttachment);
  }

  // Something inside blends with what's behind it (mix-blend-mode). Flown
  // as part of a bigger piece, it would only blend with what's inside that
  // piece; split out as a piece of its own, it keeps blending with the
  // page. Only whole pieces are checked, and their insides aren't
  // otherwise visited, so each element is read at most once.
  function holdsBlend(el) {
    var all = el.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (getComputedStyle(all[i]).mixBlendMode !== 'normal') return true;
    }
    return false;
  }

  // A list bullet or number (or a <summary>'s triangle): it belongs to the
  // element's own box, so it only moves when the whole element does.
  function hasMarker(cs) {
    return cs.display === 'list-item' && (cs.listStyleType !== 'none' || isSet(cs.listStyleImage));
  }

  // An underline, overline or strike-through. It's drawn by the element
  // the line is set on, under all of its text, and a word made into a box
  // of its own doesn't get it: split, the words would fly off bare and
  // the line under the spaces between them would stay.
  function isDecorated(cs) {
    return isSet(cs.textDecorationLine) || isSet(cs.webkitTextDecorationsInEffect);
  }

  // A drop cap or a styled first line only applies while the text is
  // plain; split into words, it would be lost.
  function styledFirst(el, cs) {
    return ['::first-letter', '::first-line'].some(function (which) {
      var ps = getComputedStyle(el, which);
      return (which === '::first-letter' && ps.getPropertyValue('float') !== 'none') ||
        ['fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'color', 'textTransform', 'letterSpacing'].some(function (k) {
          return ps[k] !== cs[k];
        });
    });
  }

  function isRootTarget(el) {
    return el === root;
  }

  // The target's geometry: its padding box on screen, and K, how many
  // screen px one of its own px is (less than 1 inside something scaled
  // down, like the homepage's carousel cards). Everything below works in
  // the target's own px ("stage units"), so the motion is right however
  // the target is scaled.
  function stageGeometry(el) {
    if (isRootTarget(el)) {
      return { left: 0, top: 0, K: 1, W: global.innerWidth, H: global.innerHeight };
    }
    var rect = el.getBoundingClientRect();
    var K = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    return {
      left: rect.left + el.clientLeft * K,
      top: rect.top + el.clientTop * K,
      K: K || 1,
      W: el.clientWidth,
      H: el.clientHeight,
    };
  }

  // Screen px per px of el's own, from the nearest ancestor-or-self with
  // a box.
  function scaleOf(el) {
    for (var p = el; p && p !== root; p = p.parentElement) {
      if (p.offsetWidth) return p.getBoundingClientRect().width / p.offsetWidth || 1;
    }
    return 1;
  }

  // Turns a `from` (a click event, an element, or { x, y, element? } in
  // viewport px) into a point in stage units, or null. Keyboard-triggered
  // clicks report 0,0, so they start from the element's center instead.
  function resolveOrigin(el, from) {
    if (!from) return null;
    var point = null;
    var source = null;
    if (from.nodeType === 1) {
      source = from;
    } else {
      var isEvent = typeof global.Event === 'function' && from instanceof global.Event;
      if (from.element && from.element.nodeType === 1) source = from.element;
      else if (isEvent && from.currentTarget && from.currentTarget.nodeType === 1) source = from.currentTarget;
      var x = isEvent ? from.clientX : from.x;
      var y = isEvent ? from.clientY : from.y;
      var keyboard = isEvent && from.detail === 0 && x === 0 && y === 0;
      if (isFinite(x) && isFinite(y) && !keyboard) point = { x: x, y: y };
    }
    if (!point && source) {
      var box = source.getBoundingClientRect();
      point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    if (!point) return null;
    var g = stageGeometry(el);
    return { x: (point.x - g.left) / g.K, y: (point.y - g.top) / g.K };
  }

  // --- Collecting the pieces, in passes, so the page is never read
  // halfway through being written to: pass 1 walks the tree and decides,
  // only reading; pass 2 makes the structural changes those decisions
  // need (wrapping text, making inline pieces inline-block, hiding what's
  // off-screen); pass 3 measures everything; pass 4 writes. ---

  var segmenter;
  // Splits text into words and the whitespace between them, the
  // whitespace kept as is. A hyphenated word is split after each hyphen
  // too, where the browser could break the line, since a word made into a
  // box of its own can't break inside.
  function tokens(text) {
    var out = [];
    text.split(WRAP_SPACE).forEach(function (part) {
      if (!part) return;
      if (WRAP_SPACE.test(part)) {
        out.push(part);
        return;
      }
      if (!UNSPACED.test(part)) {
        part.replace(/([^-\u2010\u00AD][-\u2010\u00AD]+)(?=[A-Za-z\u00C0-\u024F])/g, '$1\u0000').split('\u0000').forEach(function (w) {
          if (w) out.push(w);
        });
        return;
      }
      if (segmenter === undefined) {
        try {
          segmenter = global.Intl && global.Intl.Segmenter ? new global.Intl.Segmenter(undefined, { granularity: 'word' }) : null;
        } catch (e) {
          segmenter = null;
        }
      }
      // Without a segmenter, the run stays whole: splitting it per
      // character would pull apart emoji and combining marks.
      if (segmenter) {
        Array.from(segmenter.segment(part), function (s) { return s.segment; }).forEach(function (s) { out.push(s); });
      } else {
        out.push(part);
      }
    });
    return out;
  }

  // Puts the text of a text node into spans of its own, one per word (the
  // whitespace between them as plain text) or one for the whole run, just
  // before it. The node itself stays exactly where it was, emptied, so a
  // framework holding on to it can still write to it, insert next to it or
  // remove it; if it does, that text is let go of at once (see
  // watchAdditions).
  function wrapText(inst, node, words) {
    var text = node.nodeValue;
    var parent = node.parentNode;
    var frag = document.createDocumentFragment();
    var nodes = [];
    var spans = [];
    (words ? tokens(text) : [text]).forEach(function (part) {
      var n;
      if (words && WRAP_SPACE.test(part)) {
        n = document.createTextNode(part);
      } else {
        n = document.createElement('span');
        n.className = 't-teardown-text';
        n.textContent = part;
        spans.push(n);
      }
      nodes.push(n);
      inst.made.add(n);
      frag.appendChild(n);
    });
    parent.insertBefore(frag, node);
    node.nodeValue = '';
    var wrap = { original: node, text: text, nodes: nodes };
    inst.wraps.push(wrap);
    inst.wrapOf.set(node, wrap);
    var list = inst.wrapsIn.get(parent);
    if (!list) inst.wrapsIn.set(parent, (list = []));
    list.push(wrap);
    return spans;
  }

  // Gives a wrapped text node its text back (unless the page has written
  // its own since) and takes the spans away.
  function unwrapOne(wrap) {
    if (wrap.done) return;
    wrap.done = true;
    if (wrap.original.nodeValue === '') wrap.original.nodeValue = wrap.text;
    wrap.nodes.forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function unwrapText(inst) {
    inst.wraps.forEach(unwrapOne);
    inst.wraps = [];
    inst.wrapOf = new WeakMap();
    inst.wrapsIn = new Map();
    inst.made = new WeakSet();
  }

  function addPiece(ctx, piece) {
    ctx.pieces.push(piece);
    if (ctx.open) ctx.open.members.push(piece);
    ctx.count++;
  }

  function addText(ctx, node, words) {
    ctx.texts.push({ node: node, words: words, owner: ctx.open });
    ctx.count++;
  }

  // One whole piece. An inline one has to become inline-block to move.
  function addWhole(ctx, el, cs) {
    if (cs.display === 'inline' && !isReplaced(el)) ctx.blocks.push(el);
    addPiece(ctx, { kind: 'el', el: el });
  }

  function intersects(ctx, rect) {
    var g = ctx.geom;
    var right = g.left + g.W * g.K;
    var bottom = g.top + g.H * g.K;
    return rect.right > g.left && rect.left < right && rect.bottom > g.top && rect.top < bottom;
  }

  function walk(ctx, parent) {
    var kids = Array.prototype.slice.call(parent.children);
    for (var i = 0; i < kids.length; i++) visit(ctx, kids[i]);
  }

  // Plans splitting a block of text into words, recursing into inline
  // children: plain ones (an <em>, a bare <a>) are split further, ones with
  // chrome (a <code> with a tint) fly as one inline-block piece, and
  // anything that's already a box is visited as usual. Returns false,
  // having planned nothing usable, if that can't be done without the text
  // wrapping or ordering differently: an inline with chrome broken across
  // lines would be pulled onto one, and right-to-left words would lose
  // their bidi order. `loose` (when something kept is inside, and has to
  // be left behind) splits anyway, leaving such an inline's chrome where
  // it is.
  function planWords(ctx, el, plan, loose) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (/\S/.test(n.nodeValue)) {
          if (!loose && (RTL.test(n.nodeValue) || breaksInsideWord(n))) return false;
          plan.texts.push(n);
          plan.words += n.nodeValue.split(WRAP_SPACE).length / 2;
        }
        continue;
      }
      if (n.nodeType !== 1 || SKIP_TAGS[n.tagName.toUpperCase()] || isOurs(n)) continue;
      var cs = getComputedStyle(n);
      if (cs.display === 'none') continue;
      if (ctx.kept.has(n)) {
        plan.kept.push(n);
        continue;
      }
      if (cs.display === 'contents') {
        if (!planWords(ctx, n, plan, loose)) return false;
        continue;
      }
      if (cs.display !== 'inline' || isReplaced(n)) {
        plan.visits.push(n);
        continue;
      }
      var wraps = n.getClientRects().length > 1;
      var whole = hasChrome(n, cs) || isDecorated(cs);
      if (ctx.holdsKept.has(n) || !whole || (wraps && loose)) {
        if (!planWords(ctx, n, plan, loose)) return false;
        continue;
      }
      if (wraps) return false;
      plan.blocks.push(n);
      plan.pieces.push(n);
    }
    return true;
  }

  // True when one of a text node's words is broken across two lines (a
  // long URL wrapped with overflow-wrap, say): as a box of its own it
  // couldn't be, so the text would re-wrap.
  var wordRange = null;
  function breaksInsideWord(node) {
    if (!wordRange) wordRange = document.createRange();
    var offset = 0;
    return tokens(node.nodeValue).some(function (part) {
      var start = offset;
      offset += part.length;
      if (WRAP_SPACE.test(part)) return false;
      wordRange.setStart(node, start);
      wordRange.setEnd(node, offset);
      return wordRange.getClientRects().length > 1;
    });
  }

  // Whether a line set on the block or anything around it reaches its
  // text (decorations carry down to the text inside, but don't show up in
  // the inner elements' own computed styles).
  function decoratedFrom(el) {
    for (var p = el; p && p !== root; p = p.parentElement) {
      if (isDecorated(getComputedStyle(p))) return true;
    }
    return false;
  }

  function newPlan() {
    return { texts: [], blocks: [], pieces: [], visits: [], kept: [], words: 0 };
  }

  function commitWords(ctx, plan) {
    ctx.words += plan.words;
    plan.kept.forEach(function (n) { ctx.keptEls.push(n); });
    plan.blocks.forEach(function (n) { ctx.blocks.push(n); });
    plan.pieces.forEach(function (n) { addPiece(ctx, { kind: 'el', el: n }); });
    plan.texts.forEach(function (n) { addText(ctx, n, true); });
    plan.visits.forEach(function (n) { visit(ctx, n); });
  }

  // Tries to split a block of text into words: false when it has to fly
  // whole instead. `forced` (marked split, or holding something kept)
  // splits past the word limit and through a drop cap; `loose` see
  // planWords.
  function trySplitWords(ctx, el, cs, forced, loose) {
    if (laysOutItems(cs)) return false;
    if (!loose && (clips(cs) || isTruncated(cs))) return false;
    if (!loose && decoratedFrom(el)) return false;
    if (!forced && (ctx.words >= MAX_WORDS || styledFirst(el, cs))) return false;
    var plan = newPlan();
    if (!planWords(ctx, el, plan, loose)) return false;
    commitWords(ctx, plan);
    return true;
  }

  function visit(ctx, el) {
    if (SKIP_TAGS[el.tagName.toUpperCase()] || isOurs(el)) return;
    ctx.seen.add(el);
    var cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    if (ctx.kept.has(el)) {
      ctx.keptEls.push(el);
      return;
    }
    if (cs.display === 'contents') {
      walk(ctx, el);
      return;
    }
    var rect = el.getBoundingClientRect();
    var hint = el.getAttribute('data-teardown');
    var replaced = isReplaced(el);
    var holdsKept = ctx.holdsKept.has(el);
    // A collapsed wrapper can still hold visible absolutely positioned
    // content, so look inside rather than treat it as empty. A collapsed
    // image is one still loading: hidden, so it can't pop up mid-flight.
    if (!rect.width && !rect.height) {
      if (replaced) ctx.hides.push(el);
      else walk(ctx, el);
      return;
    }
    // Out of view: nothing to fly, but it mustn't show up on a blank page
    // either, if the page's own script moves it into view (a carousel that
    // keeps turning), so it's hidden whole until the transition ends.
    // Containers are walked first: something positioned inside one can be
    // on screen when the container isn't, and then only the rest of what's
    // inside is hidden. One holding something kept is never hidden whole.
    if (!intersects(ctx, rect)) {
      var before = ctx.count;
      if (!replaced && hint !== 'group' && cs.overflow === 'visible') walk(ctx, el);
      if (ctx.count === before && !holdsKept) ctx.hides.push(el);
      return;
    }

    // whole: one piece. walk: split into its children. text: split into
    // words. Something kept inside always splits whatever holds it, so it
    // can stay behind.
    var mode;
    var grouping = ctx.profile.grouping;
    var area = (rect.width * rect.height) / (ctx.geom.K * ctx.geom.K);
    var stageArea = ctx.geom.W * ctx.geom.H;
    // Something card-sized that clips its contents (a rounded card
    // cropping its image) flies whole; a page-sized scroller is split.
    var clipsCard = clips(cs) && area < CARD_AREA * stageArea;
    var textual = !replaced && holdsInline(el);
    if (replaced) {
      mode = 'whole';
    } else if (textual) {
      var split = holdsKept || hint === 'split' ||
        (grouping === 'words' && hint !== 'group' && !hasMarker(cs) && !clipsCard && !isTruncated(cs));
      mode = split ? 'text' : 'whole';
    } else if (!el.children.length) {
      mode = 'whole';
    } else if (holdsKept || hint === 'split') {
      mode = 'walk';
    } else if (hint === 'group' || isUnsplittable(el, cs) || clipsCard) {
      mode = 'whole';
    } else if (grouping === 'sections') {
      mode = area < SECTION_AREA * stageArea ? 'whole' : 'walk';
    } else if (grouping === 'cards') {
      mode = isSurface(el, cs) && area < CARD_AREA * stageArea ? 'whole' : 'walk';
    } else {
      mode = 'walk';
    }
    // A box that can't look right moving as one: a parallax background,
    // or something inside blending with the page behind it. Not one that
    // has to stay whole anyway, and a blend inside a clipping card stays
    // with the card (it clips what's inside it either way).
    if (mode === 'whole' && !replaced && !textual && hint !== 'group' && !isUnsplittable(el, cs) &&
      (hasFixedBackground(cs) || (!clipsCard && cs.isolation !== 'isolate' && holdsBlend(el)))) {
      mode = 'walk';
    }

    // Split: its chrome flies as a ghost, its contents as pieces.
    var ghost = mode !== 'whole' && cs.visibility === 'visible' && hasChrome(el, cs)
      ? { kind: 'ghost', src: el, members: [] }
      : null;
    var outer = ctx.open;
    var start = ctx.pieces.length;
    var startCount = ctx.count;
    if (ghost) {
      addPiece(ctx, ghost);
      ctx.open = ghost;
    }
    var done = true;
    if (mode === 'walk') {
      walk(ctx, el);
    } else if (mode === 'text') {
      // In a flex or grid container, each run of text is an item of its
      // own: wrapped whole, it stays one.
      if (laysOutItems(cs)) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && /\S/.test(n.nodeValue)) addText(ctx, n, false);
        }
        walk(ctx, el);
      } else {
        done = trySplitWords(ctx, el, cs, holdsKept || hint === 'split', holdsKept);
      }
    }
    ctx.open = outer;
    if (mode === 'whole' || !done) {
      if (ghost) {
        ctx.pieces.length = start;
        ctx.count = startCount;
        if (outer) outer.members.pop();
      }
      addWhole(ctx, el, cs);
    }
  }

  // The target's own contents. Its own bare text has no box, so it's
  // wrapped: per word for 'words', or whenever it shares its lines with
  // inline elements (each run made one box would re-wrap them), otherwise
  // each run as one piece.
  function fill(ctx, box) {
    var cs = getComputedStyle(box);
    var mixed = false;
    for (var c = box.firstElementChild; c && !mixed; c = c.nextElementSibling) {
      mixed = !isReplaced(c) && !SKIP_TAGS[c.tagName.toUpperCase()] && getComputedStyle(c).display === 'inline';
    }
    if (hasOwnText(box) && (mixed || ctx.profile.grouping === 'words') && trySplitWords(ctx, box, cs, false, false)) return;
    for (var n = box.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) addText(ctx, n, false);
    }
    walk(ctx, box);
  }

  function keepSelector(profile) {
    return '[data-teardown="keep"]' + (profile.keep ? ',' + profile.keep : '');
  }

  // --- Copying chrome onto a ghost, and taking it off the original. ---
  var BACKGROUND_PROPS = [
    'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
    'backgroundOrigin', 'backgroundClip', 'backgroundBlendMode', 'backgroundAttachment',
  ];
  var FRAME_PROPS = [
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'borderImageSource', 'borderImageSlice', 'borderImageWidth', 'borderImageOutset', 'borderImageRepeat',
    'boxShadow', 'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset',
    'backdropFilter', 'webkitBackdropFilter', 'filter', 'mixBlendMode',
  ];
  function copyProps(cs, props) {
    var out = {};
    props.forEach(function (k) {
      if (typeof cs[k] === 'string' && cs[k]) out[k] = cs[k];
    });
    return out;
  }
  var BARE_BACKGROUND = [['background-color', 'transparent'], ['background-image', 'none']];
  var BARE_FRAME = [
    ['border-top-color', 'transparent'], ['border-right-color', 'transparent'],
    ['border-bottom-color', 'transparent'], ['border-left-color', 'transparent'],
    ['border-image-source', 'none'], ['box-shadow', 'none'], ['outline-style', 'none'],
    ['backdrop-filter', 'none'], ['-webkit-backdrop-filter', 'none'],
  ];
  function strip(store, el, pairs) {
    // Off at once, and back at once when it lands: its own transition
    // would fade it out while the ghost is already standing in for it,
    // then fade it back in after the ghost has gone.
    setStyle(store, el, 'transition-property', 'none');
    pairs.forEach(function (pair) { setStyle(store, el, pair[0], pair[1]); });
  }

  // The page background, read before anything is written. The canvas is
  // the root's background, or the body's when the root has none (the
  // browser paints the body's across the whole page then), or the
  // browser's own. When the root has one too, the body's is just its own
  // box (often a centered column), and becomes a sheet of its own, as does
  // a border or shadow on the body.
  function measureBackground(profile, g) {
    var body = document.body;
    var rootCs = getComputedStyle(root);
    var bodyCs = getComputedStyle(body);
    var rootPaints = paintsBackground(rootCs);
    var bodyPaints = paintsBackground(bodyCs);
    var canvasCs = rootPaints ? rootCs : bodyPaints ? bodyCs : null;
    var stay = profile.background === 'stay';
    var bg = { sheets: [], stripBody: false };

    if (!stay) {
      // Positioned against the root element's box, like the canvas, unless
      // it's fixed to the viewport; then cut to the viewport, so a page
      // background longer than the screen doesn't fly as one tall slab.
      var area = { left: 0, top: 0, width: g.W, height: g.H };
      if (canvasCs && canvasCs.backgroundAttachment !== 'fixed') {
        var r = root.getBoundingClientRect();
        area = { left: r.left, top: r.top, width: Math.max(r.width, g.W - r.left), height: Math.max(r.height, g.H - r.top) };
      }
      var paint = canvasCs ? copyProps(canvasCs, BACKGROUND_PROPS) : {};
      // Unpainted, the canvas is the browser's own color, which follows
      // the page's color-scheme.
      if (!canvasCs || isTransparent(canvasCs.backgroundColor)) paint.backgroundColor = 'Canvas';
      bg.sheets.push({
        kind: 'sheet', canvas: true, area: area, paint: paint,
        cx: g.W / 2, cy: g.H / 2, w: g.W, h: g.H, lw: g.W, lh: g.H, s: 1, base: 1,
      });
    }

    var ownBox = bodyPaints && rootPaints;
    if (ownBox || (!stay && hasFrame(bodyCs))) {
      var rect = body.getBoundingClientRect();
      var chrome = copyProps(bodyCs, FRAME_PROPS);
      if (ownBox) Object.assign(chrome, copyProps(bodyCs, BACKGROUND_PROPS));
      bg.sheets.push({
        kind: 'sheet', src: body, chrome: chrome, still: stay,
        cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height,
        lw: body.offsetWidth || rect.width, lh: body.offsetHeight || rect.height, s: 1, base: 1,
      });
    }
    // Whenever the body paints anything, it comes off: its own box would
    // cover the ghosts, and a background it lends the canvas would stay.
    bg.stripBody = bodyPaints && (!stay || ownBox);
    return bg;
  }

  function parseTranslate(v) {
    if (!isSet(v)) return null;
    var parts = splitTop(v);
    return [parts[0], parts[1] || '0px', parts[2] || ''];
  }

  function parseRotate(v) {
    if (!isSet(v)) return { raw: v, angle: '' };
    var m = /^(?:z\s+|0\s+0\s+1\s+)?(-?[\d.]+(?:e[+-]?\d+)?(?:deg|rad|turn|grad))$/.exec(v);
    // Turned about some other axis: left as it is, without a spin.
    return { raw: v, angle: m ? m[1] : null };
  }

  function parseScale(v) {
    if (!isSet(v)) return null;
    var parts = splitTop(v).map(function (s) { return /%$/.test(s) ? parseFloat(s) / 100 : parseFloat(s); });
    return parts.some(isNaN) ? null : parts;
  }

  function splitTop(v) {
    var out = [];
    var depth = 0;
    var cur = '';
    for (var i = 0; i < v.length; i++) {
      var c = v[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === ' ' && depth === 0) {
        if (cur) out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function isTopLayer(el) {
    return [':modal', ':popover-open'].some(function (sel) {
      try {
        return el.matches(sel);
      } catch (e) {
        return false;
      }
    });
  }

  function collect(inst, el, profile) {
    var isRoot = isRootTarget(el);
    var scope = isRoot ? document.body : el;
    var ctx = {
      profile: profile,
      geom: stageGeometry(el),
      pieces: [],
      texts: [],
      blocks: [],
      hides: [],
      keptEls: [],
      kept: new Set(),
      holdsKept: new Set(),
      open: null,
      count: 0,
      words: 0,
      seen: new WeakSet(),
    };
    var g = ctx.geom;
    inst.geom = g;
    inst.seen = ctx.seen;
    if (!scope) return [];

    // Pass 1: decide. Everything kept, and everything holding something
    // kept, is found up front.
    Array.prototype.forEach.call(scope.querySelectorAll(keepSelector(profile)), function (k) {
      ctx.kept.add(k);
      for (var p = k.parentElement; p && p !== scope; p = p.parentElement) ctx.holdsKept.add(p);
    });
    fill(ctx, scope);

    // Pass 2: the structural changes.
    var store = inst.stashes;
    ctx.hides.forEach(function (n) { setStyle(store, n, 'visibility', 'hidden'); });
    ctx.blocks.forEach(function (n) { setStyle(store, n, 'display', 'inline-block'); });
    ctx.texts.forEach(function (t) {
      if (!t.node.parentNode) return;
      var spans = wrapText(inst, t.node, t.words);
      spans.forEach(function (span) {
        var piece = { kind: 'el', el: span };
        ctx.pieces.push(piece);
        if (t.owner) t.owner.members.push(piece);
      });
    });

    // Pass 3: measure.
    var bg = isRoot ? measureBackground(profile, g) : null;
    ctx.pieces.forEach(function (piece) {
      var target = piece.kind === 'ghost' ? piece.src : piece.el;
      var rect = target.getBoundingClientRect();
      var cs = getComputedStyle(target);
      piece.cx = (rect.left + rect.width / 2 - g.left) / g.K;
      piece.cy = (rect.top + rect.height / 2 - g.top) / g.K;
      piece.w = rect.width / g.K;
      piece.h = rect.height / g.K;
      var opacity = parseFloat(cs.opacity);
      piece.base = isFinite(opacity) ? opacity : 1;
      if (piece.kind === 'ghost') {
        // Drawn at the box's own size, then scaled to how it shows on the
        // stage, so its borders, corners and shadow scale with it.
        piece.lw = target.offsetWidth || piece.w;
        piece.lh = target.offsetHeight || piece.h;
        piece.s = piece.w / piece.lw || 1;
        piece.fixed = hasFixedBackground(cs) &&
          cs.backgroundAttachment.split(',').every(function (a) { return a.trim() === 'fixed'; });
        piece.chrome = Object.assign(copyProps(cs, BACKGROUND_PROPS), copyProps(cs, FRAME_PROPS));
        var before = pseudoStyle(target, '::before');
        var after = pseudoStyle(target, '::after');
        if (before || after) {
          piece.pseudo = {
            before: before ? parseFloat(before.opacity) : 1,
            after: after ? parseFloat(after.opacity) : 1,
          };
        }
      } else {
        // translate moves the piece in its parent's px, which differ from
        // stage units when something between the two is scaled.
        piece.factor = g.K / scaleOf(target.parentElement);
        piece.tr = parseTranslate(cs.translate);
        piece.ro = parseRotate(cs.rotate);
        piece.sc = parseScale(cs.scale);
        piece.top = isTopLayer(target);
      }
    });
    // Pieces flown off the page would stretch its scrollable area and
    // could bring up scrollbars mid-flight; on an axis the page doesn't
    // already scroll, it's clipped instead.
    var overflow = null;
    if (isRoot) {
      var rcs = getComputedStyle(root);
      var bcs = getComputedStyle(document.body);
      overflow = {
        x: rcs.overflowX === 'visible' && bcs.overflowX === 'visible' && root.scrollWidth <= root.clientWidth,
        y: rcs.overflowY === 'visible' && bcs.overflowY === 'visible' && root.scrollHeight <= root.clientHeight,
      };
    }
    // An element stage clips what flies out of it, but not what it keeps:
    // the clip reaches out far enough to take that in.
    var stage = null;
    if (!isRoot) {
      var scs = getComputedStyle(el);
      var reach = 0;
      ctx.keptEls.forEach(function (k) {
        var r = k.getBoundingClientRect();
        var right = g.left + g.W * g.K;
        var bottom = g.top + g.H * g.K;
        reach = Math.max(reach, (g.left - r.left) / g.K, (g.top - r.top) / g.K, (r.right - right) / g.K, (r.bottom - bottom) / g.K);
      });
      stage = {
        static: scs.position === 'static',
        // A scroll container clips already; turning that into `clip`
        // would throw away where it's scrolled to.
        clip: scs.overflowX === 'visible' && scs.overflowY === 'visible',
        reach: Math.ceil(reach),
      };
    }

    // Pass 4: write.
    var stageStore = inst.stageStashes;
    if (overflow && overflow.x) setStyle(stageStore, root, 'overflow-x', 'clip');
    if (overflow && overflow.y) setStyle(stageStore, root, 'overflow-y', 'clip');
    if (stage) {
      if (stage.static) setStyle(stageStore, el, 'position', 'relative');
      if (stage.clip) {
        setStyle(stageStore, el, 'overflow-x', 'clip');
        setStyle(stageStore, el, 'overflow-y', 'clip');
        if (stage.reach > 0) setStyle(stageStore, el, 'overflow-clip-margin', stage.reach + 'px');
      }
    }
    ctx.keptEls.forEach(function (k) {
      if (isRoot) return;
      k.setAttribute(KEPT_ATTR, '');
      inst.kept.push(k);
    });

    var layer = document.createElement('div');
    layer.className = 't-teardown-layer' + (isRoot ? ' t-teardown-layer--root' : '');
    layer.style.width = g.W + 'px';
    layer.style.height = g.H + 'px';
    var sheets = bg ? bg.sheets : [];
    if (bg) {
      if (bg.sheets.length && bg.sheets[0].canvas) {
        setStyle(store, root, 'background-color', profile.color);
        setStyle(store, root, 'background-image', 'none');
      }
      if (bg.stripBody) strip(store, document.body, BARE_BACKGROUND);
    }
    sheets.forEach(function (sheet) {
      if (sheet.canvas) {
        var frame = document.createElement('div');
        frame.className = 't-teardown-ghost t-teardown-frame';
        Object.assign(frame.style, { left: '0px', top: '0px', width: g.W + 'px', height: g.H + 'px' });
        var paint = document.createElement('div');
        Object.assign(paint.style, sheet.paint, {
          left: sheet.area.left + 'px', top: sheet.area.top + 'px',
          width: sheet.area.width + 'px', height: sheet.area.height + 'px',
        });
        frame.appendChild(paint);
        sheet.el = frame;
      } else {
        sheet.el = makeGhost(sheet, g);
        strip(store, sheet.src, BARE_FRAME);
      }
      layer.appendChild(sheet.el);
    });
    ctx.pieces.forEach(function (piece) {
      if (piece.kind === 'ghost') {
        var ghost = makeGhost(piece, g);
        layer.appendChild(ghost);
        var src = piece.src;
        strip(store, src, BARE_BACKGROUND.concat(BARE_FRAME));
        if (piece.pseudo) {
          src.classList.add('t-teardown-bare');
          inst.bare.push({ el: src, pseudo: piece.pseudo });
          setPseudo(src, piece.pseudo, 1);
        }
        piece.el = ghost;
      } else {
        // The page's own transitions would make every per-frame write lag
        // behind, so they're off while the piece is in flight.
        setStyle(store, piece.el, 'transition-property', 'none');
      }
    });
    // The root's layer hangs off <html>, not <body>: a body with a
    // transform or filter would otherwise be what it's fixed to.
    (isRoot ? root : el).appendChild(layer);
    // Wherever it actually landed (a scrolled stage, a transformed root),
    // shift it onto the stage.
    var at = layer.getBoundingClientRect();
    layer.style.left = (g.left - at.left) / g.K + 'px';
    layer.style.top = (g.top - at.top) / g.K + 'px';
    inst.layer = layer;
    return sheets.concat(ctx.pieces);
  }

  // A ghost: the chrome drawn on a box the size of the original, scaled
  // to how it shows on the stage. A background fixed to the viewport goes
  // on a viewport-sized layer inside instead, cropped to the box: lined up
  // exactly with the original while it's at rest, then carried along with
  // the ghost once it moves (a moving box can't keep it fixed).
  function makeGhost(piece, g) {
    var ghost = document.createElement('div');
    ghost.className = 't-teardown-ghost';
    var left = piece.cx - piece.lw / 2;
    var top = piece.cy - piece.lh / 2;
    Object.assign(ghost.style, piece.chrome, {
      left: left + 'px',
      top: top + 'px',
      width: piece.lw + 'px',
      height: piece.lh + 'px',
    });
    var scaled = Math.abs(piece.s - 1) > 1e-3;
    if (scaled) ghost.style.transform = 'scale(' + piece.s + ')';
    if (piece.fixed && !scaled) {
      var paint = document.createElement('div');
      BACKGROUND_PROPS.forEach(function (k) {
        if (piece.chrome[k]) paint.style[k] = piece.chrome[k];
        ghost.style[k] = '';
      });
      paint.style.backgroundAttachment = 'scroll';
      var inner = {
        left: left + (parseFloat(piece.chrome.borderLeftWidth) || 0),
        top: top + (parseFloat(piece.chrome.borderTopWidth) || 0),
      };
      Object.assign(paint.style, {
        left: -g.left / g.K - inner.left + 'px',
        top: -g.top / g.K - inner.top + 'px',
        // The viewport a fixed background is laid out in, scrollbars left
        // out.
        width: root.clientWidth / g.K + 'px',
        height: root.clientHeight / g.K + 'px',
      });
      ghost.classList.add('t-teardown-frame');
      ghost.appendChild(paint);
    }
    return ghost;
  }

  function setPseudo(el, pseudo, alpha) {
    el.style.setProperty('--t-teardown-before', String(pseudo.before * alpha));
    el.style.setProperty('--t-teardown-after', String(pseudo.after * alpha));
  }

  // --- Planning: when each piece goes and the path it takes. ---

  function rankPieces(pieces, order, O) {
    var ranked = pieces.filter(function (p) { return p.kind !== 'sheet'; });
    if (!ranked.length) return;
    if (order === 'random') {
      ranked.forEach(function (p) { p.rank = Math.random(); });
    } else if (order === 'reading' || order === 'reverse') {
      // Rows first, so cards sitting side by side with slightly different
      // tops still go left to right.
      var sorted = ranked.slice().sort(function (a, b) {
        var ra = Math.round((a.cy - a.h / 2) / 24);
        var rb = Math.round((b.cy - b.h / 2) / 24);
        return ra - rb || a.cx - b.cx;
      });
      sorted.forEach(function (p, i) {
        var r = sorted.length > 1 ? i / (sorted.length - 1) : 0;
        p.rank = order === 'reverse' ? 1 - r : r;
      });
    } else {
      // Distance from the origin, as a wave, with a little jitter so the
      // front isn't a perfect ring.
      var far = 0;
      ranked.forEach(function (p) {
        p.rank = Math.hypot(p.cx - O.x, p.cy - O.y);
        far = Math.max(far, p.rank);
      });
      ranked.forEach(function (p) {
        p.rank = clamp((far ? p.rank / far : 0) + (Math.random() - 0.5) * 0.1, 0, 1);
      });
    }
  }

  // How far a piece with radius R at (cx, cy) has to travel along (ux, uy)
  // to be entirely outside the W×H stage.
  function exitDistance(cx, cy, ux, uy, R, W, H) {
    var best = Infinity;
    if (ux > 1e-6) best = Math.min(best, (W + R - cx) / ux);
    if (ux < -1e-6) best = Math.min(best, (cx + R) / -ux);
    if (uy > 1e-6) best = Math.min(best, (H + R - cy) / uy);
    if (uy < -1e-6) best = Math.min(best, (cy + R) / -uy);
    return (isFinite(best) ? Math.max(0, best) : 0) + MARGIN;
  }

  function directionFor(piece, profile, O, W, H) {
    var dx = 0;
    var dy = 0;
    switch (profile.direction) {
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
      case 'random': break;
      case 'edge': {
        if (piece.kind === 'sheet') { dy = 1; break; }
        var d = [piece.cx, W - piece.cx, piece.cy, H - piece.cy];
        var i = d.indexOf(Math.min.apply(null, d));
        dx = i === 0 ? -1 : i === 1 ? 1 : 0;
        dy = i === 2 ? -1 : i === 3 ? 1 : 0;
        break;
      }
      case 'center':
        dx = piece.cx - W / 2;
        dy = piece.cy - H / 2;
        if (piece.kind === 'sheet') dy = 1;
        break;
      default:
        dx = piece.cx - O.x;
        dy = piece.cy - O.y;
    }
    var len = Math.hypot(dx, dy);
    var a = len > 1 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
    // A little scatter in the angle for anything that isn't a clean slide,
    // so a whole column leaving 'up' doesn't move as one rigid block.
    if (profile.motion !== 'slide' && profile.direction !== 'random') a += (Math.random() - 0.5) * 0.36;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  // Returns piece.move(e) → [x, y, rotateDeg, scale] in stage units, for
  // e = how far along its path it is (0 home, 1 gone; can overshoot 0..1
  // with a bouncy easing).
  function planMotion(piece, profile, O, W, H, swirl) {
    var endScale = profile.scale;
    var R = 0.5 * Math.hypot(piece.w, piece.h) * Math.max(1, endScale);
    var spin = piece.kind === 'sheet' ? profile.spin * 0.25 : profile.spin;
    var spinDeg = (Math.random() < 0.5 ? -1 : 1) * (0.4 + 0.6 * Math.random()) * spin * 720;
    var cx = piece.cx;
    var cy = piece.cy;

    if (piece.still) return function () { return [0, 0, 0, 1]; };
    if (piece.kind === 'sheet' && profile.background === 'fade') {
      piece.fades = true;
      return function () { return [0, 0, 0, 1]; };
    }

    if (profile.motion === 'spiral') {
      var center = profile.direction === 'origin' ? O : { x: W / 2, y: H / 2 };
      var r0 = Math.hypot(cx - center.x, cy - center.y);
      var th0 = r0 > 1 ? Math.atan2(cy - center.y, cx - center.x) : Math.random() * Math.PI * 2;
      var corner = Math.max(
        Math.hypot(center.x, center.y), Math.hypot(W - center.x, center.y),
        Math.hypot(center.x, H - center.y), Math.hypot(W - center.x, H - center.y)
      );
      var r1 = corner + R + MARGIN;
      var dth = swirl * (0.6 + 0.9 * profile.spin) * Math.PI;
      return function (e) {
        var r = r0 + (r1 - r0) * e;
        var th = th0 + dth * e;
        return [
          center.x + Math.cos(th) * r - cx,
          center.y + Math.sin(th) * r - cy,
          (dth * e * 180) / Math.PI * Math.min(1, spin * 2),
          1 + (endScale - 1) * e,
        ];
      };
    }

    var u = directionFor(piece, profile, O, W, H);
    var D = exitDistance(cx, cy, u.x, u.y, R, W, H);

    if (profile.motion === 'throw') {
      // Tossed: a kick (mostly upward) then gravity, always ending off the
      // bottom edge. y(e) = v·e + g·e² with g chosen so y(1) clears it.
      var kick = -(0.2 + 0.3 * Math.random()) * H * (u.y < -0.3 ? 1.6 : u.y > 0.3 ? 0.3 : 1);
      var drop = H + R - cy + MARGIN;
      var vx = u.x * D * 0.6;
      return function (e) {
        return [vx * e, kick * e + (drop - kick) * e * e, spinDeg * e, 1 + (endScale - 1) * e];
      };
    }

    var turn = profile.motion === 'tumble' ? spinDeg : 0;
    return function (e) {
      return [u.x * D * e, u.y * D * e, turn * e, 1 + (endScale - 1) * e];
    };
  }

  // Sets each piece's window — the stretch of progress (0–1) it spends in
  // flight — and its path. Covering, pieces leave in rank order and each
  // ghost leaves once the last of its contents has started. Building up
  // (a fresh reveal), ranks are flipped so rank 0 lands first, and since a
  // reveal plays progress backward, the ghost's same "latest window" now
  // means it lands before its contents. The sheets' window is the latest
  // of all: last out, first in.
  function plan(inst, pieces, profile, origin, revealing) {
    var g = inst.geom;
    var O = origin || { x: g.W / 2, y: g.H / 2 };
    var s = clamp(profile.stagger, 0, MAX_STAGGER);
    inst.span = 1 - s;
    rankPieces(pieces, profile.order, O);
    pieces.forEach(function (p) {
      if (p.kind === 'sheet') p.start = s;
      else p.start = s * (revealing ? 1 - p.rank : p.rank);
    });
    // Ghosts come before their contents (nested ones after the ghost
    // they're in), so going backward settles the innermost first.
    for (var i = pieces.length - 1; i >= 0; i--) {
      var p = pieces[i];
      if (!p.members) continue;
      p.members.forEach(function (m) { p.start = Math.max(p.start, m.start); });
    }
    var swirl = Math.random() < 0.5 ? -1 : 1;
    pieces.forEach(function (p) {
      p.move = planMotion(p, profile, O, g.W, g.H, swirl);
    });
  }

  // What a piece's own inline style is put back to between flights.
  var MOTION_PROPS = ['translate', 'rotate', 'scale', 'opacity', 'visibility'];

  function addTranslate(b, x, y) {
    var px = x.toFixed(2) + 'px';
    var py = y.toFixed(2) + 'px';
    if (!b) return px + ' ' + py;
    return 'calc(' + b[0] + ' + ' + px + ') calc(' + b[1] + ' + ' + py + ')' + (b[2] ? ' ' + b[2] : '');
  }

  function addRotate(r, deg) {
    if (r.angle === null) return r.raw;
    var d = deg.toFixed(2) + 'deg';
    return r.angle ? 'calc(' + r.angle + ' + ' + d + ')' : d;
  }

  function mulScale(b, s) {
    if (!b) return String(s);
    if (b.length === 1) return String(b[0] * s);
    return b[0] * s + ' ' + b[1] * s + (b.length > 2 ? ' ' + b[2] : '');
  }

  // Each piece is at rest (0: nothing of ours written, so it's exactly the
  // page's own), in flight (1) or gone (2: at the end of its path, and
  // hidden too, since a piece inside something the page keeps moving, like
  // a carousel that's still turning, would otherwise be carried back into
  // view; being off-screen as well covers anything inside it that sets its
  // own visibility). Only a piece in flight is written every frame.
  function render(inst, p) {
    var pieces = inst.pieces;
    if (!pieces) return;
    var ease = easingFn(inst.profile.easing);
    var span = inst.span;
    var fade = inst.profile.fade;
    var store = inst.stashes;
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (piece.still) continue;
      var l = span > 0 ? (p - piece.start) / span : (p > piece.start ? 1 : 0);
      var state = l <= 0 ? 0 : l >= 1 ? 2 : 1;
      if (state !== 1 && state === piece.state) continue;
      var was = piece.state;
      piece.state = state;
      var el = piece.el;
      var st = el.style;
      var mine = piece.kind === 'el';
      if (piece.top) el.classList.toggle('t-teardown-gone', state === 2);
      if (mine && state === 0) {
        unstashProps(store, el, MOTION_PROPS);
        piece.faded = false;
        continue;
      }
      // A ghost at rest isn't transformed either, so a fixed background
      // on it (parallax) still lines up with the original's.
      if (state === 0) {
        st.removeProperty('translate');
        st.removeProperty('rotate');
        st.removeProperty('scale');
        st.removeProperty('visibility');
        st.opacity = String(piece.base);
        if (piece.pseudo) setPseudo(piece.src, piece.pseudo, 1);
        continue;
      }
      if (was === 2) {
        if (mine) unstashProps(store, el, ['visibility']);
        else st.removeProperty('visibility');
      }
      var e = state === 0 ? 0 : state === 2 ? 1 : ease(l);
      var m = piece.move(e);
      var gone = clamp(e, 0, 1);
      var alpha = piece.fades ? 1 - gone : 1 - fade * gone;
      if (mine) {
        var f = piece.factor;
        setStyle(store, el, 'translate', addTranslate(piece.tr, m[0] * f, m[1] * f));
        setStyle(store, el, 'rotate', addRotate(piece.ro, m[2]));
        setStyle(store, el, 'scale', mulScale(piece.sc, Math.max(0, m[3])));
        // Not important: an opacity the page is animating (a fade-in
        // still running) keeps going.
        if (alpha < 1) {
          setStyle(store, el, 'opacity', String(piece.base * alpha), true);
          piece.faded = true;
        } else if (piece.faded) {
          unstashProps(store, el, ['opacity']);
          piece.faded = false;
        }
      } else {
        st.translate = m[0].toFixed(2) + 'px ' + m[1].toFixed(2) + 'px';
        st.rotate = m[2].toFixed(2) + 'deg';
        st.scale = String(Math.max(0, m[3]));
        st.opacity = String(piece.base * alpha);
      }
      if (piece.pseudo) setPseudo(piece.src, piece.pseudo, state === 2 ? 0 : alpha);
      if (state === 2) {
        if (mine) setStyle(store, el, 'visibility', 'hidden');
        else st.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  // --- Per-target state. Every target (an arbitrary element, or
  // `document.documentElement` for the navigation case) gets its own
  // instance record, so two targets never share or stomp each other.
  // `progress` is how torn down the target is (0–1); a new cover()/
  // reveal() mid-flight turns the same pieces around from wherever they
  // are instead of jumping. `gen` is bumped on every call; a superseded
  // call's promise still resolves, it just stops touching anything. ---
  var instances = new WeakMap();
  function instanceFor(el) {
    var inst = instances.get(el);
    if (!inst) {
      inst = {
        gen: 0, profile: options, progress: 0, animHandle: null, pieces: null, layer: null,
        stashes: new Map(), stageStashes: new Map(), bare: [], kept: [], late: new Set(), seen: null,
        wraps: [], wrapOf: new WeakMap(), wrapsIn: new Map(), made: new WeakSet(),
        shield: null, watcher: null, origin: null, geom: null, span: 1, focus: null,
      };
      instances.set(el, inst);
    }
    return inst;
  }

  // Elements currently mid-transition/covered, tracked outside the
  // WeakMap (which isn't iterable) purely so bfcache restoration can snap
  // every one of them back to a clean state.
  var activeElements = new Set();

  // --- Holding the page still during a page-level transition: the pieces
  // were measured where they sat. The shield takes the pointer; capturing
  // listeners on the window stop clicks, keys and the wheel reaching
  // anything, including a modal dialog or popover above the shield; and
  // the scroll position is held where it was. Browser shortcuts (with a
  // modifier) still work. ---
  var BLOCKED_INPUT = ['click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'mousedown', 'touchstart', 'touchmove', 'wheel', 'keydown'];
  var BLOCK_OPTIONS = { capture: true, passive: false };
  function blockInput(event) {
    if (event.type === 'keydown' && (event.metaKey || event.ctrlKey || event.altKey)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  function addShield(inst) {
    if (inst.shield) return;
    var shield = document.createElement('div');
    shield.className = 't-teardown-shield';
    root.appendChild(shield);
    var x = global.scrollX;
    var y = global.scrollY;
    function hold(event) {
      if (event.target !== document) return;
      if (global.scrollX !== x || global.scrollY !== y) global.scrollTo(x, y);
    }
    BLOCKED_INPUT.forEach(function (type) { global.addEventListener(type, blockInput, BLOCK_OPTIONS); });
    global.addEventListener('scroll', hold, true);
    inst.shield = { el: shield, hold: hold };
  }

  function removeShield(inst) {
    if (!inst.shield) return;
    if (inst.shield.el.parentNode) inst.shield.el.parentNode.removeChild(inst.shield.el);
    BLOCKED_INPUT.forEach(function (type) { global.removeEventListener(type, blockInput, BLOCK_OPTIONS); });
    global.removeEventListener('scroll', inst.shield.hold, true);
    inst.shield = null;
  }

  // Anything the page's own scripts add while a transition is running
  // (a typing effect's next letter, a particle, a lazy-loaded card) wasn't
  // there to be measured, so it has no flight; it's hidden until the
  // target is put back together instead of popping up in place. Not
  // anything that was already there and has just been moved (a carousel
  // putting its first slide last), and not inside anything kept, which is
  // the page's to change as it likes. Something added and then removed
  // again is let go of at once, so a page that keeps adding and removing
  // nodes doesn't pile them up.
  //
  // It also watches the text this script split into spans: as soon as the
  // page touches a split text node, or changes what's around it (a
  // framework re-rendering), that text is put back as it was, so the page
  // never works on a node that isn't where it left it.
  function watchAdditions(inst, el) {
    if (typeof MutationObserver !== 'function') return;
    var target = isRootTarget(el) ? document.body : el;
    if (!target) return;
    var keep = keepSelector(inst.profile);
    function ours(n) {
      return inst.made.has(n) || (n.nodeType === 1 && isOurs(n));
    }
    inst.watcher = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'characterData') {
          var wrap = inst.wrapOf.get(record.target);
          if (wrap) unwrapOne(wrap);
          return;
        }
        var added = Array.prototype.slice.call(record.addedNodes);
        var removed = Array.prototype.slice.call(record.removedNodes);
        var wraps = inst.wrapsIn.get(record.target);
        if (wraps && !added.concat(removed).every(ours)) wraps.forEach(unwrapOne);
        added.forEach(function (n) {
          if (n.nodeType !== 1 || !n.isConnected || ours(n) || inst.late.has(n)) return;
          if (inst.seen && inst.seen.has(n)) return;
          try {
            if (n.closest(keep)) return;
          } catch (e) {}
          n.setAttribute(LATE_ATTR, '');
          inst.late.add(n);
        });
        removed.forEach(function (n) {
          if (!inst.late.has(n) || n.isConnected) return;
          n.removeAttribute(LATE_ATTR);
          inst.late.delete(n);
        });
      });
    });
    inst.watcher.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // Lets go of the pieces: every inline style restored, wrapped text
  // unwrapped (the original text nodes put back), and the ghost layer
  // gone. What the stage itself was given stays, so a covered element
  // stays covered.
  function release(inst) {
    if (inst.watcher) {
      inst.watcher.disconnect();
      inst.watcher = null;
    }
    inst.late.forEach(function (n) { n.removeAttribute(LATE_ATTR); });
    inst.late.clear();
    if (inst.pieces) {
      inst.pieces.forEach(function (p) {
        if (p.top) p.el.classList.remove('t-teardown-gone');
      });
    }
    var bare = inst.bare;
    inst.bare = [];
    bare.forEach(function (b) { setPseudo(b.el, b.pseudo, 1); });
    unstash(inst.stashes, bare.length ? function () {
      bare.forEach(function (b) {
        b.el.classList.remove('t-teardown-bare');
        b.el.style.removeProperty('--t-teardown-before');
        b.el.style.removeProperty('--t-teardown-after');
      });
    } : null);
    unwrapText(inst);
    if (inst.layer && inst.layer.parentNode) inst.layer.parentNode.removeChild(inst.layer);
    inst.layer = null;
    inst.pieces = null;
  }

  // Puts the target back exactly as it was.
  function restore(inst, el) {
    release(inst);
    unstash(inst.stageStashes);
    inst.kept.forEach(function (k) { k.removeAttribute(KEPT_ATTR); });
    inst.kept = [];
    removeShield(inst);
    el.classList.remove('t-teardown-stage', 't-teardown-covered');
    if (isRootTarget(el)) clearArrivalStyle();
  }

  // Lays out a fresh set of pieces for this target. Anything left from a
  // previous one is put back first, so nothing is measured mid-flight.
  function prepare(inst, el, profile, origin, revealing) {
    restore(inst, el);
    if (!isRootTarget(el)) el.classList.add('t-teardown-stage');
    else addShield(inst);
    inst.pieces = collect(inst, el, profile);
    watchAdditions(inst, el);
    inst.origin = origin;
    plan(inst, inst.pieces, profile, origin, revealing);
  }

  function cleanupEl(el) {
    var inst = instanceFor(el);
    if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
    inst.animHandle = null;
    inst.progress = 0;
    restore(inst, el);
    activeElements.delete(el);
    // A focused element that was hidden on the way may have lost focus;
    // give it back, unless something else has taken it since.
    var focus = inst.focus;
    inst.focus = null;
    var active = document.activeElement;
    if (focus && focus.isConnected && focus !== active && (!active || active === document.body)) {
      try {
        focus.focus({ preventScroll: true });
      } catch (e) {}
    }
  }

  // Before the first call on a target, notes what has focus.
  function begin(inst, el) {
    if (activeElements.has(el)) return;
    activeElements.add(el);
    var active = document.activeElement;
    inst.focus = active && active !== document.body ? active : null;
  }

  // Animates inst.progress from wherever it is now to `to`, over the
  // share of the profile's duration that distance represents, so a
  // reversal halfway through takes half as long rather than crawling.
  function animateTo(inst, to, myGen) {
    return new Promise(function (resolve) {
      if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
      var from = inst.progress;
      var duration = inst.profile.duration * Math.abs(to - from);
      var start = null;
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (myGen === inst.gen) {
          if (inst.animHandle) cancelAnimationFrame(inst.animHandle);
          inst.animHandle = null;
          inst.progress = to;
          try {
            render(inst, to);
          } catch (e) {}
        }
        resolve();
      }
      function tick(now) {
        if (finished) return;
        if (myGen !== inst.gen) { finish(); return; }
        if (start === null) start = now;
        var t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
        if (t >= 1) { finish(); return; }
        inst.progress = from + (to - from) * t;
        // Something on the page that can't be read or written mid-flight
        // ends the motion where it was headed rather than freezing it.
        try {
          render(inst, inst.progress);
        } catch (e) {
          finish();
          return;
        }
        inst.animHandle = requestAnimationFrame(tick);
      }
      inst.animHandle = requestAnimationFrame(tick);
      // Browsers stop running rAF in a background tab. Without this, a
      // link clicked just before switching away would never finish
      // covering, so it would never navigate (see inkblot.js). While
      // frames are running in a visible tab the timer waits out what's
      // left instead of cutting the motion short.
      function fallback() {
        if (finished) return;
        if (start !== null && document.visibilityState === 'visible') {
          var left = start + duration - performance.now();
          if (left > 0) {
            setTimeout(fallback, left + 150);
            return;
          }
        }
        finish();
      }
      setTimeout(fallback, duration + 150);
    });
  }

  injectStyles();

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function readPending() {
    try {
      var raw = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !isFinite(data.ts)) return null;
      // Timed from when this page's navigation began, not from now, so a
      // slow server doesn't make the handoff stale.
      var perf = global.performance;
      var began = perf && perf.timeOrigin > 0 ? perf.timeOrigin : Date.now();
      var age = began - data.ts;
      if (!(age > -1000 && age < PENDING_TTL)) return null;
      // A refresh, or back/forward, isn't the far side of a click.
      var nav = perf && perf.getEntriesByType && perf.getEntriesByType('navigation')[0];
      if (nav && nav.type && nav.type !== 'navigate') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function setPending(profile, origin) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ts: Date.now(), profile: profile, origin: origin }));
    } catch (e) {}
  }

  // --- Options, checked: anything unusable falls back to the page's
  // setting, then to the default, so a typo can't stall a transition. ---
  function toNumber(value, fallback) {
    if (typeof value === 'string' && value.trim() !== '') value = Number(value);
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function isColor(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    return !(global.CSS && global.CSS.supports) || global.CSS.supports('color', value);
  }

  function isSelector(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      document.createDocumentFragment().querySelector(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function numberOption(overrides, key) {
    return toNumber(overrides[key], toNumber(options[key], DEFAULTS[key]));
  }

  function listOption(overrides, key, list) {
    return oneOf(overrides[key], list, oneOf(options[key], list, DEFAULTS[key]));
  }

  // A link's own data-t-* attributes, or an options object passed to
  // cover/reveal/play, win over the page's default profile field by field.
  // `keep` adds up instead: what the call keeps and what the page keeps.
  function mergeProfile(overrides) {
    overrides = overrides || {};
    var keep = [];
    [overrides.keep, options.keep].forEach(function (sel) {
      if (isSelector(sel) && keep.indexOf(sel) === -1) keep.push(sel);
    });
    return {
      duration: Math.max(0, numberOption(overrides, 'duration')),
      easing: typeof overrides.easing === 'string' && overrides.easing ? overrides.easing
        : typeof options.easing === 'string' && options.easing ? options.easing : DEFAULTS.easing,
      motion: listOption(overrides, 'motion', MOTIONS),
      direction: listOption(overrides, 'direction', DIRECTIONS),
      order: listOption(overrides, 'order', ORDERS),
      stagger: clamp(numberOption(overrides, 'stagger'), 0, MAX_STAGGER),
      grouping: listOption(overrides, 'grouping', GROUPINGS),
      background: listOption(overrides, 'background', BACKGROUNDS),
      color: isColor(overrides.color) ? overrides.color : isColor(options.color) ? options.color : DEFAULTS.color,
      spin: clamp(numberOption(overrides, 'spin'), 0, 1),
      fade: clamp(numberOption(overrides, 'fade'), 0, 1),
      scale: clamp(numberOption(overrides, 'scale'), 0, 4),
      keep: keep.length ? keep.join(', ') : null,
    };
  }

  function datasetToOverrides(a) {
    var ds = a.dataset || {};
    return {
      duration: ds.tDuration,
      easing: ds.tEasing,
      motion: ds.tMotion,
      direction: ds.tDirection,
      order: ds.tOrder,
      stagger: ds.tStagger,
      grouping: ds.tGrouping,
      background: ds.tBackground,
      color: ds.tColor,
      spin: ds.tSpin,
      fade: ds.tFade,
      scale: ds.tScale,
      keep: ds.tKeep,
    };
  }

  // --- The two primitives every use is built from. Both resolve (never
  // reject) and tolerate being superseded mid-flight. If the page can't be
  // taken apart (something in it throws), it's left as it was. ---

  function cover(el, overrides) {
    var inst = instanceFor(el);
    var profile = mergeProfile(overrides);
    var myGen = ++inst.gen;

    if (prefersReducedMotion()) return Promise.resolve();

    inst.profile = profile;
    begin(inst, el);
    // A fresh cover lays out fresh pieces; one that interrupts a reveal
    // turns the pieces already in flight back around.
    try {
      if (!inst.pieces || inst.progress === 0) {
        prepare(inst, el, profile, resolveOrigin(el, overrides && overrides.from), false);
      }
      render(inst, inst.progress);
    } catch (e) {
      cleanupEl(el);
      return Promise.resolve();
    }
    return animateTo(inst, 1, myGen).then(function () {
      if (myGen !== inst.gen || isRootTarget(el)) return;
      // Emptied: the stage hides whatever is in it from here on, so the
      // pieces can go back to how they were, ready for a swap() to change
      // anything it likes.
      el.classList.add('t-teardown-covered');
      release(inst);
    });
  }

  function reveal(el, overrides) {
    var inst = instanceFor(el);
    var myGen = ++inst.gen;

    if (prefersReducedMotion()) {
      cleanupEl(el);
      return Promise.resolve();
    }

    var profile = overrides ? mergeProfile(overrides) : (inst.profile || options);
    inst.profile = profile;
    begin(inst, el);
    // Fully torn down (after a swap, on arrival, or called on its own with
    // nothing covered): build up whatever is there now, from off-screen.
    // Mid-flight: turn the pieces in flight back around. Keyed on pieces,
    // not on progress being 0: a cover() that hasn't drawn its first frame
    // yet is also at 0, and reversing that should do nothing.
    try {
      if (!inst.pieces || inst.progress >= 1) {
        var origin = overrides && overrides.origin && typeof overrides.origin === 'object'
          ? overrides.origin
          : resolveOrigin(el, overrides && overrides.from) || inst.origin;
        prepare(inst, el, profile, origin, true);
        inst.progress = 1;
      }
      render(inst, inst.progress);
    } catch (e) {
      cleanupEl(el);
      return Promise.resolve();
    }
    return animateTo(inst, 0, myGen).then(function () {
      if (myGen === inst.gen) cleanupEl(el);
    });
  }

  // --- Arrival: build up, only when this load was itself the far side of
  // an intercepted click. Runs at parse time so the page is blank before
  // any of it paints: the body is hidden (bar anything kept) and the page
  // is set to the blank color until DOMContentLoaded, when every piece is
  // laid out off-screen in the same frame the body is shown again. ---

  // The arriving page's own stylesheet: the body hidden, bar anything
  // kept, so a header that stayed on screen through the cover doesn't
  // blink on the way in. A <style> of this script's own rather than a
  // class on <html>, so a page script that resets <html>'s classes can't
  // show the page early. `:where`, so anything kept that the page itself
  // hides stays hidden.
  function setArrivalStyle(keep) {
    var style = document.getElementById(ARRIVE_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = ARRIVE_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = 'body{visibility:hidden!important;}' +
      ':where([data-teardown="keep"]' + (keep ? ',:is(' + keep + ')' : '') + '){visibility:visible;}';
  }

  function clearArrivalStyle() {
    var style = document.getElementById(ARRIVE_STYLE_ID);
    if (style) style.parentNode.removeChild(style);
  }

  var pending = readPending();
  var arriving = prefersReducedMotion() ? null : pending;
  var failsafe = null;
  if (arriving && arriving.profile && typeof arriving.profile === 'object') {
    var rootInst = instanceFor(root);
    rootInst.profile = mergeProfile(arriving.profile);
    setArrivalStyle(rootInst.profile.keep);
    activeElements.add(root);
    if (rootInst.profile.background !== 'stay') {
      setStyle(rootInst.stashes, root, 'background-color', rootInst.profile.color);
      setStyle(rootInst.stashes, root, 'background-image', 'none');
    }
    failsafe = setTimeout(function () {
      if (!arriving) return;
      arriving = null;
      cleanupEl(root);
    }, ARRIVAL_FAILSAFE);
  } else {
    arriving = null;
  }

  // Resolves after `ms` at most, however `promise` goes.
  function within(promise, ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
      Promise.resolve(promise).then(resolve, resolve);
    });
  }

  // What an arriving page waits for before building: fonts still loading
  // (text would reflow mid-flight), the images it shows first, and the
  // page's own `ready` hook, each for a limited time.
  function pageSettled() {
    var waits = [];
    if (document.fonts && document.fonts.status === 'loading') waits.push(document.fonts.ready);
    var W = global.innerWidth;
    var H = global.innerHeight;
    Array.prototype.forEach.call(document.images, function (img) {
      if (img.complete) return;
      var r = img.getBoundingClientRect();
      if (r.top > H || r.bottom < 0 || r.left > W || r.right < 0) return;
      if (img.loading === 'lazy' && !r.width && !r.height) return;
      waits.push(new Promise(function (resolve) {
        img.addEventListener('load', resolve);
        img.addEventListener('error', resolve);
      }));
    });
    var all = [within(Promise.all(waits), ASSET_WAIT)];
    if (typeof options.ready === 'function') {
      var hook;
      try {
        hook = options.ready();
      } catch (e) {
        hook = null;
      }
      all.push(within(hook, READY_WAIT));
    }
    return Promise.all(all);
  }

  function onReady() {
    if (!arriving) return;
    pageSettled().then(function () {
      var data = arriving;
      if (!data) return;
      arriving = null;
      clearTimeout(failsafe);
      var o = data.origin;
      var origin = o && isFinite(o.fx) && isFinite(o.fy)
        ? { x: o.fx * global.innerWidth, y: o.fy * global.innerHeight }
        : null;
      reveal(root, Object.assign({}, data.profile, { origin: origin }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // --- Departure: tear down, then hand off to the next page. ---
  var navigating = false;
  var stayTimer = null;
  var referrerMeta = null;

  function dropReferrerMeta() {
    if (referrerMeta && referrerMeta.parentNode) referrerMeta.parentNode.removeChild(referrerMeta);
    referrerMeta = null;
  }

  // A link's own referrer policy, which navigating by script would lose.
  function referrerPolicy(a) {
    var policy = a.getAttribute('referrerpolicy');
    if (policy) return policy;
    return /(^|\s)noreferrer(\s|$)/i.test(a.getAttribute('rel') || '') ? 'no-referrer' : null;
  }

  function coverThenNavigate(url, overrides, a) {
    var inst = instanceFor(root);
    navigating = true;
    var covered = cover(root, overrides);
    var myGen = inst.gen;
    covered.then(function () {
      if (myGen !== inst.gen) {
        navigating = false;
        return;
      }
      var g = inst.geom;
      var o = inst.origin && g ? { fx: inst.origin.x / g.W, fy: inst.origin.y / g.H } : null;
      setPending(inst.profile, o);
      var policy = a && referrerPolicy(a);
      if (policy) {
        referrerMeta = document.createElement('meta');
        referrerMeta.name = 'referrer';
        referrerMeta.content = policy;
        document.head.appendChild(referrerMeta);
      }
      // Still here a while later: the link didn't replace this page (a
      // download, a 204, a "leave this page?" that was cancelled), so put
      // it back together. The handoff is left in place: if the server was
      // only slow, the next page still builds in when it does arrive.
      stayTimer = setTimeout(function () {
        stayTimer = null;
        navigating = false;
        dropReferrerMeta();
        if (myGen !== inst.gen) return;
        reveal(root);
      }, STAY_WAIT);
      global.location.href = url;
    });
  }

  global.addEventListener('pagehide', function () {
    if (stayTimer) clearTimeout(stayTimer);
    stayTimer = null;
  });

  global.addEventListener('pageshow', function (event) {
    // Returning via bfcache can restore the DOM torn down or mid-flight;
    // put every still-active target back together.
    if (!event.persisted) return;
    navigating = false;
    // Back from the next page: the link's referrer policy was for that
    // one trip, not for every link on this page from now on.
    dropReferrerMeta();
    Array.from(activeElements).forEach(cleanupEl);
  });

  // The link a click landed in, looking through shadow roots too.
  function linkFor(event) {
    var path = event.composedPath ? event.composedPath() : [];
    if (!path.length) {
      for (var n = event.target; n; n = n.parentNode) path.push(n);
    }
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!node || node.nodeType !== 1) continue;
      try {
        if (node.matches(options.selector)) return node;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // Where a link goes, if it's one to take over: a same-origin page
  // opening in this tab, not a hash on this page. Works for SVG links too,
  // whose href isn't a string.
  function destination(a) {
    if (!a || a.hasAttribute('data-no-transition') || a.hasAttribute('download')) return null;
    var target = a.getAttribute('target');
    if (target === null) {
      var base = document.querySelector('base[target]');
      target = base ? base.getAttribute('target') : '';
    }
    if (target && target !== '_self') return null;
    var raw = typeof a.href === 'string' ? a.href : a.href && a.href.baseVal;
    if (!raw) return null;
    var url;
    try {
      url = new URL(raw, document.baseURI);
    } catch (e) {
      return null;
    }
    var here = global.location;
    if (url.protocol !== here.protocol || url.origin !== here.origin) return null;
    if (!/^(https?|file):$/.test(url.protocol)) return null;
    // Any hash on this same page, including a bare "#": leave it to the
    // browser, which won't leave the page.
    if (url.href.indexOf('#') !== -1 && url.href.split('#')[0] === here.href.split('#')[0]) return null;
    return url.href;
  }

  // On the window, as the click finishes bubbling, so any handler of the
  // page's own (a client-side router) has had its say first.
  global.addEventListener('click', function (event) {
    if (!options.selector) return; // navigation is off until a page sets one
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = linkFor(event);
    var url = destination(a);
    if (!url) return;
    event.preventDefault();
    if (navigating) return; // one already on its way
    var overrides = datasetToOverrides(a);
    overrides.from = { x: event.clientX, y: event.clientY, element: a };
    // A keyboard-activated link reports 0,0: start from the link instead.
    if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) overrides.from = a;
    coverThenNavigate(url, overrides, a);
  });

  global.Transitions[NAME] = {
    // Merges new options into the page-wide default profile. Every field
    // is read at cover/reveal time, so this can't stomp an arriving reveal.
    configure: function (opts) {
      Object.assign(options, opts || {});
      // An arriving page shows what it keeps from the first paint: what
      // it's just said to keep, on top of what the last page kept.
      if (arriving && document.getElementById(ARRIVE_STYLE_ID)) {
        setArrivalStyle(mergeProfile(arriving.profile).keep);
      }
    },
    // Flies everything in `el` (any element with class="t-el", or
    // document.documentElement) off, resolving once it's empty. Leaves
    // `el` torn down — pair with reveal().
    cover: cover,
    // Flies everything in `el` back in, resolving once it's landed and
    // cleaned up.
    reveal: reveal,
    // Cover el, run options.swap(el) (may return a promise) once it's
    // empty, then reveal whatever is there now. A stale play() superseded
    // mid-cover skips its swap and reveal, leaving them to the newer call.
    play: function (el, overrides) {
      overrides = overrides || {};
      var inst = instanceFor(el);
      var coverPromise = cover(el, overrides);
      var myGen = inst.gen;
      return coverPromise.then(function () {
        if (inst.gen !== myGen) return;
        // A swap that fails still gets the element back, showing whatever
        // it holds now, before the failure is passed on.
        return Promise.resolve().then(function () {
          return overrides.swap ? overrides.swap(el) : undefined;
        }).then(function () {
          if (inst.gen !== myGen) return;
          return reveal(el, overrides);
        }, function (err) {
          if (inst.gen !== myGen) throw err;
          return reveal(el, overrides).then(function () { throw err; });
        });
      });
    },
  };
})(window, document);
