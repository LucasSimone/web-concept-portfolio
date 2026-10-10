// Package jsprint traces this site's JavaScript after someone has taken
// it and built on it: renamed variables, reformatted, minified, deleted
// comments, cut out the part they wanted and wrapped it in their own.
// It works two ways, each covering what the other can't:
//
//   - Stamping (mark.go, ref.go): every download is served with a
//     visible notice and a hidden copy of when it was downloaded and from
//     which build. That says exactly where a copy came from, for as long
//     as its comments survive.
//   - Fingerprinting (this file and winnow.go): recognising the code
//     itself, which needs nothing in the file and so still works on a
//     copy whose comments are gone - it says which of our files and which
//     version, but not which download.
//
// Fingerprinting compares the order in which code uses property names -
// the DOM, canvas and library calls and its own object fields - threaded
// through its keywords, because those are what survive the changes above:
//
//  1. Normalize: lex the source and keep only property names and keywords
//     (see Tokens).
//  2. Fingerprint: hash every run of K consecutive tokens and keep a
//     sparse, position-independent sample of those hashes (winnowing,
//     the method behind the MOSS plagiarism detector; see Fingerprints).
//  3. Compare: the share of one of our files' fingerprints present in a
//     suspect file is how much of that file it contains.
//
// The choice of view is measured, not guessed. Against minified copies of
// this site's files (terser with compression and mangling, esbuild) and
// ~5.5MB of unrelated code (Chart.js, lodash, a 2.5MB app bundle, ...),
// a view that also kept operators and literal placeholders matched real
// copies no better and matched unrelated code at up to 25%; this one
// matched it at 0%.
//
// What defeats it: hand-renaming the property and method names throughout
// (or terser's opt-in --mangle-props, which breaks most code), or a
// rewrite in which the code's logic survives but none of its statements
// do. Short of that, minified copies typically keep 40-55% of a file's
// fingerprints and lightly edited ones over 90%.
package jsprint

// keywords are kept as themselves alongside property names: no rename can
// change them, and they mark the control flow between calls. The
// declaration keywords (var, let, const) and void are left out, since
// minifiers swap and merge declarations and write undefined as void 0.
var keywords = map[string]bool{
	"await": true, "break": true, "case": true, "catch": true, "class": true,
	"continue": true, "debugger": true, "default": true, "delete": true,
	"do": true, "else": true, "export": true, "extends": true,
	"finally": true, "for": true, "function": true, "if": true,
	"import": true, "in": true, "instanceof": true, "new": true, "of": true,
	"return": true, "super": true, "switch": true, "this": true,
	"throw": true, "try": true, "typeof": true, "while": true,
	"with": true, "yield": true, "async": true, "get": true, "set": true,
	"static": true,
}

// punctuators, longest first so the scan below is greedy. None are
// emitted; they're lexed so "." can be told from "?." and "...", and so
// a "/" can be told to be division or the start of a regex.
var punctuators = []string{
	">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
	"=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
	"*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
	"{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%",
	"&", "|", "^", "!", "~", "?", ":", "=", ".", "@", "#",
}

// Tokens lexes JavaScript source into its normalized token stream: the
// keywords, and each name read after "." or "?." as ".name".
//
// Property names are the core of it because minifiers never rename them
// (they'd break every DOM and library call), so names like getContext,
// requestAnimationFrame or this file's own _phase come through a minifier
// untouched and in order. Local variable names, which minifiers do
// rename, and literals, which people retune, are skipped.
//
// The lexer still has to understand strings, templates, regexes and
// comments, or the words inside them would leak into the stream. It is
// deliberately forgiving: it has to cope with fragments, syntax errors
// and whatever someone pasted together, so anything it doesn't recognise
// is skipped a byte at a time rather than reported.
func Tokens(src []byte) []string { return lex(src, nil) }

// Span kinds reported by lex.
const (
	commentSpan = iota // a comment, delimiters included
	literalSpan        // a string or template literal, quotes included
)

// Comments returns the [start, end) byte span of every comment in src,
// delimiters included, in order. It shares Tokens' lexer, so a "//" inside
// a string or a regex is correctly not a comment.
func Comments(src []byte) [][2]int { return spans(src, commentSpan) }

// Literals returns the span of every string and template literal in src,
// the parts of a file whose every byte - whitespace included - is data
// the code sees.
func Literals(src []byte) [][2]int { return spans(src, literalSpan) }

func spans(src []byte, kind int) [][2]int {
	var out [][2]int
	lex(src, func(k, start, end int) {
		if k == kind {
			out = append(out, [2]int{start, end})
		}
	})
	return out
}

// lex is Tokens, additionally reporting each comment's and literal's span
// to onSpan when that is non-nil.
func lex(src []byte, onSpan func(kind, start, end int)) []string {
	var out []string
	prev := "" // last significant raw token, for the regex-vs-divide call
	afterDot := false
	for i := 0; i < len(src); {
		c := src[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v':
			i++
		case c == '/' && i+1 < len(src) && src[i+1] == '/':
			start := i
			for i < len(src) && src[i] != '\n' {
				i++
			}
			if onSpan != nil {
				onSpan(commentSpan, start, i)
			}
		case c == '/' && i+1 < len(src) && src[i+1] == '*':
			end := indexFrom(src, i+2, "*/")
			if end < 0 {
				return out
			}
			if onSpan != nil {
				onSpan(commentSpan, i, end+2)
			}
			i = end + 2
		case c == '\'' || c == '"':
			start := i
			i, prev, afterDot = skipString(src, i), "s", false
			if onSpan != nil {
				onSpan(literalSpan, start, i)
			}
		case c == '`':
			var subs []string
			start := i
			i, subs = lexTemplate(src, i)
			if onSpan != nil {
				onSpan(literalSpan, start, i)
			}
			out, prev, afterDot = append(out, subs...), "`", false
		case c == '/' && regexAllowed(prev):
			i, prev, afterDot = skipRegex(src, i), "/r/", false
		case isDigit(c) || (c == '.' && i+1 < len(src) && isDigit(src[i+1])):
			i, prev, afterDot = skipNumber(src, i), "0", false
		case isIdentStart(c):
			j := i + 1
			for j < len(src) && isIdentPart(src[j]) {
				j++
			}
			word := string(src[i:j])
			i, prev = j, word
			if afterDot {
				out = append(out, "."+word)
			} else if keywords[word] {
				out = append(out, word)
			}
			afterDot = false
		default:
			p := matchPunctuator(src, i)
			if p == "" {
				i++ // unknown byte: skip it rather than fail
				continue
			}
			i, prev = i+len(p), p
			afterDot = p == "." || p == "?."
		}
	}
	return out
}

// regexAllowed reports whether a "/" after prev starts a regex literal
// rather than being division: it does wherever an expression can't have
// just ended. Close enough for real code, which is all this has to handle.
func regexAllowed(prev string) bool {
	switch prev {
	case "", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";",
		"+", "-", "*", "%", "<", ">", "~", "^", "=>", "==", "===", "!=", "!==",
		"&&", "||", "??", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
		"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
		"throw", "case", "do", "else", "yield", "await":
		return true
	}
	return false
}

func matchPunctuator(src []byte, i int) string {
	for _, p := range punctuators {
		if len(src)-i >= len(p) && string(src[i:i+len(p)]) == p {
			return p
		}
	}
	return ""
}

func skipString(src []byte, i int) int {
	quote := src[i]
	for i++; i < len(src); i++ {
		switch src[i] {
		case '\\':
			i++
		case quote, '\n':
			return i + 1
		}
	}
	return i
}

// lexTemplate skips a template literal's text and returns the tokens of
// the code in its ${...} substitutions. Those count the same as code
// anywhere else, because minifiers move code in and out of templates:
// esbuild turns "w: " + el.width into `w: ${el.width}`.
func lexTemplate(src []byte, i int) (int, []string) {
	var out []string
	for i++; i < len(src); i++ {
		switch src[i] {
		case '\\':
			i++
		case '`':
			return i + 1, out
		case '$':
			if i+1 < len(src) && src[i+1] == '{' {
				end := skipSubstitution(src, i+2)
				out = append(out, Tokens(src[i+2:max(end-1, i+2)])...)
				i = end - 1
			}
		}
	}
	return i, out
}

// skipTemplate is lexTemplate for callers that only need to get past it.
func skipTemplate(src []byte, i int) int {
	i, _ = lexTemplate(src, i)
	return i
}

// skipSubstitution skips from just inside "${" to just past its "}".
func skipSubstitution(src []byte, i int) int {
	depth := 1
	for i < len(src) {
		switch src[i] {
		case '\'', '"':
			i = skipString(src, i)
			continue
		case '`':
			i = skipTemplate(src, i)
			continue
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
		i++
	}
	return i
}

func skipRegex(src []byte, i int) int {
	inClass := false
	for i++; i < len(src); i++ {
		switch c := src[i]; {
		case c == '\\':
			i++
		case c == '\n':
			return i
		case c == '[':
			inClass = true
		case c == ']':
			inClass = false
		case c == '/' && !inClass:
			i++
			for i < len(src) && isIdentPart(src[i]) { // flags
				i++
			}
			return i
		}
	}
	return i
}

func skipNumber(src []byte, i int) int {
	for i < len(src) {
		c := src[i]
		if isIdentPart(c) || c == '.' {
			i++
			continue
		}
		// exponent sign: 1e-5, 2E+10
		if (c == '-' || c == '+') && (src[i-1] == 'e' || src[i-1] == 'E') && !isHex(src, i) {
			i++
			continue
		}
		break
	}
	return i
}

// isHex reports whether the number ending just before i is hex, where
// "e" is a digit rather than an exponent (0x1e-5 is 0x1e minus 5).
func isHex(src []byte, i int) bool {
	for j := i - 1; j > 0 && isIdentPart(src[j]); j-- {
		if src[j] == 'x' || src[j] == 'X' {
			return true
		}
	}
	return false
}

func indexFrom(src []byte, from int, sub string) int {
	for j := from; j+len(sub) <= len(src); j++ {
		if string(src[j:j+len(sub)]) == sub {
			return j
		}
	}
	return -1
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// Bytes >= 0x80 are treated as identifier characters: non-ASCII outside
// strings and comments is almost always a Unicode identifier.
func isIdentStart(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_' || c == '$' || c >= 0x80
}

func isIdentPart(c byte) bool { return isIdentStart(c) || isDigit(c) }
