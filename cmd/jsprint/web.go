package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

// Scanning a site: starting from one page, jsprint collects every script
// the page loads - external files, module preloads and inline <script>
// blocks - plus the original sources inside any source maps those scripts
// publish, which is where a bundled site's comments (and so the hidden
// stamp) usually survive. With -pages above 1 it then follows links to
// further pages on the same host.
//
// What it can't see: scripts a page only loads at runtime (lazy chunks,
// tag managers), pages behind a login, and anything a site doesn't link
// to. Pointing it at a script URL directly always works.

var client = &http.Client{Timeout: 30 * time.Second}

// fetch gets url, returning its body and media type.
func fetch(u string) ([]byte, string, error) {
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "jsprint (checks a page's scripts for code copied from one site)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("%s: %s", u, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	media, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	return body, media, err
}

var (
	scriptTag  = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	attr       = regexp.MustCompile(`(?is)\b([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
	linkTag    = regexp.MustCompile(`(?is)<link\b([^>]*)>`)
	anchorTag  = regexp.MustCompile(`(?is)<a\b([^>]*)>`)
	sourceMap  = regexp.MustCompile(`(?m)^[ \t]*//[#@] sourceMappingURL=(\S+)\s*$`)
	skipRemote = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|webm|mp3|woff2?|ttf|css|json|xml|txt)$`)
)

func attrs(tag string) map[string]string {
	out := map[string]string{}
	for _, m := range attr.FindAllStringSubmatch(tag, -1) {
		out[strings.ToLower(m[1])] = html.UnescapeString(m[2] + m[3] + m[4])
	}
	return out
}

// isJSType reports whether a <script type="..."> holds JavaScript, as
// opposed to JSON, an import map or a template.
func isJSType(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return t == "" || t == "module" || strings.Contains(t, "javascript") || strings.Contains(t, "ecmascript")
}

// scanSite collects the scripts of up to maxPages pages, starting at start
// (already fetched as page) and following same-host links breadth-first.
func scanSite(start string, page []byte, maxPages int) []source {
	base, _ := url.Parse(start)
	queue := []string{start}
	seenPage := map[string]bool{start: true}
	seenScript := map[string]bool{}
	var out []source
	for pages := 0; len(queue) > 0 && pages < maxPages; pages++ {
		pageURL := queue[0]
		queue = queue[1:]
		if pages > 0 {
			body, media, err := fetch(pageURL)
			if err != nil || media != "text/html" {
				continue
			}
			page = body
		}
		here, _ := url.Parse(pageURL)
		resolve := func(ref string) string {
			u, err := here.Parse(strings.TrimSpace(ref))
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
				return ""
			}
			u.Fragment = ""
			return u.String()
		}

		var scripts []string
		for i, m := range scriptTag.FindAllSubmatch(page, -1) {
			a := attrs(string(m[1]))
			if !isJSType(a["type"]) {
				continue
			}
			if src, ok := a["src"]; ok {
				scripts = append(scripts, resolve(src))
			} else if len(strings.TrimSpace(string(m[2]))) > 0 {
				out = append(out, newSource(fmt.Sprintf("%s (inline script %d)", pageURL, i+1), m[2]))
			}
		}
		for _, m := range linkTag.FindAllSubmatch(page, -1) {
			if a := attrs(string(m[1])); strings.EqualFold(a["rel"], "modulepreload") {
				scripts = append(scripts, resolve(a["href"]))
			}
		}
		for _, s := range scripts {
			if s == "" || seenScript[s] {
				continue
			}
			seenScript[s] = true
			out = append(out, scriptSources(s)...)
		}

		for _, m := range anchorTag.FindAllSubmatch(page, -1) {
			link := resolve(attrs(string(m[1]))["href"])
			u, err := url.Parse(link)
			if link == "" || err != nil || u.Host != base.Host || seenPage[link] || skipRemote.MatchString(u.Path) {
				continue
			}
			seenPage[link] = true
			queue = append(queue, link)
		}
		log.Printf("scanned %s (%d scripts so far)", pageURL, len(seenScript))
	}
	return out
}

// scriptSources fetches one script, plus each original source file inside
// its source map if it publishes one with sourcesContent.
func scriptSources(scriptURL string) []source {
	body, _, err := fetch(scriptURL)
	if err != nil {
		log.Printf("skip %v", err)
		return nil
	}
	out := []source{newSource(scriptURL, body)}

	m := sourceMap.FindSubmatch(body)
	if m == nil {
		return out
	}
	var raw []byte
	if ref := string(m[1]); strings.HasPrefix(ref, "data:") {
		_, data, ok := strings.Cut(ref, "base64,")
		if !ok {
			return out
		}
		if raw, err = base64.StdEncoding.DecodeString(data); err != nil {
			return out
		}
	} else {
		mapURL, err := url.Parse(scriptURL)
		if err != nil {
			return out
		}
		if mapURL, err = mapURL.Parse(ref); err != nil {
			return out
		}
		if raw, _, err = fetch(mapURL.String()); err != nil {
			return out
		}
	}
	var sm struct {
		Sources        []string  `json:"sources"`
		SourcesContent []*string `json:"sourcesContent"`
	}
	if json.Unmarshal(raw, &sm) != nil {
		return out
	}
	for i, content := range sm.SourcesContent {
		if content == nil || i >= len(sm.Sources) {
			continue
		}
		out = append(out, newSource(scriptURL+" (source map: "+path.Clean(sm.Sources[i])+")", []byte(*content)))
	}
	return out
}
