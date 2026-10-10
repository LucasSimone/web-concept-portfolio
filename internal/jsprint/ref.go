package jsprint

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// A Ref is what a served copy says about itself: when it was served and
// from which build. It travels sealed (see Key.Seal) as a 40-bit value,
// small enough to hide in a short file's comments, and written out as a
// short code like 7KQ2-M9XA.
type Ref struct {
	Time  time.Time // to the minute, UTC
	Build byte      // first byte of the build's git commit; 0 if unknown
}

// RefBits is the size of a sealed Ref.
const RefBits = 40

// epoch is minute zero of Ref.Time; 24 bits of minutes from here runs
// out in 2057.
var epoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// check fills the last 8 bits of an unsealed Ref. Unsealing a value that
// wasn't sealed with the same key - a guess, a corrupted read, a forgery -
// scrambles it, so only 1 in 256 such values gets past Open.
const check = 0xA5

// Key is the secret that seals refs and decides where in a file the
// hidden copy goes. Anyone holding it can read and forge marks, so it
// lives in the server's environment, never in the repo.
type Key []byte

func (k Key) sub(label string) []byte {
	m := hmac.New(sha256.New, k)
	m.Write([]byte(label))
	return m.Sum(nil)
}

// Seal encrypts r into a RefBits-bit value. It's a Feistel cipher over
// two 20-bit halves with HMAC-SHA256 as the round function: a small,
// standard construction for encrypting a value too short for AES's
// 128-bit block.
func (k Key) Seal(r Ref) uint64 {
	minutes := uint64(max(r.Time.Sub(epoch), 0)/time.Minute) & (1<<24 - 1)
	v := minutes<<16 | uint64(r.Build)<<8 | check
	return k.feistel(v, false)
}

// Open reverses Seal, reporting false when v wasn't sealed with this key.
func (k Key) Open(v uint64) (Ref, bool) {
	v = k.feistel(v&(1<<RefBits-1), true)
	if v&0xFF != check {
		return Ref{}, false
	}
	return Ref{
		Time:  epoch.Add(time.Duration(v>>16) * time.Minute),
		Build: byte(v >> 8),
	}, true
}

func (k Key) feistel(v uint64, decrypt bool) uint64 {
	const half, mask = RefBits / 2, 1<<(RefBits/2) - 1
	round := k.sub("ref")
	l, r := v>>half, v&mask
	f := func(i int, x uint64) uint64 {
		m := hmac.New(sha256.New, round)
		var b [9]byte
		b[0] = byte(i)
		binary.BigEndian.PutUint64(b[1:], x)
		m.Write(b[:])
		return binary.BigEndian.Uint64(m.Sum(nil)) & mask
	}
	const rounds = 8
	for i := range rounds {
		if decrypt {
			l, r = r^f(rounds-1-i, l), l
		} else {
			l, r = r, l^f(i, r)
		}
	}
	return l<<half | r
}

// Crockford's base32: no I, L, O or U, so a code read off a screen or
// out loud can't be mistyped as a different one.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Code writes a sealed value as XXXX-XXXX.
func Code(v uint64) string {
	var b [8]byte
	for i := 7; i >= 0; i-- {
		b[i] = alphabet[v&31]
		v >>= 5
	}
	return string(b[:4]) + "-" + string(b[4:])
}

// ParseCode reverses Code, forgiving case, a missing dash, and the
// letters Crockford reads as digits (O for 0, I and L for 1).
func ParseCode(s string) (uint64, error) {
	s = strings.NewReplacer("-", "", "O", "0", "I", "1", "L", "1").Replace(strings.ToUpper(s))
	if len(s) != 8 {
		return 0, fmt.Errorf("ref code %q: want 8 characters", s)
	}
	var v uint64
	for _, c := range s {
		i := strings.IndexRune(alphabet, c)
		if i < 0 {
			return 0, fmt.Errorf("ref code %q: bad character %q", s, c)
		}
		v = v<<5 | uint64(i)
	}
	return v, nil
}
