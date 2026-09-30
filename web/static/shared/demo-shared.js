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
 *
 * applyProfileFromTable - the "Profile" preset pattern several demo pages
 * share: pushes a named preset's values into the same controls/inputs a
 * visitor could set by hand, one pass over the same `numeric` table (plus
 * optional `toggles`/`directs`) the page's own input listeners use, then
 * returns the options object to hand to the effect's `update()`. See any
 * caller (e.g. concepts/spotlight/demo.js, carousel/sweep/demo.js) for the
 * `numeric` table shape: `[controlKey, optionKey, transform?]`.
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

  // Reads a range input back after assignment rather than trusting the
  // profile's own number: a range input snaps whatever it's given to its
  // own min/step grid, and applying the unsnapped value would leave the
  // slider reading one thing while the effect ran on another.
  function applyProfileFromTable({ profile, controls, numeric, toggles = [], directs = [] }) {
    const options = {};
    numeric.forEach(([key, option, transform]) => {
      controls[key].value = profile[key];
      const value = Number(controls[key].value);
      options[option] = transform ? transform(value) : value;
    });
    toggles.forEach((key) => {
      controls[key].checked = profile[key];
      options[key] = profile[key];
    });
    directs.forEach((key) => {
      controls[key].value = profile[key];
      options[key] = profile[key];
    });
    return options;
  }

  global.hexToRgbString = hexToRgbString;
  global.loadSessionJSON = loadSessionJSON;
  global.setColorInputValue = setColorInputValue;
  global.applyProfileFromTable = applyProfileFromTable;
})(window);
