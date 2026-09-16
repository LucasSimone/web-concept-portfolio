// Package render turns per-page HTML fragments into full pages at server
// startup, using one shared layout for the boilerplate every page repeats
// (head essentials, nav, and — where present — the controls-panel box and
// header). Per-page content (title, fonts, demo markup, the controls
// panel's actual sliders/inputs) stays exactly as authored, untouched.
package render

import "html/template"

// page is the data a single page's fragments are rendered against.
type page struct {
	// Head is whatever this page's <head> needs beyond the universal
	// boilerplate: <title>, font links, its own stylesheet, an inline
	// <style> block. Empty for none of these.
	Head template.HTML
	// Controls is the content inside this page's controls panel — the
	// actual sliders/inputs, left exactly as authored. Empty means this
	// page has no controls panel at all.
	Controls template.HTML
	// ControlsAttr is any extra attribute on the <aside class="controls">
	// tag (e.g. ` data-drive-mode="scroll"`, including the leading
	// space), or empty. Only meaningful when Controls is non-empty.
	ControlsAttr template.HTMLAttr
	// Body is everything from after </nav> (or after the controls panel,
	// when present) through just before </body>.
	Body template.HTML
}

// layoutSrc is the shared shell every page is rendered into. The
// universal <script>/<link> tags are unconditional because each of the
// scripts they load already no-ops safely when its target element isn't
// on the page (verified in shared/controls-toggle.js, docs-nav.js, and
// docs-copy.js).
const layoutSrc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/shared/site.css" />
  <script src="/shared/effects-manifest.js"></script>
  <script src="/shared/nav.js"></script>
  <script src="/shared/controls-toggle.js"></script>
  <script src="/shared/docs-nav.js"></script>
  <script src="/shared/docs-copy.js"></script>
  <script>
    // Sitewide defaults for every transition effect, keyed by its own
    // slug (each effect's script reads window.TransitionConfig[slug]
    // and registers itself at window.Transitions[slug], so multiple
    // effects can be loaded on the same page without colliding). Default
    // here is opt-in-only: an effect only triggers on a link explicitly
    // tagged data-t-transition="<slug>". Every page still loads every
    // effect's script regardless, so arriving here from a page that DID
    // trigger one (e.g. a demo page, which widens its own selector to
    // "a[href]") plays that effect's reveal.
    //
    // Adding a new transition effect: add its slug/selector below,
    // and its <script src> underneath the others.
    window.TransitionConfig = {
      shutter: { selector: '[data-t-transition="shutter"]' },
      aperture: { selector: '[data-t-transition="aperture"]' },
    };
  </script>
  <script src="/transitions/shutter/shutter.js"></script>
  <script src="/transitions/aperture/aperture.js"></script>
{{.Head}}</head>
<body>
  <nav class="site-nav">
    <a class="brand" href="/index.html">Web Lab</a>
    <div class="links"></div>
  </nav>
{{if .Controls}}
  <aside class="controls"{{.ControlsAttr}}>
    <h2>Controls</h2>
{{.Controls}}  </aside>
{{end}}{{.Body}}</body>
</html>
`

var layout = template.Must(template.New("layout").Parse(layoutSrc))

// htmlOf and attrOf mark trusted, already-authored HTML/attribute bytes
// as safe to insert verbatim, bypassing html/template's autoescaping
// (which exists to protect against untrusted input — not a concern for
// content we just read out of our own embedded static tree).
func htmlOf(b []byte) template.HTML     { return template.HTML(b) }
func attrOf(s string) template.HTMLAttr { return template.HTMLAttr(s) }
