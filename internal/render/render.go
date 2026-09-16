package render

import (
	"bytes"
	"fmt"
	"io/fs"
	"strings"
)

// controlsAttrOverrides holds the handful of pages whose <aside
// class="controls"> tag carries an extra attribute read by that page's
// own JS. Everyone else gets none. Small enough to hardcode rather than
// invent a per-page metadata file for two data points.
var controlsAttrOverrides = map[string]string{
	"text-effects/rolodex/index.html":             ` data-drive-mode="scroll"`,
	"text-effects/type-pan-horizontal/index.html": ` data-drive-mode="scroll"`,
	"text-effects/triple-vision/index.html":       ` data-mode="scroll"`,
}

const headSuffix = ".head.html"

// Render finds every page in staticFS (identified by a "<name>.head.html"
// fragment) and renders it against the shared layout, returning an fs.FS
// that serves the rendered page at "<name>.html" and falls through to
// staticFS unchanged for everything else.
func Render(staticFS fs.FS) (fs.FS, error) {
	pages := make(map[string][]byte)

	err := fs.WalkDir(staticFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, headSuffix) {
			return nil
		}

		stem := strings.TrimSuffix(p, headSuffix)
		realPath := stem + ".html"

		head, err := fs.ReadFile(staticFS, p)
		if err != nil {
			return fmt.Errorf("read %s: %w", p, err)
		}
		body, err := fs.ReadFile(staticFS, stem+".body.html")
		if err != nil {
			return fmt.Errorf("%s: missing body fragment: %w", realPath, err)
		}

		pg := page{
			Head: htmlOf(head),
			Body: htmlOf(body),
		}

		if controls, err := fs.ReadFile(staticFS, stem+".controls.html"); err == nil {
			pg.Controls = htmlOf(controls)
			pg.ControlsAttr = attrOf(controlsAttrOverrides[realPath])
		}

		var buf bytes.Buffer
		if err := layout.Execute(&buf, pg); err != nil {
			return fmt.Errorf("render %s: %w", realPath, err)
		}
		pages[realPath] = buf.Bytes()
		return nil
	})
	if err != nil {
		return nil, err
	}

	return overlayFS{base: staticFS, pages: pages}, nil
}

// Live returns an fs.FS that re-renders staticFS on every Open call instead
// of once up front, so edits to files on disk (head/body fragments, CSS, JS)
// show up on the next browser refresh with no server restart. Meant for
// local dev only: staticFS should be an os.DirFS in that case, and the
// re-render cost (trivial for this site's page count) is paid per request.
func Live(staticFS fs.FS) fs.FS {
	return liveFS{base: staticFS}
}

type liveFS struct{ base fs.FS }

func (l liveFS) Open(name string) (fs.File, error) {
	rendered, err := Render(l.base)
	if err != nil {
		return nil, err
	}
	return rendered.Open(name)
}
