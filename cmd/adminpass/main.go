// Command adminpass generates the credential for the admin portal: it
// prints the ADMIN_PASSWORD_HASH line to paste into .env (locally) or
// into the service's environment (in production).
//
// Run it through the Makefile:
//
//	make admin-password                  # generate a password and hash it
//	make admin-password PASSWORD=secret  # hash a password you chose
//
// With no password it invents one, which is the better default for a
// single-admin portal: a generated 20-character password is stronger
// than anything anyone types from memory, and it's going into a password
// manager rather than a human head either way.
//
// The password is printed to stdout, so it's visible on screen and lands
// in the shell's scrollback. That's the deliberate trade: prompting for
// it without echo needs golang.org/x/term, and a dependency is a steeper
// price than one `clear` after copying it into a password manager. For
// the same reason this is a separate command rather than a flag on the
// server — the server binary has no business containing a code path that
// prints credentials, and the Docker build only ever builds ./cmd/server,
// so this never ships.
package main

import (
	"crypto/rand"
	"fmt"
	"os"

	"github.com/lsimone/web-concept-portfolio/internal/admin"
)

// passwordAlphabet leaves out the characters that make a password
// annoying to move around by hand: quotes and backslashes need escaping
// in a .env file or a systemd unit, and 0/O/1/l/I get misread when
// anyone does end up reading one out.
const passwordAlphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// passwordLen is 20, which at this alphabet is a little under 116 bits
// of entropy — far past anything brute-forcible, and the PBKDF2 cost in
// package admin is what covers the offline case if the hash ever leaks.
const passwordLen = 20

func main() {
	password := os.Getenv("PASSWORD")
	generated := password == ""
	if generated {
		var err error
		if password, err = generatePassword(); err != nil {
			fmt.Fprintf(os.Stderr, "adminpass: %v\n", err)
			os.Exit(1)
		}
	}

	hash, err := admin.HashPassword(password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "adminpass: %v\n", err)
		os.Exit(1)
	}

	if generated {
		fmt.Printf("\nPassword (save this in a password manager — it is not recoverable):\n\n    %s\n", password)
	}
	fmt.Printf("\nAdd this to .env for local use, or to the service environment in production:\n\n")
	fmt.Printf("ADMIN_PASSWORD_HASH=%s\n", hash)
	fmt.Printf("\nThe username defaults to \"admin\"; set ADMIN_USER to change it.\n")
	fmt.Printf("Restart the server to pick it up.\n")
}

// generatePassword returns a random password from passwordAlphabet.
//
// rand.Text() in the standard library would be the obvious shortcut, but
// it fixes both the length and the alphabet (base32), so this does the
// rejection-free thing instead: rand.Int reduces each byte modulo the
// alphabet size. The modulo bias that implies is negligible here (56
// characters into 256 skews the first 32 letters by about 0.4%) and
// costs nothing at this length — but it's the reason not to copy this
// loop somewhere that a bias would matter.
func generatePassword() (string, error) {
	b := make([]byte, passwordLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate password: %w", err)
	}
	for i := range b {
		b[i] = passwordAlphabet[int(b[i])%len(passwordAlphabet)]
	}
	return string(b), nil
}
