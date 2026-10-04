package contact

// Submission kinds. Which form a submission came from decides which of its
// fields are required (see handler.go) and which ones are even meaningful:
// a services inquiry carries a Topic, a bug report carries a Page and a
// Browser.
const (
	KindInquiry = "inquiry"
	KindBug     = "bug"
)

// Where a bug report's effect was running. These are the values the bug
// form's "where are you running it" dropdown posts; they're stored as-is
// and not otherwise checked, since nothing downstream branches on them
// yet.
const (
	SiteThis = "this-site"
	SiteOwn  = "own-site"
)

// Submission is one stored form submission, from either form.
type Submission struct {
	// Kind is KindInquiry or KindBug.
	Kind string `json:"kind"`
	// Name, Email and Message are the fields both forms share. A bug
	// report only fills in Message (and Email, if the reporter wants a
	// reply); an inquiry needs all three.
	Name    string `json:"name"`
	Email   string `json:"email"`
	Message string `json:"message"`
	// Topic is the kind of work a services inquiry is about ("website",
	// "hosting", ...), taken from the contact form's dropdown. Empty on
	// bug reports.
	Topic string `json:"topic"`
	// Effect is the slug of the effect the bug is in, taken from the bug
	// form's dropdown (the slugs in
	// web/static/shared/effects-manifest.js). Empty when the reporter
	// didn't pick one, and on inquiries.
	Effect string `json:"effect"`
	// Site is where the reporter was running that effect: SiteThis (a
	// demo or docs page here) or SiteOwn (a page of their own, from a
	// downloaded copy of the script). The same symptom means different
	// things in each — on their own site it may be integration rather
	// than the effect — so the form asks rather than assuming.
	Site string `json:"site"`
	// Link is an optional URL where the bug can be seen, which for a
	// report from someone's own site is often the only way to see it at
	// all.
	Link string `json:"link"`
	// Browser is the reporter's user-agent string, shown to them on the
	// bug form and sent along to help reproduce. Empty on inquiries.
	Browser string `json:"browser"`
}

// request is the JSON body posted to /api/contact: a Submission plus the
// one field that is never stored.
type request struct {
	Submission
	// Honeypot is a hidden field real users never see or fill. Its name is
	// deliberately generic (not "company"/"website"/etc.) so browser
	// autofill heuristics don't recognize and populate it for real visitors.
	// If it's non-empty, the submitter is treated as a bot (see handler.go).
	Honeypot string `json:"hp_field"`
}
