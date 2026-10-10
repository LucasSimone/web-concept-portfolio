// Command jsprint checks whether a JavaScript file found elsewhere came
// from this site, and if so when it was downloaded and from which files
// and version (see package jsprint for how both work).
//
//	JSPRINT_KEY=... go run ./cmd/jsprint suspect.js
//	go run ./cmd/jsprint https://example.com/assets/app.min.js
//	go run ./cmd/jsprint https://example.com           # every script on the page
//	go run ./cmd/jsprint -pages 50 https://example.com # ...and pages it links to
//	go run ./cmd/jsprint ./their-repo/src              # every .js under it
//
// When an argument turns into many scripts (a site or a directory), only
// the ones with a hit are printed, then a summary; -all prints every one.
// See web.go for what a site scan does and doesn't find.
//
// The key is the server's JSPRINT_KEY (also read from .env, or pass
// -key). For each suspect it first reads the download stamp: the visible
// notice if it's still there, then the copy hidden in the comments, which
// survives the notice being deleted and the code being edited. Without
// the key that part is skipped.
//
// Then, for a copy that has lost its comments as well, it matches the code
// itself: it prints how much of the suspect is our code, then
// each of our files it contains and what share of that file. With
// -history (on by default) each matched file is also compared against
// every committed version of it, and the closest one is reported with
// its date - so a copy is dated to the window between that commit and
// the next change to the file, from the code alone.
package main

import (
	"bytes"
	"cmp"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/jsprint"
)

func main() {
	root := flag.String("root", "web/static", "directory of our JavaScript to match against")
	minPct := flag.Float64("min", 10, "report our files only when at least this `percent` of them is found")
	history := flag.Bool("history", true, "date each match against the file's git history")
	keyFlag := flag.String("key", "", "the server's JSPRINT_KEY (default: $JSPRINT_KEY, or from .env)")
	pages := flag.Int("pages", 1, "for a page URL, scan up to this many same-site pages by following its links")
	all := flag.Bool("all", false, "print scripts without a hit too, when scanning many")
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), "usage: jsprint [flags] file|dir|url ...\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	if flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}
	log.SetFlags(0)

	key := jsprint.Key(cmp.Or(*keyFlag, os.Getenv("JSPRINT_KEY"), dotEnv(".env", "JSPRINT_KEY")))
	if len(key) == 0 {
		log.Print("no JSPRINT_KEY: checking code similarity only, not download stamps")
	}

	ours, err := loadOurs(*root)
	if err != nil {
		log.Fatal(err)
	}
	var hist *gitHistory
	if *history {
		if hist, err = newGitHistory(*root); err != nil {
			log.Printf("history off: %v", err)
		}
	}
	for _, arg := range flag.Args() {
		suspects, err := loadSuspects(arg, *pages)
		if err != nil {
			log.Fatal(err)
		}
		hits := 0
		for _, s := range suspects {
			var out bytes.Buffer
			fmt.Fprintf(&out, "%s\n", s.name)
			hit := false
			if len(key) > 0 {
				hit = reportStamp(&out, s, key, hist)
			}
			hit = report(&out, s, ours, *minPct, hist) || hit
			if hit {
				hits++
			}
			if hit || *all || len(suspects) == 1 {
				os.Stdout.Write(out.Bytes())
			}
		}
		if len(suspects) != 1 {
			fmt.Printf("%s: %d scripts checked, %d with a hit\n\n", arg, len(suspects), hits)
		}
	}
}

type source struct {
	name string
	src  []byte
	set  jsprint.Set
}

func newSource(name string, src []byte) source { return source{name, src, jsprint.Of(src)} }

// reportStamp writes what s's download stamp says, reporting whether it
// has one (or the remains of one) at all.
func reportStamp(w io.Writer, s source, key jsprint.Key, hist *gitHistory) bool {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if hist != nil {
		from = hist.firstCommit()
	}
	rd := key.Read(s.src, from, time.Now())
	describe := func(r jsprint.Ref) string {
		out := "downloaded " + r.Time.Format("2006-01-02 15:04 UTC")
		if r.Build == 0 {
			return out + ", build unknown"
		}
		out += fmt.Sprintf(", build %02x…", r.Build)
		if hist != nil {
			if c := hist.commitFor(r); c != "" {
				out += " (" + c + ")"
			}
		}
		return out
	}
	switch {
	case rd.NoticeOK:
		fmt.Fprintf(w, "  notice: ref %s - %s\n", rd.Notice, describe(rd.NoticeRef))
	case rd.Notice != "":
		fmt.Fprintf(w, "  notice: ref %s doesn't open with this key - edited, forged, or another key\n", rd.Notice)
	default:
		fmt.Fprintf(w, "  notice: none\n")
	}
	switch {
	case rd.HiddenOK:
		fmt.Fprintf(w, "  hidden: %s (confidence %.1f from %d spots)\n", describe(rd.Hidden), rd.Confidence, rd.Carriers)
		if rd.NoticeOK && rd.NoticeRef != rd.Hidden {
			fmt.Fprintf(w, "  NOTE: notice and hidden copy disagree - the hidden one is the one to trust\n")
		}
	case len(rd.Candidates) > 0:
		fmt.Fprintf(w, "  hidden: partly recovered, one of:\n")
		for _, c := range rd.Candidates {
			fmt.Fprintf(w, "          %s\n", describe(c))
		}
	default:
		fmt.Fprintf(w, "  hidden: not found (confidence %.1f from %d spots, %d of %d bits unread)\n",
			rd.Confidence, rd.Carriers, rd.Missing, jsprint.RefBits)
	}
	return rd.Notice != "" || rd.HiddenOK || len(rd.Candidates) > 0
}

// dotEnv reads one KEY=VALUE from an env file, the way cmd/server's
// loadDotEnv does, or "" if it's not there.
func dotEnv(path, key string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok && strings.TrimSpace(k) == key {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// minShared keeps tiny files honest: a 30-line demo.js has only a few
// fingerprints, and one or two coincidental hits would be a big percent.
const minShared = 3

// report writes which of our files s contains, reporting whether any.
func report(w io.Writer, s source, ours []source, minPct float64, hist *gitHistory) bool {
	type match struct {
		name   string
		shared int
		pct    float64
	}
	var matches []match
	ourHashes := jsprint.Set{}
	for _, o := range ours {
		shared := jsprint.Shared(s.set, o.set)
		pct := 100 * float64(shared) / float64(max(len(o.set), 1))
		if shared >= minShared && pct >= minPct {
			matches = append(matches, match{o.name, shared, pct})
			for h := range o.set {
				ourHashes[h] = struct{}{}
			}
		}
	}
	slices.SortFunc(matches, func(a, b match) int { return cmp.Compare(b.pct, a.pct) })

	if len(matches) == 0 {
		fmt.Fprintf(w, "  code: no match (%d fingerprints)\n\n", len(s.set))
		return false
	}
	fmt.Fprintf(w, "  code: %.0f%% of this file is our code (%d of %d fingerprints)\n",
		100*float64(jsprint.Shared(s.set, ourHashes))/float64(len(s.set)),
		jsprint.Shared(s.set, ourHashes), len(s.set))
	for _, m := range matches {
		fmt.Fprintf(w, "  %5.1f%%  %s\n", m.pct, m.name)
		if hist != nil {
			if v, err := hist.closest(m.name, s.set); err != nil {
				fmt.Fprintf(w, "          history: %v\n", err)
			} else if v != nil {
				fmt.Fprintf(w, "          %s\n", v)
			}
		}
	}
	fmt.Fprintln(w)
	return true
}

func loadOurs(root string) ([]source, error) {
	var ours []source
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(path) != ".js" {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		ours = append(ours, newSource(filepath.ToSlash(rel), src))
		return nil
	})
	if err == nil && len(ours) == 0 {
		err = fmt.Errorf("no .js files under %s", root)
	}
	return ours, err
}

func loadSuspects(arg string, pages int) ([]source, error) {
	if strings.HasPrefix(arg, "http://") || strings.HasPrefix(arg, "https://") {
		body, media, err := fetch(arg)
		if err != nil {
			return nil, err
		}
		if media == "text/html" {
			return scanSite(arg, body, pages), nil
		}
		return []source{newSource(arg, body)}, nil
	}
	info, err := os.Stat(arg)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		src, err := os.ReadFile(arg)
		return []source{newSource(arg, src)}, err
	}
	var out []source
	err = filepath.WalkDir(arg, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "node_modules" {
			return filepath.SkipDir
		}
		if d.IsDir() || !slices.Contains([]string{".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"}, filepath.Ext(path)) {
			return nil
		}
		src, err := os.ReadFile(path)
		out = append(out, newSource(path, src))
		return err
	})
	return out, err
}

// gitHistory reads past versions of our files from the repo that holds
// root.
type gitHistory struct {
	dir    string // root, where git runs
	prefix string // root's path from the repo top, e.g. "web/static/"
}

func newGitHistory(root string) (*gitHistory, error) {
	out, err := exec.Command("git", "-C", root, "rev-parse", "--show-prefix").Output()
	if err != nil {
		return nil, fmt.Errorf("%s is not in a git repo", root)
	}
	return &gitHistory{root, strings.TrimSpace(string(out))}, nil
}

func (g *gitHistory) git(args ...string) ([]byte, error) {
	return exec.Command("git", append([]string{"-C", g.dir}, args...)...).Output()
}

type version struct {
	commit, date, next string // next: date of the following change, "" if none
	score              float64
	total              int
}

func (v *version) String() string {
	when := "since " + v.date + " (still current)"
	if v.next != "" {
		when = v.date + " to " + v.next
	}
	return fmt.Sprintf("closest version %s, %s - %.0f%% match, %d versions checked",
		v.commit, when, 100*v.score, v.total)
}

// closest scores the suspect against every committed version of name and
// returns the best. The score is overlap divided by union, restricted to
// the suspect fingerprints that come from any version of this file: so a
// version missing code the suspect has scores lower, and so does a later
// one with code the suspect lacks, while the suspect's own additions
// don't count against any of them.
func (g *gitHistory) closest(name string, suspect jsprint.Set) (*version, error) {
	path := g.prefix + name
	log, err := g.git("log", "--format=%h%x09%cd", "--date=format:%Y-%m-%d %H:%M", "--", ":/"+path)
	if err != nil {
		return nil, err
	}
	lines := strings.FieldsFunc(string(log), func(r rune) bool { return r == '\t' || r == '\n' })
	if len(lines) == 0 {
		return nil, nil // not committed yet
	}
	type rev struct {
		commit, date string
		set          jsprint.Set
	}
	var revs []rev // newest first
	derived := jsprint.Set{}
	for i := 0; i+1 < len(lines); i += 2 {
		src, err := g.git("show", lines[i]+":"+path)
		if err != nil {
			continue // deleted in this commit
		}
		r := rev{lines[i], lines[i+1], jsprint.Of(src)}
		revs = append(revs, r)
		for h := range r.set {
			if _, ok := suspect[h]; ok {
				derived[h] = struct{}{}
			}
		}
	}
	var best *version
	for i, r := range revs {
		shared := jsprint.Shared(r.set, derived)
		score := float64(shared) / float64(max(len(r.set)+len(derived)-shared, 1))
		if best == nil || score > best.score {
			best = &version{commit: r.commit, date: r.date, score: score, total: len(revs)}
			if i > 0 {
				best.next = revs[i-1].date
			}
		}
	}
	return best, nil
}

// firstCommit is the repo's first commit time: nothing can have been
// downloaded before it, which is the earliest a stamp is believed.
func (g *gitHistory) firstCommit() time.Time {
	out, err := g.git("log", "--reverse", "--format=%cI")
	if err == nil {
		first, _, _ := strings.Cut(string(out), "\n")
		if t, err := time.Parse(time.RFC3339, first); err == nil {
			return t
		}
	}
	return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
}

// commitFor names the commit a stamp's build byte most likely refers to:
// the latest commit starting with that byte made before the download.
func (g *gitHistory) commitFor(r jsprint.Ref) string {
	out, err := g.git("log", "--all", "--format=%H %cI %s", "--before="+r.Time.Format(time.RFC3339))
	if err != nil {
		return ""
	}
	prefix := fmt.Sprintf("%02x", r.Build)
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, prefix) {
			hash, rest, _ := strings.Cut(line, " ")
			_, subject, _ := strings.Cut(rest, " ")
			return hash[:7] + " " + subject
		}
	}
	return ""
}
