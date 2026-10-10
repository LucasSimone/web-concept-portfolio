package jsprint

import (
	"bytes"
	"fmt"
	"math/rand/v2"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

var (
	testKey = Key("test key")
	testRef = Ref{Time: time.Date(2026, 10, 10, 15, 52, 0, 0, time.UTC), Build: 0xcc}
	from    = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	now     = time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
)

func TestSealOpen(t *testing.T) {
	v := testKey.Seal(testRef)
	if v>>RefBits != 0 {
		t.Fatalf("sealed value %x wider than %d bits", v, RefBits)
	}
	if got, ok := testKey.Open(v); !ok || got != testRef {
		t.Errorf("Open(Seal(r)) = %v, %v; want %v", got, ok, testRef)
	}
	if _, ok := Key("other key").Open(v); ok {
		t.Error("opened with the wrong key")
	}
	parsed, err := ParseCode(strings.ToLower(Code(v)))
	if err != nil || parsed != v {
		t.Errorf("ParseCode(Code(%x)) = %x, %v", v, parsed, err)
	}
}

// stripComments removes every comment, leaving just the code.
func stripComments(src []byte) []byte {
	var out []byte
	last := 0
	for _, c := range Comments(src) {
		out = append(out, src[last:c[0]]...)
		last = c[1]
	}
	return append(out, src[last:]...)
}

func stamped(t *testing.T, path string) (orig, marked []byte) {
	t.Helper()
	orig, err := os.ReadFile("../../web/static/" + path)
	if err != nil {
		t.Fatal(err)
	}
	return orig, testKey.Stamp(orig, "Test Owner", "example.com/"+path, testRef)
}

var files = []string{
	"components/flip-dots/flip-dots.js", // large
	"carousel/sweep/sweep.js",           // medium
	"background/gravity-well/gravity-well.js",
	"text-effects/double-speak/double-speak.js", // fewest comment gaps of any download
	"text-effects/wave-form/wave-form.js",       // next fewest
}

func literals(b []byte) (out []string) {
	for _, l := range Literals(b) {
		out = append(out, string(b[l[0]:l[1]]))
	}
	return out
}

// TestStampChangesOnlyWhitespace pins the promise that a stamped file
// runs exactly like the original: every string and template literal is
// byte-for-byte the same, and outside comments nothing differs but
// trailing spaces.
func TestStampChangesOnlyWhitespace(t *testing.T) {
	trimLines := func(b []byte) []byte {
		lines := bytes.Split(b, []byte("\n"))
		for i, l := range lines {
			lines[i] = bytes.TrimRight(l, " ")
		}
		return bytes.Join(lines, []byte("\n"))
	}
	for _, f := range files {
		orig, marked := stamped(t, f)
		body := marked[bytes.IndexByte(marked, '\n')+1:] // past the notice
		if !bytes.Equal(stripComments(trimLines(orig)), stripComments(trimLines(body))) {
			t.Errorf("%s: stamping changed code outside comments and trailing space", f)
		}
		if !slices.Equal(literals(orig), literals(body)) {
			t.Errorf("%s: stamping changed a string or template literal", f)
		}
		if bytes.Equal(orig, body) {
			t.Errorf("%s: nothing hidden", f)
		}
		if !bytes.HasPrefix(marked, []byte("/*! example.com/"+f+" - by Test Owner. Downloaded 2026-10-10 15:52 UTC, ref ")) {
			t.Errorf("%s: notice missing or malformed: %.120s", f, marked)
		}
	}
}

// A trailing space on a line that ends inside a template literal would
// change the string, so those lines must never carry one.
func TestNoTrailingSpaceInsideLiterals(t *testing.T) {
	src := []byte("const css = `\n  .a { color: red; }\n  .b { color: blue; }\n`;\nconst s = 'one \\\ntwo';\nfoo();\n")
	for i := range 20 {
		marked := Key(fmt.Sprint(i)).Stamp(src, "O", "s", testRef)
		body := marked[bytes.IndexByte(marked, '\n')+1:]
		if !slices.Equal(literals(src), literals(body)) {
			t.Fatalf("key %d: literal lines touched:\n%q", i, body)
		}
	}
}

func TestReadBack(t *testing.T) {
	for _, f := range files {
		_, marked := stamped(t, f)
		rd := testKey.Read(marked, from, now)
		if !rd.NoticeOK || rd.NoticeRef != testRef {
			t.Errorf("%s: notice read %v %v", f, rd.NoticeRef, rd.NoticeOK)
		}
		if rd.HiddenOK && rd.Hidden != testRef {
			t.Errorf("%s: hidden read the wrong ref: %+v", f, rd)
		}
		if !rd.HiddenOK {
			t.Errorf("%s: hidden ref not recovered: %+v", f, rd)
		}
	}
}

func TestUnstampedReadsNothing(t *testing.T) {
	for _, f := range files {
		orig, _ := stamped(t, f)
		if rd := testKey.Read(orig, from, now); rd.HiddenOK || rd.NoticeOK {
			t.Errorf("%s: found a mark in an unstamped file: %+v", f, rd)
		}
	}
}

// TestSurvivesEdits does to a stamped file what someone building on it
// might: deletes the notice, reindents, deletes a third of the comments
// and rewrites another chunk of them, and pastes in comments of their own.
func TestSurvivesEdits(t *testing.T) {
	for _, f := range files[:3] { // double-speak has too few gaps to lose a third
		_, marked := stamped(t, f)
		src := marked[bytes.IndexByte(marked, '\n')+1:] // notice gone
		src = bytes.ReplaceAll(src, []byte("\n  "), []byte("\n    "))

		rng := rand.New(rand.NewPCG(1, 2))
		var out []byte
		last := 0
		for _, c := range Comments(src) {
			out = append(out, src[last:c[0]]...)
			switch rng.IntN(6) {
			case 0, 1: // deleted
			case 2: // rewritten in their own words
				out = append(out, "// tweaked this for our layout, works better on mobile now"...)
			default:
				out = append(out, src[c[0]:c[1]]...)
			}
			last = c[1]
		}
		out = append(out, src[last:]...)
		out = append(out, "\n// Added by someone else: a comment with plenty of ordinary words in it.\n"...)

		rd := testKey.Read(out, from, now)
		if !rd.HiddenOK || rd.Hidden != testRef {
			t.Errorf("%s: lost after edits: %+v", f, rd)
		}
		if rd.NoticeOK {
			t.Errorf("%s: read a notice that was deleted", f)
		}
	}
}

// Every spot Stamp picks must be found again, with the same identity, in
// what it produced: otherwise that spot's bit lands on the wrong bit or
// mask when read back, and votes as noise on every untouched copy.
func TestCarriersKeepTheirIdentity(t *testing.T) {
	for _, f := range files {
		orig, marked := stamped(t, f)
		body := marked[bytes.IndexByte(marked, '\n')+1:]
		after := map[uint64]bool{}
		for _, g := range testKey.gaps(body) {
			after[g.ctx] = true
		}
		lost := 0
		for _, g := range testKey.gaps(orig) {
			if !after[g.ctx] {
				lost++
			}
		}
		if lost > 0 {
			t.Errorf("%s: %d carriers changed identity when stamped", f, lost)
		}
	}
}

// A file with Windows line endings stamps and reads back like any other,
// with each trailing space before the "\r".
func TestCRLF(t *testing.T) {
	orig, _ := stamped(t, "text-effects/wave-form/wave-form.js")
	crlf := bytes.ReplaceAll(orig, []byte("\n"), []byte("\r\n"))
	marked := testKey.Stamp(crlf, "O", "s", testRef)
	if bytes.Contains(marked, []byte("\r \n")) {
		t.Error("trailing space inserted between \\r and \\n")
	}
	body := marked[bytes.IndexByte(marked, '\n')+1:]
	if rd := testKey.Read(body, from, now); !rd.HiddenOK || rd.Hidden != testRef {
		t.Errorf("CRLF copy not recovered: %+v", rd)
	}
}
