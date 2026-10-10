package admin

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Credential is the one admin account: a username and a password hash,
// both read from the environment at startup. There is no user table and
// no registration flow, because there is exactly one person who needs in
// and adding accounts would mean inventing roles, invites and a password
// reset path for a portal with a single reader.
type Credential struct {
	user string
	// hash fields, unpacked from the stored string once at startup so a
	// login doesn't re-parse (and can't fail to parse) on every attempt.
	iterations int
	salt       []byte
	key        []byte
}

// Password hashing parameters. PBKDF2-HMAC-SHA256 comes from the
// standard library as of Go 1.24, which is what lets this be a real
// password KDF without adding a dependency to a project whose short
// dependency list is one of its deliberate properties. bcrypt or argon2
// would both be defensible and both live outside the standard library;
// the trade-off was made knowingly.
//
// hashIterations follows OWASP's current guidance for this specific
// construction (600k for PBKDF2-HMAC-SHA256). It costs the login request
// a few hundred milliseconds, which nobody logging in once a day
// notices, and multiplies the cost of an offline attack on a leaked hash
// by the same factor. It's stored *in* the hash string rather than read
// from here at verify time, so raising it later doesn't invalidate a
// credential generated today — the old hash keeps verifying at its own
// iteration count until it's regenerated.
const (
	hashIterations = 600_000
	hashKeyLen     = 32
	hashSaltLen    = 16
	hashPrefix     = "pbkdf2$sha256$"
)

// HashPassword turns a plaintext password into the string that belongs
// in ADMIN_PASSWORD_HASH: "pbkdf2$sha256$<iterations>$<salt>$<key>",
// both binary parts base64 (raw, unpadded, so the value stays free of
// the '=' that would need quoting in a .env file or a systemd unit).
//
// The format is this project's own rather than a standard like bcrypt's
// — worth noting as a real cost, since no existing tool can read it.
// With one password written by one command (cmd/adminpass) and read by
// one function, that buys nothing worth a dependency.
func HashPassword(password string) (string, error) {
	salt := make([]byte, hashSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, hashIterations, hashKeyLen)
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("%s%d$%s$%s", hashPrefix, hashIterations, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// ParseCredential unpacks a username and a HashPassword string into a
// Credential, and is also the gate that decides whether the portal
// exists at all: an empty hash is an error, not a Credential with no
// password. The caller (cmd/server) treats any error here as "admin
// portal disabled" and never registers the routes, so a deploy that
// forgets ADMIN_PASSWORD_HASH serves 404s where the portal would be
// rather than a login page that anything can walk through. Failing
// closed is the whole point; the alternative failure mode is a publicly
// readable inbox.
//
// user falls back to "admin" when empty, since a username nobody else
// can discover isn't doing security work here — the password is — and
// one less thing to set is one less thing to set wrong.
func ParseCredential(user, hash string) (*Credential, error) {
	if hash == "" {
		return nil, errors.New("ADMIN_PASSWORD_HASH is not set")
	}
	if user == "" {
		user = "admin"
	}

	rest, ok := strings.CutPrefix(hash, hashPrefix)
	if !ok {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH: want a %s... value from `make admin-password`", hashPrefix)
	}
	parts := strings.Split(rest, "$")
	if len(parts) != 3 {
		return nil, errors.New("ADMIN_PASSWORD_HASH: malformed, want iterations$salt$key")
	}

	iterations, err := strconv.Atoi(parts[0])
	if err != nil || iterations < 1 {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH: bad iteration count %q", parts[0])
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH: bad salt: %w", err)
	}
	key, err := enc.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH: bad key: %w", err)
	}

	return &Credential{user: user, iterations: iterations, salt: salt, key: key}, nil
}

// verify reports whether user and password match the credential.
//
// Both halves are compared in constant time, and the password is hashed
// even when the username is already wrong, so a wrong username and a
// wrong password take the same time to reject. Short-circuiting on the
// username would leak which one was wrong to anyone timing the
// responses, and with the username knowable that's a hint about where to
// aim next.
func (c *Credential) verify(user, password string) bool {
	userOK := subtle.ConstantTimeCompare([]byte(user), []byte(c.user)) == 1

	key, err := pbkdf2.Key(sha256.New, password, c.salt, c.iterations, len(c.key))
	if err != nil {
		return false
	}
	passwordOK := subtle.ConstantTimeCompare(key, c.key) == 1

	return userOK && passwordOK
}

// sessionTTL is how long a login lasts. It slides: every authenticated
// request pushes the expiry back (see sessions.lookup), so a session
// ends twelve hours after you stop using it rather than twelve hours
// after you logged in, and the portal doesn't log you out mid-triage.
const sessionTTL = 12 * time.Hour

// session is one logged-in browser.
type session struct {
	// csrf is this session's CSRF token, minted with the session and
	// good for its lifetime. Per-session rather than per-form: both stop
	// a cross-site POST, and a token that changes under you is what
	// makes two open tabs start failing each other's submissions.
	csrf    string
	expires time.Time
}

// sessions is the live set of logins, held in memory only. Chosen over a
// signed stateless cookie deliberately: it needs no second long-lived
// secret to generate, store and never lose, and logging out actually
// revokes the session instead of relying on a cookie being discarded.
// The cost is that a restart or redeploy logs the owner out, which for
// one person deploying occasionally is a re-login, not an outage.
//
// It is also, intentionally, per-process: running two replicas would
// leave each one not recognizing the other's sessions. The same is
// already true of ipRateLimiter (see internal/httpserver/middleware.go),
// and this site is one container.
type sessions struct {
	mu   sync.Mutex
	live map[string]*session
}

// newSessions returns an empty session set and starts the goroutine that
// drops expired entries. Like the rate limiter's sweeper there's no stop
// channel: the process creates exactly one of these and keeps it for its
// whole life.
//
// Sweeping matters even though lookup already rejects expired sessions:
// without it, every login that's abandoned rather than logged out leaves
// a token in the map forever.
func newSessions() *sessions {
	s := &sessions{live: make(map[string]*session)}
	go s.sweepPeriodically(time.Hour)
	return s
}

// create mints a new session and returns its token, which is what goes
// in the cookie. 32 bytes from crypto/rand is far past guessable, and
// rand.Read in modern Go cannot fail (it panics rather than returning a
// short read), so a token is never half-random.
func (s *sessions) create() (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	csrf, err := randomToken()
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.live[token] = &session{csrf: csrf, expires: time.Now().Add(sessionTTL)}
	return token, nil
}

// lookup returns the session for token and slides its expiry forward, or
// reports false for a token that is unknown, expired, or empty.
func (s *sessions) lookup(token string) (*session, bool) {
	if token == "" {
		return nil, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.live[token]
	if !ok {
		return nil, false
	}
	if time.Now().After(sess.expires) {
		delete(s.live, token)
		return nil, false
	}
	sess.expires = time.Now().Add(sessionTTL)
	return sess, true
}

// destroy forgets a session, which is what logging out does. Harmless
// for a token that isn't there.
func (s *sessions) destroy(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.live, token)
}

func (s *sessions) sweepPeriodically(interval time.Duration) {
	for range time.Tick(interval) {
		now := time.Now()
		s.mu.Lock()
		for token, sess := range s.live {
			if now.After(sess.expires) {
				delete(s.live, token)
			}
		}
		s.mu.Unlock()
	}
}

// randomToken returns 32 cryptographically random bytes, base64url
// encoded so the result is safe in a cookie value with no quoting.
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// sameToken compares two tokens in constant time. Used for CSRF checks,
// where the value being compared against is attacker-influenced and a
// byte-by-byte early exit would let it be guessed one byte at a time.
func sameToken(got, want string) bool {
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
