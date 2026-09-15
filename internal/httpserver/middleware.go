package httpserver

import (
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

// logging logs one line per request, after it completes, with the method,
// path, and how long it took.
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// recoverPanic turns a panic anywhere in next into a 500 response instead
// of crashing the whole server process.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("panic: %v", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ipRateLimiter is a simple fixed-window per-IP limiter: an IP may make at
// most maxRequest requests within window. Good enough to blunt naive form
// spam without pulling in a dependency. State is in-memory and per-process
// only (resets on restart, not shared across replicas).
type ipRateLimiter struct {
	mu         sync.Mutex
	window     time.Duration
	maxRequest int
	// hits maps an IP to the timestamps of its recent requests. Entries
	// older than window are pruned lazily (on that IP's next request, see
	// allow) and swept periodically for IPs that never come back (see
	// sweepPeriodically).
	hits map[string][]time.Time
}

// newIPRateLimiter creates a limiter and starts its background cleanup
// goroutine. The goroutine runs for the lifetime of the process (there's
// no Stop/Close — the process only ever creates one of these).
func newIPRateLimiter(window time.Duration, maxRequests int) *ipRateLimiter {
	l := &ipRateLimiter{
		window:     window,
		maxRequest: maxRequests,
		hits:       make(map[string][]time.Time),
	}
	go l.sweepPeriodically(window)
	return l
}

// allow reports whether ip may make another request right now, and records
// this attempt either way (a rejected request still counts as an attempt,
// it just doesn't get a new "slot").
func (l *ipRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	// Compact ip's history down to timestamps still inside the window,
	// reusing the backing array since we're filtering in place.
	recent := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}

	if len(recent) >= l.maxRequest {
		l.hits[ip] = recent
		return false
	}

	l.hits[ip] = append(recent, now)
	return true
}

// sweepPeriodically drops IPs with no hits inside the window, so visitors
// who only ever make one request don't accumulate in the map forever —
// allow() only prunes an IP's own history when that same IP comes back.
func (l *ipRateLimiter) sweepPeriodically(interval time.Duration) {
	for range time.Tick(interval) {
		cutoff := time.Now().Add(-l.window)
		l.mu.Lock()
		for ip, hits := range l.hits {
			if len(hits) == 0 || hits[len(hits)-1].Before(cutoff) {
				delete(l.hits, ip)
			}
		}
		l.mu.Unlock()
	}
}

// middleware rejects requests over the limit with 429, keyed by the
// requester's IP.
func (l *ipRateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// NOTE: keyed on the direct connection address, which is correct
		// only while this server faces the internet directly (today's
		// deployment). Once a reverse proxy sits in front (planned for the
		// VPS), every request will share the proxy's address here and this
		// will need to read X-Forwarded-For from a *trusted* proxy instead.
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		if !l.allow(host) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
