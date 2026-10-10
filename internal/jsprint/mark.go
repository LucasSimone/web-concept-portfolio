package jsprint

import (
	"bytes"
	"cmp"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"hash"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Stamping a file (Key.Stamp) gives every served copy its own Ref, twice:
//
//   - In plain sight, as a "/*!" notice on the first line naming the owner,
//     the download time and the sealed ref code. Minifiers keep "/*!"
//     comments by default, but a person can simply delete it.
//   - Hidden in whitespace, where a person is unlikely to look: some gaps
//     between words in comments get two spaces instead of one, and some
//     lines get a trailing space, and the pattern spells out the same
//     sealed ref.
//
// The hidden copy is built to survive what people do to code they've
// taken: which spots carry which bit is decided by their content (the
// words around a gap, the text of a line) through the key, not by
// position, so moving, deleting or adding code and comments elsewhere
// doesn't shift anything; and every bit is written many times over, so
// editing some of the file only loses some votes. Nothing inside a string
// or template literal is touched, so a stamped file behaves exactly like
// the original.
//
// The two carriers fail differently, which is why there are two. Comment
// spacing survives Prettier, ESLint and editors, which leave the inside of
// comments alone, but small files have few comments. Trailing spaces are
// on every line, so they carry small files, but Prettier and editors set
// to trim trailing whitespace remove them.
//
// What removes both: stripping comments and reformatting (any minifier
// does both), or comparing two downloads to see what differs. For a copy
// like that, the fingerprint matching in this package still finds the code
// and its version.

// targetVotes is how many carrier gaps Stamp aims for per bit. A file with
// fewer gaps than RefBits*targetVotes uses every gap it has; one with more
// leaves most gaps alone, so the doubled spaces stay sparse.
const targetVotes = 6

// levels is the number of carrier densities: a gap whose level is below
// levels/d carries a bit at density 1/d. The sets nest, so the gaps that
// carry at 1/8 are also carriers at 1/4, 1/2 and 1.
const levels = 64

// A gap is one spot that can carry a bit: a single space between two
// words in a comment (val 1 when it's been doubled), or the end of a line
// (val 1 when it has a trailing space).
type gap struct {
	pos   int // where Stamp inserts the space
	val   int // 0 or 1, as found
	level int // see levels
	bit   int // which bit of the sealed ref this gap carries
	mask  int // XORed onto the bit, so plain single spaces read as noise rather than all zeros
	ctx   uint64
}

var word = regexp.MustCompile(`[A-Za-z]+`)

// gaps finds every carrier in src, in order: each single- or double-space
// gap between two words inside its comments, except "/*!" notices (which
// Stamp adds itself), and each line end (see lineEnds).
func (k Key) gaps(src []byte) []gap {
	m := hmac.New(sha256.New, k.sub("gap"))
	out := k.lineEnds(src, m)
	for _, c := range Comments(src) {
		body := src[c[0]:c[1]]
		if len(body) > 2 && body[1] == '*' && body[2] == '!' {
			continue
		}
		words := word.FindAllIndex(body, -1)
		for j := 0; j+1 < len(words); j++ {
			between := string(body[words[j][1]:words[j+1][0]])
			if between != " " && between != "  " {
				continue
			}
			// Context is the two words before the gap and the one after:
			// enough that the same phrase in two places rarely shares a
			// carrier, little enough that an edit nearby rarely changes it.
			prev2 := ""
			if j > 0 {
				prev2 = string(body[words[j-1][0]:words[j-1][1]])
			}
			h := gapHash(m, prev2, string(body[words[j][0]:words[j][1]]), string(body[words[j+1][0]:words[j+1][1]]))
			out = append(out, newGap(c[0]+words[j][1], len(between)-1, h))
		}
	}
	slices.SortFunc(out, func(a, b gap) int { return cmp.Compare(a.pos, b.pos) })
	return out
}

func newGap(pos, val int, h uint64) gap {
	return gap{pos: pos, val: val, level: int(h % levels), bit: int((h >> 8) % RefBits), mask: int(h>>16) & 1, ctx: h}
}

// lineEnds finds the end of every non-blank line that has at most one
// trailing space - except lines that end inside a string or template
// literal, where a trailing space would be part of the value, and the
// "/*!" notice. A line's context is its text with every run of
// whitespace collapsed to one space and the ends trimmed, so reindenting
// doesn't move its bit - and nor does the comment-gap carrier doubling a
// space in a comment on the same line, which Stamp does after picking
// these spots and Read sees before.
func (k Key) lineEnds(src []byte, m hash.Hash) []gap {
	var out []gap
	literals := Literals(src)
	start := 0
	for nl := bytes.IndexByte(src, '\n'); nl >= 0; nl = bytes.IndexByte(src[start:], '\n') {
		nl += start
		lineStart := start
		line := src[start:nl]
		start = nl + 1
		for len(literals) > 0 && literals[0][1] <= nl {
			literals = literals[1:]
		}
		if len(literals) > 0 && literals[0][0] < nl {
			continue // this newline is inside a literal
		}
		line = bytes.TrimSuffix(line, []byte("\r"))
		text := bytes.TrimRight(line, " ")
		trailing := len(line) - len(text)
		text = bytes.TrimLeft(text, " \t")
		if len(text) == 0 || trailing > 1 || bytes.HasSuffix(text, []byte("\t")) || bytes.HasPrefix(text, []byte("/*!")) {
			continue
		}
		h := gapHash(m, "\x01line", strings.Join(strings.Fields(string(text)), " "))
		// Insert before any "\r", not between it and the "\n".
		out = append(out, newGap(lineStart+len(line)-trailing, trailing, h))
	}
	return out
}

func gapHash(m hash.Hash, words ...string) uint64 {
	m.Reset()
	for _, w := range words {
		m.Write(lower(w))
		m.Write([]byte{0})
	}
	return binary.BigEndian.Uint64(m.Sum(nil))
}

func lower(s string) []byte {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return b
}

// Stamp returns src marked with r: the visible notice first (naming owner
// and source, e.g. "example.com/carousel/deck/deck.js"), then src with
// the hidden copy written into its comment spacing.
func (k Key) Stamp(src []byte, owner, source string, r Ref) []byte {
	sealed := k.Seal(r)
	gaps := k.gaps(src)
	density := 1
	for density*2 <= levels && len(gaps)/(density*2) >= RefBits*targetVotes {
		density *= 2
	}

	notice := fmt.Sprintf("/*! %s - by %s. Downloaded %s UTC, ref %s. Please keep this notice with the code. */\n",
		source, owner, r.Time.UTC().Format("2006-01-02 15:04"), Code(sealed))
	out := make([]byte, 0, len(notice)+len(src)+len(gaps)/2)
	out = append(out, notice...)
	last := 0
	for _, g := range gaps {
		if g.val != 0 || g.level >= levels/density || int(sealed>>g.bit&1)^g.mask == 0 {
			continue
		}
		out = append(append(out, src[last:g.pos]...), ' ')
		last = g.pos
	}
	return append(out, src[last:]...)
}

// A Reading is what Read recovers from a file.
type Reading struct {
	// Notice is the ref code in the visible notice, if one survives, and
	// NoticeRef what it opens to; NoticeOK is false if the code is
	// missing or doesn't open with this key (it was edited or forged).
	Notice    string
	NoticeRef Ref
	NoticeOK  bool

	// Hidden is the ref recovered from the comment spacing. HiddenOK is
	// false when not enough of it survived to recover; Candidates then
	// lists what it could still be, if that's a short list.
	Hidden     Ref
	HiddenOK   bool
	Candidates []Ref
	Carriers   int     // distinct phrases that voted
	Agreement  float64 // share of votes agreeing with the recovered bits
	Missing    int     // bits with no vote, or a tied one
	// Confidence is how many standard deviations the votes' agreement sits
	// above what the same number of plain, unstamped gaps would produce.
	// Read accepts nothing below minConfidence.
	Confidence float64
}

// noticeCode finds the ref in a notice Stamp wrote, and not just any
// "ref" in someone else's "/*!" license comment.
var noticeCode = regexp.MustCompile(`Downloaded [^,]*, ref ([0-9A-Za-z]{4}-?[0-9A-Za-z]{4})\b`)

// Read recovers what Stamp wrote into src, from whatever is left of it.
// A recovered time has to fall in [from, to] to be believed: pass the
// site's first deploy (or first commit) and time.Now(). That window is
// part of what lets Read fill in a few lost bits by trying every value for
// them without accepting a lucky wrong guess.
func (k Key) Read(src []byte, from, to time.Time) Reading {
	var rd Reading
	for _, c := range Comments(src) {
		body := src[c[0]:c[1]]
		if len(body) > 2 && body[1] == '*' && body[2] == '!' {
			if m := noticeCode.FindSubmatch(body); m != nil {
				rd.Notice = string(m[1])
				if v, err := ParseCode(rd.Notice); err == nil {
					rd.NoticeRef, rd.NoticeOK = k.Open(v)
				}
				break
			}
		}
	}

	// The density a file was stamped at isn't recorded, so try each from
	// sparsest to densest. A density sparser than the real one still reads
	// correctly from fewer gaps; a denser one mixes in plain gaps that
	// read as noise.
	gaps := k.gaps(src)
	var best Reading
	bestScore := -1.0
	for density := levels; density >= 1; density /= 2 {
		// One vote per distinct context, whatever it decides by majority:
		// otherwise a phrase that repeats - or one comment pasted twenty
		// times - outvotes everything else on its bit.
		byCtx := map[uint64]*[2]int{}
		bitOf := map[uint64]int{}
		for _, g := range gaps {
			if g.level < levels/density {
				if byCtx[g.ctx] == nil {
					byCtx[g.ctx] = &[2]int{}
				}
				byCtx[g.ctx][g.val^g.mask]++
				bitOf[g.ctx] = g.bit
			}
		}
		var votes [RefBits][2]int
		n := 0
		for ctx, v := range byCtx {
			if v[0] != v[1] {
				votes[bitOf[ctx]][boolInt(v[1] > v[0])]++
				n++
			}
		}
		r := decode(k, votes, n, from, to)
		if r.Confidence > bestScore {
			best, bestScore = r, r.Confidence
		}
	}
	rd.Hidden, rd.HiddenOK, rd.Candidates = best.Hidden, best.HiddenOK, best.Candidates
	rd.Carriers, rd.Agreement, rd.Missing, rd.Confidence = best.Carriers, best.Agreement, best.Missing, best.Confidence
	return rd
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// maxGuess caps how many bits decode will try both values for: the ones
// with no vote or a tie, then the ones whose majority was only one vote.
// Each extra guessed bit doubles the chance of a wrong guess passing.
const maxGuess = 6

// minConfidence is the Confidence a reading needs. Stamped files read at
// 10-30 even after heavy editing; unstamped ones scatter around 0. A fixed
// share of agreeing votes can't draw that line, because with only one or
// two votes on a bit, noise agrees with itself most of the time too.
const minConfidence = 5

func decode(k Key, votes [RefBits][2]int, carriers int, from, to time.Time) Reading {
	rd := Reading{Carriers: carriers}
	var v uint64
	var unknown, weak []int
	agree := 0
	for b := range RefBits {
		zero, one := votes[b][0], votes[b][1]
		if one > zero {
			v |= 1 << b
		}
		agree += max(zero, one)
		switch d := one - zero; {
		case d == 0:
			unknown = append(unknown, b)
		case d == 1 || d == -1:
			weak = append(weak, b)
		}
	}
	rd.Missing = len(unknown)
	if carriers > 0 {
		rd.Agreement = float64(agree) / float64(carriers)
	}
	guess := append(unknown, weak...)
	rd.Confidence = confidence(votes)
	if len(unknown) > maxGuess || rd.Confidence < minConfidence {
		return rd
	}
	guess = guess[:min(len(guess), maxGuess)]
	for g := range uint64(1) << len(guess) {
		try := v
		for i, b := range guess {
			if g>>i&1 == 1 {
				try ^= 1 << b
			}
		}
		if r, ok := k.Open(try); ok && !r.Time.Before(from) && !r.Time.After(to) {
			rd.Candidates = append(rd.Candidates, r)
		}
	}
	if len(rd.Candidates) == 1 {
		rd.Hidden, rd.HiddenOK, rd.Candidates = rd.Candidates[0], true, nil
	}
	return rd
}

// confidence scores votes against the null hypothesis that every vote is
// a fair coin flip, as an unstamped file's are. For a bit with c votes,
// the winning side's lead over c/2 is the statistic; its mean and
// variance under the null are computed exactly from the binomial
// distribution and summed over bits, and the result is the observed total
// lead in standard deviations from the null mean.
func confidence(votes [RefBits][2]int) float64 {
	var lead, mean, variance float64
	for _, v := range votes {
		c := v[0] + v[1]
		if c == 0 {
			continue
		}
		lead += float64(max(v[0], v[1])) - float64(c)/2
		m, s2 := nullLead(c)
		mean += m
		variance += s2
	}
	if variance == 0 {
		return 0
	}
	return (lead - mean) / math.Sqrt(variance)
}

// nullLead is the mean and variance of max(k, c-k) - c/2 for k drawn from
// Binomial(c, 1/2).
func nullLead(c int) (mean, variance float64) {
	lc, _ := math.Lgamma(float64(c + 1))
	var m1, m2 float64
	for k := 0; k <= c; k++ {
		lk, _ := math.Lgamma(float64(k + 1))
		lr, _ := math.Lgamma(float64(c - k + 1))
		p := math.Exp(lc - lk - lr - float64(c)*math.Ln2)
		x := float64(max(k, c-k)) - float64(c)/2
		m1 += p * x
		m2 += p * x * x
	}
	return m1, m2 - m1*m1
}
