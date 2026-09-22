/**
 * Demo shared helpers
 * --------------------
 * Small utilities reused across multiple effect demo.js control panels.
 *
 * hexToRgbString - converts a `#rrggbb` color picker value into the
 * `"r, g, b"` string form canvas effects interpolate into `rgba(...)` fill
 * strings.
 *
 * loadSessionJSON - reads and JSON-parses a sessionStorage key, returning
 * null if it's missing or malformed instead of throwing.
 *
 * setColorInputValue - assigns a saved hex value to a `<input type="color">`
 * only if it's a full `#rrggbb` string. Browsers silently reset the input to
 * black on anything else (e.g. a shorthand `#fff`), so this leaves the
 * input's current value alone rather than risk that.
 */
(function (global) {
  function hexToRgbString(hex) {
    const value = hex.replace('#', '');
    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  function loadSessionJSON(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }

  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  function setColorInputValue(input, hex) {
    if (HEX_COLOR_RE.test(hex)) input.value = hex;
  }

  global.hexToRgbString = hexToRgbString;
  global.loadSessionJSON = loadSessionJSON;
  global.setColorInputValue = setColorInputValue;
})(window);
