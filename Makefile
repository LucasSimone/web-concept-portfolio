.PHONY: start-dev stop-dev admin-password

# Runs the server straight off disk (DEV=1) instead of the compiled-in
# embedded build, so editing HTML/CSS/JS under web/static shows up on
# browser refresh with no rebuild or restart.
start-dev:
	DEV=1 go run ./cmd/server

# Kills whatever is listening on the dev server's port - handy when it was
# left running in the background (or from another session) instead of
# stopped with Ctrl+C.
stop-dev:
	@pid=$$(lsof -tiTCP:8080 -sTCP:LISTEN); \
	if [ -n "$$pid" ]; then \
		kill $$pid && echo "Stopped dev server (pid $$pid)"; \
	else \
		echo "No dev server running on :8080"; \
	fi

# Generates the credential for the admin portal at /admin and prints the
# ADMIN_PASSWORD_HASH line to paste into .env (local) or the service's
# environment (production). With no argument it invents a strong password
# and prints it once; pass your own with PASSWORD=... instead:
#
#   make admin-password
#   make admin-password PASSWORD='the one I already use'
#
# Until ADMIN_PASSWORD_HASH is set the portal is disabled and /admin
# 404s, which is deliberate - see cmd/server/main.go. The password is
# printed to the terminal, so clear your scrollback after saving it.
admin-password:
	@PASSWORD="$(PASSWORD)" go run ./cmd/adminpass
