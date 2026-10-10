package jsprint

import (
	"slices"
	"strings"
	"testing"
)

func TestTokens(t *testing.T) {
	cases := []struct {
		name, src string
		want      []string
	}{
		{"locals and literals drop, keywords stay", "const a = 1; return foo(bar, 'x', 2)",
			[]string{"return"}},
		{"properties kept, even across lines and comments", "a.b?.c\n  . /* x */ getContext(1)",
			[]string{".b", ".c", ".getContext"}},
		{"words inside strings and templates don't leak", "x = 'if.a' + `b.c ${d ? `e${'}'}.f` : g.h} i.j`; k.l",
			[]string{".h", ".l"}},
		{"regex vs division", "a = b.x / c / d; e = /[/]x\\.y\\//g.test(s)",
			[]string{".x", ".test"}},
		{"regex after return", "return /a.b+/.exec(s)",
			[]string{"return", ".exec"}},
		{"number dots aren't properties", "x = 1.5 + .5e+3 + 0x1e-5; y.z",
			[]string{".z"}},
		{"comments go", "// one.two\n/* if.else */ this.x", []string{"this", ".x"}},
	}
	for _, c := range cases {
		if got := Tokens([]byte(c.src)); !slices.Equal(got, c.want) {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}

// original and copied are the same code before and after the treatment
// a borrower gives it: comments stripped, every local renamed, const
// swapped for var, reformatted, braces dropped and statements joined with
// commas the way a minifier does, and a different number tuned.
const original = `
// Shortest signed distance around a loop.
function wrapDelta(raw, n) {
  let d = raw % n;
  if (d > n / 2) { d -= n; }
  else if (d < -n / 2) { d += n; }
  return d;
}
function startLoop(canvas, items) {
  const ctx = canvas.getContext('2d');
  let phase = 0;
  function frame(now) {
    phase = wrapDelta(phase + 0.016 * items.length, items.length);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < items.length; i++) {
      ctx.globalAlpha = Math.max(0, 1 - Math.abs(wrapDelta(i - phase, items.length)) / 3);
      ctx.drawImage(items[i], i * 40, 0);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}`

const copied = `function w(r,n){var d=r%n;if(d>n/2)d-=n;else if(d<-n/2)d+=n;return d}
function myCarousel(el,list){var c=el.getContext("2d"),p=0;function f(t){p=w(p+.02*list.length,list.length),c.clearRect(0,0,el.width,el.height);for(var i=0;i<list.length;i++)c.globalAlpha=Math.max(0,1-Math.abs(w(i-p,list.length))/3),c.drawImage(list[i],40*i,0);requestAnimationFrame(f)}requestAnimationFrame(f)}`

func TestSurvivesRenameReformatMinify(t *testing.T) {
	a, b := Tokens([]byte(original)), Tokens([]byte(copied))
	if !slices.Equal(a, b) {
		t.Fatalf("streams diverged:\n%s\n%s", strings.Join(a, " "), strings.Join(b, " "))
	}
}

func TestFoundInsideSomeoneElsesFile(t *testing.T) {
	theirs := "import x from 'y';\nconsole.log('their own code', x);\n" +
		copied + "\nexport default myCarousel;\n"
	ours := Of([]byte(original))
	if got := float64(Shared(ours, Of([]byte(theirs)))) / float64(len(ours)); got < 0.5 {
		t.Errorf("only %.0f%% of our fingerprints found", got*100)
	}
}
