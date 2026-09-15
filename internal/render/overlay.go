package render

import (
	"bytes"
	"io/fs"
	"time"
)

// overlayFS serves rendered bytes at a fixed set of paths and falls
// through to base for everything else (CSS, JS, images, and any file not
// produced by this package). The stdlib has no ready-made "override some
// paths in an fs.FS" helper, hence this small one.
type overlayFS struct {
	base  fs.FS
	pages map[string][]byte
}

func (o overlayFS) Open(name string) (fs.File, error) {
	if data, ok := o.pages[name]; ok {
		return &renderedFile{name: name, r: bytes.NewReader(data), size: int64(len(data))}, nil
	}
	return o.base.Open(name)
}

// renderedFile implements fs.File (plus Seek, so Range requests behave
// the same as they do for real embedded files) over an in-memory page.
type renderedFile struct {
	name string
	r    *bytes.Reader
	size int64
}

func (f *renderedFile) Read(p []byte) (int, error)                   { return f.r.Read(p) }
func (f *renderedFile) Seek(offset int64, whence int) (int64, error) { return f.r.Seek(offset, whence) }
func (f *renderedFile) Close() error                                 { return nil }
func (f *renderedFile) Stat() (fs.FileInfo, error)                   { return renderedFileInfo{f}, nil }

type renderedFileInfo struct{ f *renderedFile }

func (i renderedFileInfo) Name() string       { return i.f.name }
func (i renderedFileInfo) Size() int64        { return i.f.size }
func (i renderedFileInfo) Mode() fs.FileMode  { return 0o444 }
func (i renderedFileInfo) ModTime() time.Time { return time.Time{} }
func (i renderedFileInfo) IsDir() bool        { return false }
func (i renderedFileInfo) Sys() any           { return nil }
