package jsprint

import "hash/fnv"

// K and W set the sensitivity. A shared run of K tokens is the smallest
// match that counts at all, and any shared run of K+W-1 tokens is
// guaranteed to be caught (the winnowing guarantee). Both were tuned
// against the corpus described in the package doc: lower K raised the
// match on minified copies but began to match unrelated code, higher K
// lost matches on minified copies without making unrelated code any
// less likely to match.
const (
	K = 8
	W = 6
)

// Set is a file's fingerprints.
type Set map[uint64]struct{}

// Fingerprints hashes every K-token run of the stream and keeps the
// minimum hash of each W-hash window. Picking by value rather than by
// position is what makes the sample line up between two files that share
// code at different offsets: the same run of code selects the same hashes
// wherever it sits, whatever comes before or after it.
func Fingerprints(tokens []string) Set {
	hashes := gramHashes(tokens)
	set := Set{}
	if len(hashes) == 0 {
		return set
	}
	if len(hashes) <= W {
		set[minOf(hashes)] = struct{}{}
		return set
	}
	for start := 0; start+W <= len(hashes); start++ {
		set[minOf(hashes[start:start+W])] = struct{}{}
	}
	return set
}

// Of is Fingerprints(Tokens(src)).
func Of(src []byte) Set { return Fingerprints(Tokens(src)) }

func gramHashes(tokens []string) []uint64 {
	if len(tokens) < K {
		return nil
	}
	out := make([]uint64, 0, len(tokens)-K+1)
	for i := 0; i+K <= len(tokens); i++ {
		h := fnv.New64a()
		for _, t := range tokens[i : i+K] {
			h.Write([]byte(t))
			h.Write([]byte{0})
		}
		out = append(out, h.Sum64())
	}
	return out
}

func minOf(xs []uint64) uint64 {
	m := xs[0]
	for _, x := range xs[1:] {
		if x < m {
			m = x
		}
	}
	return m
}

// Shared counts the fingerprints a and b have in common.
func Shared(a, b Set) int {
	if len(b) < len(a) {
		a, b = b, a
	}
	n := 0
	for h := range a {
		if _, ok := b[h]; ok {
			n++
		}
	}
	return n
}
