package contact

// request is the JSON body posted by the contact form.
type request struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Message string `json:"message"`
	// Honeypot is a hidden field real users never see or fill. Its name is
	// deliberately generic (not "company"/"website"/etc.) so browser
	// autofill heuristics don't recognize and populate it for real visitors.
	// If it's non-empty, the submitter is treated as a bot (see handler.go).
	Honeypot string `json:"hp_field"`
}
