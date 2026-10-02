/**
 * Flip Dots — camera mirror
 * --------------------------
 * The whole of this page's relationship with the component is one call:
 *
 *   board.play(() => FlipDots.imageGrid(video, board.cols, board.rows, …))
 *
 * play() asks a function for a frame on a clock; imageGrid() turns anything
 * drawable into the (x, y) => state accessor the board writes from. Neither
 * knows what a camera is, and this file is almost entirely the parts that
 * do: asking for the device, reporting what happened when the answer is no,
 * and releasing it again.
 *
 * Nothing here uploads, records or keeps a frame. getUserMedia hands over a
 * MediaStream, the <video> decodes it, imageGrid draws the current frame
 * into a canvas the size of the grid and reads the luminance back out, and
 * that canvas is overwritten by the next frame. Stop releases the track.
 */
document.addEventListener('DOMContentLoaded', () => {
  // flip-dots.js's own auto-init has already claimed the board by now (its
  // DOMContentLoaded listener is registered first, since this file loads
  // after it) — this is the same defensive fallback the demo page uses.
  FlipDots.initAll();

  const board = FlipDots.get('#miBoard');
  if (!board) return;

  // ---- looks ----------------------------------------------------------
  // Each palette runs dark to light, because that is the order imageGrid
  // maps brightness onto: level 0 is the darkest state. A palette in some
  // other order would be remapped with its `states` option rather than
  // reordered here.
  const PALETTES = {
    mono: { background: '#0c0d10', palette: ['#1b1e24', '#f0ece2'] },
    amber: { background: '#07070a', palette: ['#141210', '#ffb01f'] },
    // State 0 is the page's own white with no rim, so the dark half of the
    // picture is the only half that exists — the image draws itself onto
    // blank paper.
    paper: { background: '#ffffff', palette: ['#ffffff', '#111111'] },
    // Four levels rather than two. Worth a look mostly for what it shows
    // about dithering: with real mid-tones available the pattern thins out
    // dramatically, because there is less gray left to fake.
    grays: {
      background: '#0c0d10',
      palette: ['#15181d', '#4b525c', '#9aa1a9', '#f0ece2'],
    },
  };

  // Dot size, not column count: the grid follows the element's box, so
  // asking in pixels keeps the choices comparable across window widths in a
  // way a fixed column count would not.
  //
  // `detail` sits on the component's own floor of 5px, which is where the
  // squash that carries a flip stops being legible - it happens inside one
  // or two device pixels below that. Asking for less is not finer: the
  // component honours the floor by thinning the GRID rather than by drawing
  // dots too small to read, so a request of 4 comes back as a coarser board
  // with 5px dots than this one is.
  const RESOLUTIONS = { coarse: 20, medium: 12, fine: 7, detail: 5 };

  // How many colors "Match the camera" clusters the frame down to, and how
  // often it re-clusters. Six is where a room starts reading as itself
  // rather than as a tint; past about eight the discs stop being
  // distinguishable from each other at dot size and the board just looks
  // noisy. The interval is in frames rather than milliseconds so it is tied
  // to playback - a paused or off-screen board stops re-clustering too.
  const LIVE_COLORS = 6;
  const PALETTE_EVERY = 20;

  // How far a clustered color has to move before the board adopts the new
  // palette, in RGB distance. Sensor noise walks a cluster center around by
  // a unit or two between frames even when nothing in the room has moved,
  // and adopting that walk means the match boundaries shift and a scatter
  // of discs turns over for nothing. Below this the previous palette is
  // kept as-is - the same array, so the next frame matches against
  // identical numbers and flips nothing at all.
  const PALETTE_DEADBAND = 7;

  // Loud enough to hear the board work, quiet enough to leave on. A mirror
  // at 20fps is a few hundred flips a second, and the component collapses
  // those into a handful of voices per 12ms window - so this is a clatter
  // rather than a roar, but it is still the noisiest thing on the site.
  const SOUND_VOLUME = 0.3;

  // Fast and tight — a mirror wants the shortest flip the discs will give
  // without losing the overshoot that makes them read as mechanical.
  board.update({
    // Four grays rather than two: a camera is continuous tone, and a real
    // mid-gray is worth more to a face than any amount of dithering across
    // a two-state ramp. The dither pattern visibly thins out next to the
    // mono palette, because there is that much less gray left to fake.
    ...PALETTES.grays,
    dotSize: RESOLUTIONS.medium,
    gap: 0.2,
    flipDuration: 110,
    bounce: 0.5,
    jitter: 0.25,
    transition: 'instant',
    // Set up front so the Sound button only ever has to flip `sound` -
    // volume is read at the moment each click sounds, so holding it here
    // costs nothing while sound is off.
    volume: SOUND_VOLUME,
  });

  // A board playing a camera at 20fps is already turning a few hundred
  // discs a second; a transition on top of that would be choreography
  // nobody can see. 20 against a 110ms flip is deliberately past what the
  // discs can finish — see the note on the page.
  const FPS = 20;

  const controls = {
    toggle: document.getElementById('miToggle'),
    freeze: document.getElementById('miFreeze'),
    res: document.getElementById('miRes'),
    palette: document.getElementById('miPalette'),
    dither: document.getElementById('miDither'),
    sound: document.getElementById('miSound'),
    fullscreen: document.getElementById('miFullscreen'),
  };
  const statusEl = document.getElementById('miStatus');
  const readout = document.getElementById('miReadout');

  // ---- the board as a sign --------------------------------------------
  // Every state this page can be in says so on the board itself, in the
  // component's own font. Trimmed to what the grid holds, since the grid is
  // measured against the viewport and a message wider than the board would
  // be clipped at both ends and read as nonsense.
  // Remembered so a control change with no camera running can put the same
  // sign back up rather than inventing a new one.
  let sign = '';

  function say(message, opts) {
    sign = String(message);
    const glyph = FlipDots.font.width + 1;
    const fits = Math.max(1, Math.floor((board.cols + 1) / glyph));
    board.text(sign.slice(0, fits), {
      spacing: 1,
      // The brightest state rather than state 1. On a two-color palette
      // they are the same thing; on the four-gray one, or on six colors
      // clustered out of a dim room, state 1 is a shade barely off the
      // unlit panel and the message would be unreadable.
      on: board.options.palette.length - 1,
      off: 0,
      ...opts,
    });
  }

  function setStatus(text, state) {
    statusEl.textContent = text;
    if (state) statusEl.dataset.state = state;
    else delete statusEl.dataset.state;
  }

  // ---- the frame source -----------------------------------------------
  // Hidden but kept in the document: a <video> taken out of the page, or
  // display:none'd, is not guaranteed to keep decoding, and a frame that
  // never decodes is a board that never updates.
  const video = document.createElement('video');
  video.className = 'mi-source';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  document.body.appendChild(video);

  let stream = null;
  // Whether the visitor asked for a still. Tracked here rather than read
  // back off `board.playing`, which is also false while the board is
  // scrolled out of view — the component holds the clock then on its own,
  // and the Freeze button is about intent, not about the clock.
  let frozen = false;
  let frames = 0;
  let countedFrom = 0;
  let measured = 0;
  // The palette clustered out of the camera itself, or null when the
  // palette control names a fixed one - and also when it names the live one
  // but no frame has been clustered yet. So this answers "is the board
  // showing the room's colors", which is the question the frame source and
  // the readout are asking, and never "was the live palette asked for".
  let livePalette = null;

  // That second question, which is the control's to answer rather than
  // livePalette's. Keeping them apart matters because the first clustering
  // attempt can come back empty - a camera that has started but not yet
  // decoded a frame has nothing to cluster - and gating the re-clustering
  // on livePalette would then latch it off for the whole session.
  function wantsLivePalette() {
    return controls.palette.value === 'live';
  }

  // This is the demo. Everything above and below it is plumbing.
  //
  // Read live rather than captured: the dither control and the palette's
  // length are looked up per frame, so changing either takes effect on the
  // next one with nothing to re-register. imageGrid returns null until the
  // video actually has pixels, and play() reads null as "hold what is up",
  // so there is no readyState check to get wrong.
  function frame() {
    return FlipDots.imageGrid(video, board.cols, board.rows, {
      // Two different questions, and which one is being asked is the whole
      // of the palette control. `match` sends each cell to the nearest of
      // the camera's own colors; `levels` sends it to a step on the
      // board's brightness ramp. The second takes autoLevels because a ramp
      // can be stretched; the first has nothing to stretch - the colors
      // came out of this frame already.
      ...(livePalette
        ? { match: livePalette }
        : { levels: board.options.palette.length, autoLevels: true }),
      dither: controls.dither.value,
      // A mirror mirrors. Anything else and raising your left hand moves
      // the wrong side of the board.
      mirror: true,
    });
  }

  // Mixes a color toward black, for the panel behind a clustered palette:
  // the unlit board should sit under the darkest disc rather than beside
  // it, or the darkest state reads as a hole rather than as a shadow.
  function darken(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const channel = (shift) => Math.round(((n >> shift) & 255) * (1 - amount));
    const two = (v) => v.toString(16).padStart(2, '0');
    return `#${two(channel(16))}${two(channel(8))}${two(channel(0))}`;
  }

  // True when every color is within the deadband of where it already was,
  // i.e. the room has not actually changed color since the last look.
  function paletteSettled(next) {
    if (!livePalette || livePalette.length !== next.length) return false;
    return next.every((hex, i) => {
      const a = parseInt(hex.slice(1), 16);
      const b = parseInt(livePalette[i].slice(1), 16);
      return Math.hypot(
        ((a >> 16) & 255) - ((b >> 16) & 255),
        ((a >> 8) & 255) - ((b >> 8) & 255),
        (a & 255) - (b & 255),
      ) < PALETTE_DEADBAND;
    });
  }

  // Re-clusters the frame and repaints the board in its own colors.
  // Seeded with the palette already up: an unseeded run lands on an equally
  // good but differently ordered answer each time, and a board that
  // re-colors itself every second for no reason the room gave it reads as
  // broken rather than as live.
  function refreshPalette() {
    const next = FlipDots.imagePalette(video, LIVE_COLORS, {
      mirror: true,
      // Seeded with what is already up, which is what keeps cluster i
      // meaning the same color from one look to the next - and so what
      // keeps a dot's state meaning the same thing.
      seed: livePalette,
    });
    if (!next || paletteSettled(next)) return;
    livePalette = next;
    // A palette change only recolors - no dot is asked to flip - so this
    // lands as the board shifting hue under a picture that keeps playing.
    board.update({ palette: next, background: darken(next[0], 0.45) });
  }

  function syncReadout() {
    const grid = `${board.cols} × ${board.rows} · ${board.length} dots`;
    if (!stream) {
      readout.textContent = `${grid} · ${board.dotPx.toFixed(1)}px dots`;
      return;
    }
    // The measured rate rather than the one asked for, which is the honest
    // figure: play() drops frames rather than queueing them, so a board
    // that cannot keep up says so here instead of quietly falling behind.
    const rate = frozen ? 'frozen' : `${(measured || FPS).toFixed(1)} fps`;
    const color = livePalette
      ? `${livePalette.length} colors matched from the frame`
      : `${board.options.palette.length} states`;
    readout.textContent = `${grid} · ${rate} of ${FPS} asked · `
      + `${controls.dither.value} dither · ${color}`;
  }

  setInterval(() => {
    if (!stream) return;
    const now = performance.now();
    const elapsed = now - countedFrom;
    if (elapsed > 0) measured = (frames * 1000) / elapsed;
    frames = 0;
    countedFrom = now;
    syncReadout();
  }, 1000);

  // ---- starting and stopping -------------------------------------------
  function describeError(err) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return ['BLOCKED', 'Camera access was refused. Allow it for this site in the '
          + 'browser’s address-bar permissions, then try again.'];
      case 'NotFoundError':
      case 'OverconstrainedError':
        return ['NO CAMERA', 'No camera was found on this device.'];
      case 'NotReadableError':
        return ['IN USE', 'The camera is there but another application is holding it.'];
      default:
        return ['ERROR', `The camera could not be started: ${(err && err.message) || err}.`];
    }
  }

  function setPlayingUI(on) {
    controls.toggle.textContent = on ? 'Stop camera' : 'Start camera';
    controls.freeze.disabled = !on;
    controls.freeze.textContent = 'Freeze';
    controls.freeze.setAttribute('aria-pressed', 'false');
    frozen = false;
  }

  async function start() {
    // getUserMedia is not exposed at all outside a secure context, so say
    // so rather than letting it fail with something less specific.
    if (!window.isSecureContext) {
      setStatus('A camera is only offered to pages served over HTTPS (or from localhost).', 'error');
      say('NO HTTPS', { transition: 'wipe' });
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser does not offer a camera to pages.', 'error');
      say('NO CAMERA', { transition: 'wipe' });
      return;
    }

    controls.toggle.disabled = true;
    setStatus('Waiting for permission…');
    say('ALLOW', { transition: 'ripple', duration: 500 });

    try {
      // A modest request: the frame is about to be averaged down to a few
      // thousand dots, so asking for more pixels than that would only make
      // the decode and the downscale more expensive for a picture nobody
      // ever sees at full size.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      // Not named `sign`: that is the outer variable say() writes, and
      // shadowing it here would read as an assignment to it.
      const [signText, message] = describeError(err);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
      controls.toggle.disabled = false;
      setStatus(message, 'error');
      say(signText, { transition: 'wipe' });
      return;
    }

    frames = 0;
    measured = 0;
    countedFrom = performance.now();
    if (wantsLivePalette()) refreshPalette();
    board.play(frame, {
      fps: FPS,
      onFrame: (i) => {
        frames++;
        // Counted in frames rather than run off its own timer, so a paused
        // or scrolled-away board stops re-clustering along with everything
        // else instead of quietly working in the background. This is also
        // what recovers from a first attempt that found no frame to cluster:
        // the next beat round simply tries again.
        if (wantsLivePalette() && i % PALETTE_EVERY === 0) refreshPalette();
      },
    });

    controls.toggle.disabled = false;
    setPlayingUI(true);
    // The button sits above the board, and on a short window the board can
    // be far enough down that the component holds its own clock for being
    // off screen - so the camera would appear to do nothing until you
    // scrolled. Bring it to the visitor instead.
    board.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const track = stream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    setStatus(`Live${settings.width ? ` from a ${settings.width}×${settings.height} camera` : ''} `
      + '— nothing is being uploaded or recorded.');
    syncReadout();
  }

  function stop() {
    board.stop();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    measured = 0;
    setPlayingUI(false);
    setStatus('Camera off and released.');
    // The last frame is still up, so writing the sign over it lets the
    // picture dissolve into a word rather than cutting to it.
    say('OFF', { transition: 'random', duration: 900 });
    syncReadout();
  }

  controls.toggle.addEventListener('click', () => {
    if (stream) stop();
    else start();
  });

  // pause() holds the clock and leaves the frame that is up on the board,
  // which on a mirror is a still photograph made of discs. The camera keeps
  // running underneath, so resuming picks up live rather than where it left
  // off — the frame index of a live source is a count, not a position.
  controls.freeze.addEventListener('click', () => {
    frozen = !frozen;
    controls.freeze.textContent = frozen ? 'Live' : 'Freeze';
    controls.freeze.setAttribute('aria-pressed', String(frozen));
    if (frozen) {
      board.pause();
      setStatus('Frozen on the last frame. The camera is still open.');
    } else {
      board.resume();
      setStatus('Live — nothing is being uploaded or recorded.');
    }
  });

  // ---- the three controls ---------------------------------------------
  controls.res.addEventListener('change', () => {
    // A grid change re-measures and resamples what is on the board, so a
    // frozen or stopped picture survives the switch instead of blanking.
    board.update({ dotSize: RESOLUTIONS[controls.res.value] });
    syncReadout();
  });

  controls.palette.addEventListener('change', () => {
    if (wantsLivePalette()) {
      // Clustering needs a frame to cluster. With no camera there is
      // nothing to read, so the control is honoured but the board stays on
      // a fixed palette until one arrives — and says so.
      if (stream) {
        refreshPalette();
      } else {
        livePalette = null;
        setStatus('Matching the camera’s colors needs a camera. Start one and the '
          + 'palette will be clustered out of what it sees.');
      }
    } else {
      livePalette = null;
      board.update(PALETTES[controls.palette.value]);
    }
    // A running board picks the new palette up on its own next frame. With
    // no camera there is no next frame, so the sign has to be written
    // again — the same sign, not a new one, since nothing else changed.
    if (!stream) say(sign, { transition: 'instant' });
    syncReadout();
  });

  controls.dither.addEventListener('change', syncReadout);

  // ---- sound ----------------------------------------------------------
  // Off until asked for, and the asking is the point: a component that
  // starts making noise in someone else's page has to be invited. The
  // click is also the gesture the AudioContext needs, which is why this
  // calls enableSound() rather than update({ sound: true }) — waiting for
  // the next gesture would swallow everything the board does in between.
  let soundOn = false;

  controls.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    if (soundOn) board.enableSound();
    else board.update({ sound: false });
    controls.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
    controls.sound.setAttribute('aria-pressed', String(soundOn));
  });

  // ---- fullscreen -------------------------------------------------------
  // The board alone goes fullscreen, not the page around it: the controls
  // are scaffolding for the board, and a mirror filling a screen is the
  // thing this page is for. Esc comes back, which every browser enforces
  // itself and no page can take away.
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncFullscreen() {
    const on = fullscreenElement() === board.el;
    controls.fullscreen.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
    controls.fullscreen.setAttribute('aria-pressed', String(on));
  }

  controls.fullscreen.addEventListener('click', () => {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    const request = board.el.requestFullscreen || board.el.webkitRequestFullscreen;
    if (!request) {
      setStatus('This browser will not let the page go fullscreen.', 'error');
      return;
    }
    // Rejects when the gesture isn't accepted or the browser declines —
    // reported rather than swallowed, since the button visibly did nothing.
    Promise.resolve(request.call(board.el)).catch((err) => {
      setStatus(`Fullscreen was refused: ${(err && err.message) || err}`, 'error');
    });
  });

  // Both spellings: Safari still fires only the prefixed one.
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((name) => {
    document.addEventListener(name, syncFullscreen);
  });

  // The grid is measured off the element's own box, so the readout has to
  // follow that box rather than the window: going fullscreen changes one
  // without the other, and a window resize changes the box a beat after the
  // event. Watching the element covers both, and watching it with a
  // ResizeObserver rather than reading after the event is what makes the
  // numbers current — the component re-measures in its own observer, and
  // observers are called in construction order, so this one (built here,
  // after the component claimed the element) always sees the new grid.
  // Reading synchronously in a resize or fullscreenchange handler instead
  // reports the grid the board has just stopped having.
  new ResizeObserver(syncReadout).observe(board.el);

  say('MIRROR', { transition: 'ripple', duration: 700 });
  syncFullscreen();
  syncReadout();
});
